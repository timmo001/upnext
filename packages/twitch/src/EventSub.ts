import {
  Array as Arr,
  Data,
  Duration,
  Effect,
  Option,
  Predicate,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import { Socket } from "effect/socket";
import { TwitchError } from "./TwitchError.js";

export const eventSubUrl = "wss://eventsub.wss.twitch.tv/ws";

// Twitch allows a total subscription cost of 10 per user token, and each
// stream.online subscription costs 1.
export const maxEventSubChannels = 10;

export const StreamOnline = Schema.Struct({
  broadcaster_user_id: Schema.String,
  broadcaster_user_login: Schema.String,
  broadcaster_user_name: Schema.String,
});

export type StreamOnline = typeof StreamOnline.Type;

const Session = Schema.Struct({
  id: Schema.String,
  keepalive_timeout_seconds: Schema.optional(Schema.NullOr(Schema.Finite)),
  reconnect_url: Schema.optional(Schema.NullOr(Schema.String)),
});

const Message = Schema.Struct({
  metadata: Schema.Struct({
    message_type: Schema.String,
    subscription_type: Schema.optional(Schema.String),
  }),
  payload: Schema.Struct({
    session: Schema.optional(Schema.NullOr(Session)),
    event: Schema.optional(Schema.Unknown),
  }),
});

type Message = typeof Message.Type;

const decodeMessage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Message),
);

const decodeStreamOnline = Schema.decodeUnknownEffect(StreamOnline);

// How long to wait after the last message before giving up on the socket.
const welcomeTimeout = Duration.seconds(30);

const keepaliveGrace = Duration.seconds(10);

const retryDelay = Duration.seconds(30);

// Twitch refused every subscription, usually because another app already
// uses the token's budget. Polling still covers the channels meanwhile.
const refusedDelay = Duration.hours(1);

class SubscriptionsRefused extends Data.TaggedError("SubscriptionsRefused")<{
  readonly message: string;
}> {}

const fail = (context: string) => (cause: { message: string }) =>
  new TwitchError({ message: `EventSub ${context}: ${cause.message}` });

type Next = Option.Option<Option.Option<string>>;

const keepGoing: Next = Option.none();

// Reads one socket until Twitch asks it to move. Returns the URL to move to,
// or None when Twitch gave none.
const session = Effect.fn("EventSub.session")(function* (options: {
  readonly url: string;
  readonly onWelcome: (
    sessionId: string,
  ) => Effect.Effect<void, SubscriptionsRefused>;
  readonly onStreamOnline: (event: StreamOnline) => Effect.Effect<void>;
}) {
  const socket = yield* Socket.makeWebSocket(options.url);

  const pull = yield* Socket.readerString(socket).pipe(
    Effect.mapError(fail("connect")),
  );

  // Twitch sends a keepalive when it has nothing else to send, so silence
  // means the socket is dead.
  const timeout = yield* Ref.make(welcomeTimeout);

  const handle = Effect.fn(function* (message: Message) {
    const current = Option.fromNullishOr(message.payload.session);

    switch (message.metadata.message_type) {
      case "session_welcome": {
        if (Option.isSome(current)) {
          yield* Ref.set(
            timeout,
            Duration.sum(
              Duration.seconds(current.value.keepalive_timeout_seconds ?? 10),
              keepaliveGrace,
            ),
          );

          yield* options.onWelcome(current.value.id);
        }

        return keepGoing;
      }

      case "session_reconnect":
        return Option.some(
          Option.flatMap(current, ({ reconnect_url }) =>
            Option.fromNullishOr(reconnect_url),
          ),
        );

      case "notification":
        if (message.metadata.subscription_type === "stream.online") {
          yield* decodeStreamOnline(message.payload.event).pipe(
            Effect.flatMap(options.onStreamOnline),
            Effect.catch((error) =>
              Effect.logWarning("Ignoring stream.online event", error.message),
            ),
          );
        }

        return keepGoing;

      case "revocation":
        yield* Effect.logWarning(
          "Twitch revoked an EventSub subscription",
          message.metadata.subscription_type ?? "",
        );

        return keepGoing;

      default:
        return keepGoing;
    }
  });

  const decodeAndHandle = (frame: string) =>
    decodeMessage(frame).pipe(
      Effect.flatMap(handle),
      Effect.catchTag("SchemaError", (error) =>
        Effect.logDebug("Ignoring EventSub message", error.message).pipe(
          Effect.as(keepGoing),
        ),
      ),
    );

  const nextBatch = Effect.flatMap(Ref.get(timeout), (duration) =>
    pull.pipe(
      Effect.mapError(fail("read")),
      Effect.timeoutOrElse({
        duration,
        orElse: () =>
          Effect.fail(
            new TwitchError({ message: "EventSub stopped sending keepalives" }),
          ),
      }),
    ),
  );

  const loop: Effect.Effect<
    Option.Option<string>,
    TwitchError | SubscriptionsRefused
  > = nextBatch.pipe(
    Effect.flatMap((batch) => Effect.forEach(batch, decodeAndHandle)),
    Effect.flatMap((results) =>
      Option.match(Arr.findFirst(results, Option.isSome), {
        onNone: () => loop,
        onSome: ({ value }) => Effect.succeed(value),
      }),
    ),
  );

  return yield* loop;
}, Effect.scoped);

// Emits each stream.online event for the channels, reconnecting forever.
// `subscribe` runs once per fresh session for each channel. Sessions Twitch
// moves to a new URL keep their subscriptions.
export const streamOnline = (options: {
  readonly broadcasterIds: ReadonlyArray<string>;
  readonly subscribe: (
    sessionId: string,
    broadcasterId: string,
  ) => Effect.Effect<void, { readonly message: string }>;
  readonly url?: string;
}): Stream.Stream<StreamOnline, never, Socket.WebSocketConstructor> => {
  if (options.broadcasterIds.length === 0) {
    return Stream.empty;
  }

  const freshUrl = options.url ?? eventSubUrl;

  return Stream.callback<StreamOnline, never, Socket.WebSocketConstructor>(
    (queue) => {
      // Stops at the first refusal, since the rest would be refused too.
      const subscribeAll = (sessionId: string) =>
        Effect.gen(function* () {
          const subscribed = yield* Ref.make(0);

          yield* Effect.forEach(
            options.broadcasterIds,
            (broadcasterId) =>
              options
                .subscribe(sessionId, broadcasterId)
                .pipe(Effect.andThen(Ref.update(subscribed, (n) => n + 1))),
            { discard: true },
          ).pipe(
            Effect.catch((error) =>
              Effect.flatMap(Ref.get(subscribed), (count) =>
                count === 0
                  ? Effect.fail(
                      new SubscriptionsRefused({ message: error.message }),
                    )
                  : Effect.logWarning(
                      "Twitch refused some EventSub subscriptions",
                      error.message,
                    ),
              ),
            ),
          );

          yield* Effect.logInfo(
            "EventSub ready",
            `${yield* Ref.get(subscribed)} channels`,
          );
        });

      const retry = (delay: Duration.Duration) =>
        Effect.sleep(delay).pipe(
          Effect.andThen(Effect.suspend(() => run(freshUrl, true))),
        );

      const run = (
        url: string,
        fresh: boolean,
      ): Effect.Effect<never, never, Socket.WebSocketConstructor> =>
        session({
          url,
          onWelcome: (sessionId) =>
            fresh ? subscribeAll(sessionId) : Effect.void,
          onStreamOnline: (event) =>
            Queue.offer(queue, event).pipe(Effect.asVoid),
        }).pipe(
          Effect.matchEffect({
            onSuccess: Option.match({
              onNone: () => run(freshUrl, true),
              onSome: (next) => run(next, false),
            }),
            onFailure: (error) =>
              Predicate.isTagged(error, "SubscriptionsRefused")
                ? Effect.logWarning(
                    `Twitch refused EventSub subscriptions, trying again in ${Duration.format(refusedDelay)}`,
                    error.message,
                  ).pipe(Effect.andThen(retry(refusedDelay)))
                : Effect.logWarning(
                    "EventSub disconnected",
                    error.message,
                  ).pipe(Effect.andThen(retry(retryDelay))),
          }),
        );

      return Effect.forkScoped(Effect.suspend(() => run(freshUrl, true)));
    },
  );
};
