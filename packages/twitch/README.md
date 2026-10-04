# @timmo001/effect-twitch

An Effect client for Twitch: sign-in, Helix, EventSub `stream.online` events, and mapping live streams to [upnext](https://github.com/timmo001/upnext) media items.

It works on its own and knows nothing about upnext's config files or socket.

## Install

```bash
bun add @timmo001/effect-twitch effect
npm install @timmo001/effect-twitch effect
npx jsr add @timmo001/effect-twitch
```

`effect` is a peer dependency, so install the same Effect v4 version your app uses.

## Sign in

Twitch needs a registered app with a client ID, a client secret and a redirect URL. Send someone to `authorizeUrl`, then swap the code from the redirect for tokens:

```ts
import { authorizeUrl, exchangeCode } from "@timmo001/effect-twitch";

const url = authorizeUrl({ clientId, redirectUri, state });

// Once Twitch redirects back with ?code=...&state=...
const tokens = exchangeCode({ clientId, clientSecret }, { code, redirectUri });
```

`exchangeCode` needs an `HttpClient`, such as `FetchHttpClient.layer` from `effect/http`. The only scope requested is `user:read:follows`.

## Client

`TwitchClient.layer` takes the credentials and tokens. It refreshes the access token before it expires and when Twitch rejects it, and calls `onTokens` with each new pair so you can store them.

```ts
import { TwitchClient, toMediaItem } from "@timmo001/effect-twitch";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";

const live = Effect.gen(function* () {
  const twitch = yield* TwitchClient;
  const owner = yield* twitch.validate;
  const streams = yield* twitch.followedStreams(owner.userId);

  return streams.map(toMediaItem);
}).pipe(
  Effect.provide(TwitchClient.layer({ clientId, clientSecret, tokens })),
  Effect.provide(FetchHttpClient.layer),
);
```

- `validate`: checks the token, refreshing it if needed, and returns who it belongs to. Twitch asks apps to do this hourly.
- `users(logins)` and `streams(logins)`: look up channels and their live streams, 100 at a time.
- `followedStreams(userId)`: live streams from followed channels.
- `streamOnline(broadcasterIds)`: a stream of EventSub `stream.online` events that reconnects forever. It needs a `Socket.WebSocketConstructor`. Twitch allows up to `maxEventSubChannels` (10) channels per user token.

Failures are a `TwitchError`, or a `TwitchAuthError` when someone needs to sign in again. Neither includes response bodies, so tokens don't end up in logs.

## Licence

Apache 2.0. See [LICENSE](https://github.com/timmo001/upnext/blob/main/LICENSE).
