import { BunHttpServer } from "@effect/platform-bun";
import { Deferred, Effect, Option } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { SourceError } from "@timmo001/effect-upnext";

export interface SignInTarget {
  readonly source: "twitch" | "youtube";
  // Shown in messages, such as Twitch or Google.
  readonly provider: string;
  readonly redirectUri: string;
}

// Must match a redirect URL registered on the Twitch app. twitch-notifications
// used the same one, so existing apps keep working.
export const twitchSignIn: SignInTarget = {
  source: "twitch",
  provider: "Twitch",
  redirectUri: "http://localhost:8080/oauth/callback",
};

// Google lets a desktop app's client redirect to any loopback port without
// registering it.
export const youtubeSignIn: SignInTarget = {
  source: "youtube",
  provider: "Google",
  redirectUri: "http://127.0.0.1:8081/oauth/callback",
};

const htmlPage = (message: string, status = 200) =>
  HttpServerResponse.text(
    `<!doctype html><title>Up Next</title><p>${message}</p>`,
    { status, contentType: "text/html" },
  );

// Listens for the redirect back from the provider for as long as the scope is
// open. Returns the code once it arrives.
export const listenForCode = Effect.fn("listenForCode")(function* (
  target: SignInTarget,
  state: string,
) {
  const callback = new URL(target.redirectUri);

  const signInFailed = (message: string) =>
    new SourceError({ source: target.source, message });

  const code = yield* Deferred.make<string, SourceError>();

  const server = yield* BunHttpServer.make({
    hostname: callback.hostname,
    port: Number(callback.port),
  }).pipe(
    Effect.mapError((error) =>
      signInFailed(
        `could not listen on ${callback.host} for the sign-in redirect: ${error.message}`,
      ),
    ),
  );

  yield* server.serve(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, callback.origin);

      if (url.pathname !== callback.pathname) {
        return HttpServerResponse.text("Not found", { status: 404 });
      }

      const param = (name: string) =>
        Option.fromNullishOr(url.searchParams.get(name));

      if (!Option.contains(param("state"), state)) {
        return htmlPage(
          `This sign-in link has expired. Run upnext auth ${target.source} again.`,
          400,
        );
      }

      const error = Option.orElse(param("error_description"), () =>
        param("error"),
      );

      if (Option.isSome(error)) {
        yield* Deferred.fail(
          code,
          signInFailed(
            `${target.provider} refused the sign-in: ${error.value}`,
          ),
        );

        return htmlPage("Sign-in cancelled.");
      }

      return yield* Option.match(param("code"), {
        onNone: () =>
          Effect.succeed(
            htmlPage(`${target.provider} sent no sign-in code.`, 400),
          ),
        onSome: (value) =>
          Deferred.succeed(code, value).pipe(
            Effect.as(
              htmlPage(
                `Finishing signing in to ${target.provider}. You can close this tab.`,
              ),
            ),
          ),
      });
    }),
  );

  return code;
});
