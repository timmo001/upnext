import { DateTime, Duration, Effect, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { YouTubeAuthError, YouTubeError } from "./YouTubeError.js";

// Reading subscriptions is the only access upnext needs.
export const requiredScope = "https://www.googleapis.com/auth/youtube.readonly";

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
}

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.Finite,
});

const requestFailed = (context: string) => (cause: { message: string }) =>
  new YouTubeError({ message: `${context}: ${cause.message}` });

// The page to send someone to so they can grant upnext access. Asks for
// consent each time, so Google always returns a refresh token.
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
