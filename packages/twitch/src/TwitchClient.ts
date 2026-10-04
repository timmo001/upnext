import {
  Array as Arr,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
  String as Str,
  SynchronizedRef,
} from "effect";
import type { Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import type { Socket } from "effect/socket";
import {
  refreshTokens,
  type TokenOwner,
  type TwitchCredentials,
  type TwitchTokens,
  validateToken,
} from "./Auth.js";
import { streamOnline, type StreamOnline } from "./EventSub.js";
import { TwitchStream, TwitchUser } from "./Helix.js";
import { TwitchAuthError, TwitchError } from "./TwitchError.js";

const helixBase = "https://api.twitch.tv/helix";

const maxPerRequest = 100;

// Refresh this long before the token expires.
const refreshMargin = Duration.minutes(5);

const maxRateLimitWait = Duration.minutes(2);

const maxRateLimitRetries = 3;

const Page = <S extends Schema.Top>(item: S) =>
  Schema.Struct({
    data: Schema.Array(item),
    pagination: Schema.optional(
      Schema.Struct({ cursor: Schema.optional(Schema.String) }),
    ),
  });

const UsersPage = Page(TwitchUser);

const StreamsPage = Page(TwitchStream);

export type TwitchClientError = TwitchError | TwitchAuthError;

export interface TwitchClientOptions extends TwitchCredentials {
  readonly tokens: TwitchTokens;
  // Called after each refresh so the new tokens can be stored.
  readonly onTokens?: (tokens: TwitchTokens) => Effect.Effect<void>;
}

export interface TwitchClientService {
  // Checks the token with Twitch, refreshing it if needed, and returns who
  // it belongs to. Twitch asks apps to do this hourly.
  readonly validate: Effect.Effect<TokenOwner, TwitchClientError>;
  readonly users: (
    logins: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<TwitchUser>, TwitchClientError>;
  // Live streams for the given logins.
  readonly streams: (
    logins: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<TwitchStream>, TwitchClientError>;
  // Live streams from channels the user follows.
  readonly followedStreams: (
    userId: string,
  ) => Effect.Effect<ReadonlyArray<TwitchStream>, TwitchClientError>;
  readonly subscribeStreamOnline: (
    sessionId: string,
    broadcasterId: string,
  ) => Effect.Effect<void, TwitchClientError>;
  // stream.online events over EventSub, reconnecting forever. Twitch allows
  // up to `maxEventSubChannels` channels.
  readonly streamOnline: (
    broadcasterIds: ReadonlyArray<string>,
  ) => Stream.Stream<StreamOnline, never, Socket.WebSocketConstructor>;
}

const requestFailed = (cause: { message: string }) =>
  new TwitchError({ message: `Helix request failed: ${cause.message}` });

// Helix error bodies only carry a short message, never credentials.
const HelixErrorBody = Schema.Struct({ message: Schema.String });

const errorReason = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(HelixErrorBody)(response).pipe(
    Effect.map(({ message }) =>
      Str.isNonEmpty(message) ? `: ${message}` : "",
    ),
    Effect.orElseSucceed(() => ""),
  );

const needsRefresh = (tokens: TwitchTokens) =>
  Effect.map(DateTime.now, (now) =>
    Option.match(tokens.expiresAt, {
      onNone: () => false,
      onSome: (expiresAt) =>
        DateTime.isLessThanOrEqualTo(
          expiresAt,
          DateTime.addDuration(now, refreshMargin),
        ),
    }),
  );

// How long Twitch wants us to wait, from its reset header in epoch seconds.
const rateLimitWait = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.map(DateTime.now, (now) =>
    Option.match(
      Option.flatMap(
        Option.fromUndefinedOr(response.headers["ratelimit-reset"]),
        (reset) => Option.liftPredicate(Number(reset), Number.isFinite),
      ),
      {
        onNone: () => Duration.seconds(5),
        onSome: (reset) =>
          Duration.clamp(
            Duration.millis(reset * 1000 - DateTime.toEpochMillis(now)),
            { minimum: Duration.seconds(1), maximum: maxRateLimitWait },
          ),
      },
    ),
  );

export const make = Effect.fn("TwitchClient.make")(function* (
  options: TwitchClientOptions,
) {
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.retryTransient({ times: 3 }),
  );

  const credentials: TwitchCredentials = {
    clientId: options.clientId,
    clientSecret: options.clientSecret,
  };

  const tokens = yield* SynchronizedRef.make(options.tokens);
  const provideHttp = Effect.provideService(HttpClient.HttpClient, http);

  // Refreshes unless another request already replaced the stale token.
  const refresh = (stale: Redacted.Redacted) =>
    SynchronizedRef.modifyEffect(tokens, (current) => {
      if (Redacted.value(current.accessToken) !== Redacted.value(stale)) {
        return Effect.succeed([current.accessToken, current] as const);
      }

      return Option.match(current.refreshToken, {
        onNone: () =>
          Effect.fail(
            new TwitchAuthError({
              message: "the access token expired and there's no refresh token",
            }),
          ),
        onSome: (refreshToken) =>
          refreshTokens(credentials, refreshToken).pipe(
            provideHttp,
            Effect.tap((next) => options.onTokens?.(next) ?? Effect.void),
            Effect.tap(() => Effect.logInfo("Refreshed the Twitch token")),
            Effect.map((next) => [next.accessToken, next] as const),
          ),
      });
    });

  const accessToken = Effect.gen(function* () {
    const current = yield* SynchronizedRef.get(tokens);

    return (yield* needsRefresh(current))
      ? yield* refresh(current.accessToken)
      : current.accessToken;
  });

  const validate = Effect.gen(function* () {
    const token = yield* accessToken;

    const result = yield* Effect.flatMap(
      validateToken(options.clientId, token).pipe(provideHttp),
      Option.match({
        onNone: () =>
          Effect.flatMap(refresh(token), (fresh) =>
            validateToken(options.clientId, fresh).pipe(provideHttp),
          ),
        onSome: (validation) => Effect.succeedSome(validation),
      }),
    );

    if (Option.isNone(result)) {
      return yield* new TwitchAuthError({
        message: "Twitch rejected the refreshed token",
      });
    }

    yield* SynchronizedRef.update(tokens, (current) => ({
      ...current,
      expiresAt: result.value.expiresAt,
    }));

    return result.value.owner;
  }).pipe(Effect.withSpan("TwitchClient.validate"));

  const send = (
    request: HttpClientRequest.HttpClientRequest,
    attempt: { readonly refreshed: boolean; readonly rateLimited: number },
  ): Effect.Effect<HttpClientResponse.HttpClientResponse, TwitchClientError> =>
    Effect.gen(function* () {
      const token = yield* accessToken;

      const response = yield* http
        .execute(
          request.pipe(
            HttpClientRequest.setHeader("Client-Id", options.clientId),
            HttpClientRequest.bearerToken(token),
          ),
        )
        .pipe(Effect.mapError(requestFailed));

      if (response.status === 401 && !attempt.refreshed) {
        yield* refresh(token);

        return yield* send(request, { ...attempt, refreshed: true });
      }

      // Twitch also answers 429 when a subscription would go over the
      // token's EventSub budget, which waiting doesn't fix.
      if (
        response.status === 429 &&
        response.headers["ratelimit-remaining"] === "0" &&
        attempt.rateLimited < maxRateLimitRetries
      ) {
        const wait = yield* rateLimitWait(response);

        yield* Effect.logWarning(
          `Twitch rate limit hit, waiting ${Duration.format(wait)}`,
        );

        yield* Effect.sleep(wait);

        return yield* send(request, {
          ...attempt,
          rateLimited: attempt.rateLimited + 1,
        });
      }

      if (response.status === 401) {
        return yield* new TwitchAuthError({
          message: "Twitch rejected the access token",
        });
      }

      if (response.status < 200 || response.status >= 300) {
        const reason = yield* errorReason(response);

        return yield* new TwitchError({
          message: `${request.method} ${new URL(request.url).pathname} failed with status ${response.status}${reason}`,
          status: response.status,
        });
      }

      return response;
    });

  const get = <S extends Schema.Top>(
    path: string,
    params: ReadonlyArray<readonly [string, string]>,
    schema: S & Schema.Decoder<unknown>,
  ) =>
    send(
      HttpClientRequest.get(`${helixBase}${path}`).pipe(
        HttpClientRequest.setUrlParams(params),
      ),
      { refreshed: false, rateLimited: 0 },
    ).pipe(
      Effect.flatMap((response) =>
        HttpClientResponse.schemaBodyJson(schema)(response).pipe(
          Effect.mapError(requestFailed),
        ),
      ),
    );

  // Looks things up 100 at a time, the most Helix takes per request.
  const inChunks = <A>(
    values: ReadonlyArray<string>,
    lookup: (
      chunk: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<A>, TwitchClientError>,
  ) =>
    Effect.forEach(Arr.chunksOf(Arr.dedupe(values), maxPerRequest), lookup, {
      concurrency: 1,
    }).pipe(Effect.map(Arr.flatten));

  const users = (logins: ReadonlyArray<string>) =>
    inChunks(logins, (chunk) =>
      get(
        "/users",
        Arr.map(chunk, (login) => ["login", login] as const),
        UsersPage,
      ).pipe(Effect.map(({ data }) => data)),
    ).pipe(Effect.withSpan("TwitchClient.users"));

  const streams = (logins: ReadonlyArray<string>) =>
    inChunks(logins, (chunk) =>
      get(
        "/streams",
        Arr.append(
          Arr.map(chunk, (login) => ["user_login", login] as const),
          ["first", String(maxPerRequest)] as const,
        ),
        StreamsPage,
      ).pipe(Effect.map(({ data }) => data)),
    ).pipe(Effect.withSpan("TwitchClient.streams"));

  const followedPage = (
    userId: string,
    cursor: Option.Option<string>,
  ): Effect.Effect<ReadonlyArray<TwitchStream>, TwitchClientError> =>
    get(
      "/streams/followed",
      Arr.appendAll(
        [
          ["user_id", userId],
          ["first", String(maxPerRequest)],
        ] as const,
        Option.match(cursor, {
          onNone: () => [],
          onSome: (after) => [["after", after] as const],
        }),
      ),
      StreamsPage,
    ).pipe(
      Effect.flatMap(({ data, pagination }) =>
        Option.match(
          Option.liftPredicate(
            Option.fromUndefinedOr(pagination?.cursor),
            () => data.length === maxPerRequest,
          ).pipe(Option.flatten),
          {
            onNone: () => Effect.succeed(data),
            onSome: (next) =>
              Effect.map(followedPage(userId, Option.some(next)), (rest) =>
                Arr.appendAll(data, rest),
              ),
          },
        ),
      ),
    );

  const followedStreams = (userId: string) =>
    followedPage(userId, Option.none()).pipe(
      Effect.withSpan("TwitchClient.followedStreams"),
    );

  const subscribeStreamOnline = (sessionId: string, broadcasterId: string) =>
    send(
      HttpClientRequest.post(`${helixBase}/eventsub/subscriptions`).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          type: "stream.online",
          version: "1",
          condition: { broadcaster_user_id: broadcasterId },
          transport: { method: "websocket", session_id: sessionId },
        }),
      ),
      { refreshed: false, rateLimited: 0 },
    ).pipe(
      Effect.asVoid,
      Effect.withSpan("TwitchClient.subscribeStreamOnline"),
    );

  return {
    validate,
    users,
    streams,
    followedStreams,
    subscribeStreamOnline,
    streamOnline: (broadcasterIds) =>
      streamOnline({ broadcasterIds, subscribe: subscribeStreamOnline }),
  } satisfies TwitchClientService;
});

export class TwitchClient extends Context.Service<
  TwitchClient,
  TwitchClientService
>()("@timmo001/effect-twitch/TwitchClient") {
  static readonly layer = (options: TwitchClientOptions) =>
    Layer.effect(TwitchClient, Effect.map(make(options), TwitchClient.of));
}
