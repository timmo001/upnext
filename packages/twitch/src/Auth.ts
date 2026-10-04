import {
  Array as Arr,
  DateTime,
  Duration,
  Effect,
  Option,
  Redacted,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { TwitchAuthError, TwitchError } from "./TwitchError.js";

// Reading followed channels is the only scope upnext needs.
export const requiredScope = "user:read:follows";

const authorizeEndpoint = "https://id.twitch.tv/oauth2/authorize";

const tokenEndpoint = "https://id.twitch.tv/oauth2/token";

const validateEndpoint = "https://id.twitch.tv/oauth2/validate";

export interface TwitchCredentials {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
}

export interface TwitchTokens {
  readonly accessToken: Redacted.Redacted;
  readonly refreshToken: Option.Option<Redacted.Redacted>;
  // Unknown until the token has been refreshed or validated.
  readonly expiresAt: Option.Option<DateTime.Utc>;
}

// Who the access token belongs to.
export interface TokenOwner {
  readonly userId: string;
  readonly login: string;
}

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Finite),
});

const ValidateResponse = Schema.Struct({
  client_id: Schema.String,
  login: Schema.String,
  user_id: Schema.String,
  scopes: Schema.NullOr(Schema.Array(Schema.String)),
  expires_in: Schema.Finite,
});

const expiresIn = (seconds: number | undefined) =>
  Effect.map(DateTime.now, (now) =>
    Option.map(
      Option.liftPredicate(seconds ?? 0, (value) => value > 0),
      (value) => DateTime.addDuration(now, Duration.seconds(value)),
    ),
  );

const requestFailed = (context: string) => (cause: { message: string }) =>
  new TwitchError({ message: `${context}: ${cause.message}` });

// The page to send someone to so they can grant upnext access.
export const authorizeUrl = (options: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
}) => {
  const url = new URL(authorizeEndpoint);

  url.search = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: requiredScope,
    state: options.state,
  }).toString();

  return url.toString();
};

const requestTokens = Effect.fn("Twitch.requestTokens")(function* (
  credentials: TwitchCredentials,
  params: Record<string, string>,
  previousRefreshToken: Option.Option<Redacted.Redacted>,
) {
  const http = yield* HttpClient.HttpClient;

  const response = yield* http
    .execute(
      HttpClientRequest.post(tokenEndpoint).pipe(
        HttpClientRequest.bodyUrlParams({
          client_id: credentials.clientId,
          client_secret: Redacted.value(credentials.clientSecret),
          ...params,
        }),
      ),
    )
    .pipe(Effect.mapError(requestFailed("token request")));

  // Twitch answers a bad code or refresh token with 400.
  if (response.status === 400 || response.status === 401) {
    return yield* new TwitchAuthError({
      message: `Twitch rejected the ${params["grant_type"] === "refresh_token" ? "refresh token" : "sign-in code"}`,
    });
  }

  if (response.status < 200 || response.status >= 300) {
    return yield* new TwitchError({
      message: `token request failed with status ${response.status}`,
      status: response.status,
    });
  }

  const body = yield* HttpClientResponse.schemaBodyJson(TokenResponse)(
    response,
  ).pipe(Effect.mapError(requestFailed("read token response")));

  return {
    accessToken: Redacted.make(body.access_token),
    refreshToken: Option.orElse(
      Option.map(Option.fromUndefinedOr(body.refresh_token), Redacted.make),
      () => previousRefreshToken,
    ),
    expiresAt: yield* expiresIn(body.expires_in),
  } satisfies TwitchTokens;
});

// Swaps the code from the sign-in redirect for tokens.
export const exchangeCode = (
  credentials: TwitchCredentials,
  options: { readonly code: string; readonly redirectUri: string },
) =>
  requestTokens(
    credentials,
    {
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: options.redirectUri,
    },
    Option.none(),
  );

export const refreshTokens = (
  credentials: TwitchCredentials,
  refreshToken: Redacted.Redacted,
) =>
  requestTokens(
    credentials,
    {
      grant_type: "refresh_token",
      refresh_token: Redacted.value(refreshToken),
    },
    Option.some(refreshToken),
  );

export interface Validation {
  readonly owner: TokenOwner;
  readonly expiresAt: Option.Option<DateTime.Utc>;
}

// Asks Twitch whether the token still works. Fails with None when Twitch
// rejects the token, so the caller can refresh it first.
export const validateToken = Effect.fn("Twitch.validateToken")(function* (
  clientId: string,
  accessToken: Redacted.Redacted,
) {
  const http = yield* HttpClient.HttpClient;

  const response = yield* http
    .execute(
      HttpClientRequest.get(validateEndpoint).pipe(
        HttpClientRequest.setHeader(
          "Authorization",
          `OAuth ${Redacted.value(accessToken)}`,
        ),
      ),
    )
    .pipe(Effect.mapError(requestFailed("validate token")));

  if (response.status === 401) {
    return Option.none<Validation>();
  }

  if (response.status < 200 || response.status >= 300) {
    return yield* new TwitchError({
      message: `token validation failed with status ${response.status}`,
      status: response.status,
    });
  }

  const body = yield* HttpClientResponse.schemaBodyJson(ValidateResponse)(
    response,
  ).pipe(Effect.mapError(requestFailed("read token validation")));

  if (body.client_id !== clientId) {
    return yield* new TwitchAuthError({
      message: "the token belongs to a different Twitch app",
    });
  }

  if (!Arr.contains(body.scopes ?? [], requiredScope)) {
    return yield* new TwitchAuthError({
      message: `the token is missing the ${requiredScope} scope`,
    });
  }

  return Option.some<Validation>({
    owner: { userId: body.user_id, login: body.login },
    expiresAt: yield* expiresIn(body.expires_in),
  });
});
