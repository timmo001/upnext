import {
  Array as Arr,
  DateTime,
  Duration,
  Effect,
  Option,
  Redacted,
  Schema,
  String as Str,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { YouTubeAuthError, YouTubeError } from "./YouTubeError.js";

// Enough to read subscriptions and playlists.
export const requiredScope = "https://www.googleapis.com/auth/youtube.readonly";

// Also lets the app add to and remove from playlists.
export const manageScope = "https://www.googleapis.com/auth/youtube";

const authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";

const tokenEndpoint = "https://oauth2.googleapis.com/token";

// A Google OAuth client of the Desktop app type.
export interface GoogleCredentials {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
}

export interface GoogleTokens {
  readonly accessToken: Redacted.Redacted;
  readonly refreshToken: Option.Option<Redacted.Redacted>;
  readonly expiresAt: DateTime.Utc;
  // What the person allowed, which can be less than was asked for. None when
  // Google didn't say.
  readonly scopes: Option.Option<ReadonlyArray<string>>;
}

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.Finite,
  scope: Schema.optional(Schema.String),
});

const requestFailed = (context: string) => (cause: { message: string }) =>
  new YouTubeError({ message: `${context}: ${cause.message}` });

// The page to send someone to so they can grant upnext access. Asks for
// consent each time, so Google always returns a refresh token. The scope
// defaults to read-only.
export const authorizeUrl = (options: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope?: string;
}) => {
  const url = new URL(authorizeEndpoint);

  url.search = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: options.scope ?? requiredScope,
    state: options.state,
    access_type: "offline",
    prompt: "consent",
  }).toString();

  return url.toString();
};

const requestTokens = Effect.fn("YouTube.requestTokens")(function* (
  credentials: GoogleCredentials,
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

  // Google answers a bad code or refresh token with 400, and a bad client
  // with 401.
  if (response.status === 400 || response.status === 401) {
    return yield* new YouTubeAuthError({
      message: `Google rejected the ${params["grant_type"] === "refresh_token" ? "refresh token" : "sign-in code"}`,
    });
  }

  if (response.status < 200 || response.status >= 300) {
    return yield* new YouTubeError({
      message: `token request failed with status ${response.status}`,
      status: response.status,
    });
  }

  const body = yield* HttpClientResponse.schemaBodyJson(TokenResponse)(
    response,
  ).pipe(Effect.mapError(requestFailed("read token response")));

  const now = yield* DateTime.now;

  return {
    accessToken: Redacted.make(body.access_token),
    refreshToken: Option.orElse(
      Option.map(Option.fromUndefinedOr(body.refresh_token), Redacted.make),
      () => previousRefreshToken,
    ),
    expiresAt: DateTime.addDuration(now, Duration.seconds(body.expires_in)),
    scopes: Option.map(Option.fromUndefinedOr(body.scope), (scope) =>
      Arr.filter(Str.split(scope, " "), Str.isNonEmpty),
    ),
  } satisfies GoogleTokens;
});

// Swaps the code from the sign-in redirect for tokens.
export const exchangeCode = (
  credentials: GoogleCredentials,
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
  credentials: GoogleCredentials,
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
