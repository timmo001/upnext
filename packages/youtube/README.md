# @timmo001/effect-youtube

An Effect client for YouTube: channel RSS feeds, live and upcoming streams from the Data API, subscriptions through a Google sign-in, oEmbed lookups, and mapping videos to [Up Next](https://github.com/timmo001/upnext) media items.

It works on its own and knows nothing about Up Next's config files or socket.

## Install

```bash
bun add @timmo001/effect-youtube effect
npm install @timmo001/effect-youtube effect
npx jsr add @timmo001/effect-youtube
```

`effect` is a peer dependency, so install the same Effect v4 version your app uses.

## Client

`YouTubeClient.layer` takes an optional Data API key and an optional access token from a Google sign-in. Feeds and oEmbed work without either; `videos` needs one of them, and `subscriptions` needs the access token.

```ts
import { YouTubeClient, toMediaItem } from "@timmo001/effect-youtube";
import { Effect, Option } from "effect";
import { FetchHttpClient } from "effect/http";

const uploads = Effect.gen(function* () {
  const youtube = yield* YouTubeClient;
  const entries = yield* youtube.channelFeed("UCxxxxxxxxxxxxxxxxxxxxxx");

  return entries.map((entry) => toMediaItem(entry, Option.none()));
}).pipe(
  Effect.provide(YouTubeClient.layer({ apiKey: Option.none() })),
  Effect.provide(FetchHttpClient.layer),
);
```

- `channelFeed(channelId)`: the latest 15 uploads from a channel's RSS feed. It takes the channel ID that starts with `UC`, not a handle.
- `videos(videoIds)`: titles, live state, stream times and viewer counts, 50 videos per request. The key or token is sent as a header, so it never appears in a URL.
- `subscriptions`: every channel the signed-in account subscribes to, 50 per request.
- `playlistItems(playlistId)`: every video in a playlist, 50 per request, leaving out deleted and private ones. Needs the access token.
- `addToPlaylist(playlistId, videoId)` and `removeFromPlaylist(itemId)`: change a playlist. They need a sign-in with `manageScope`. `removeFromPlaylist` takes the entry's `itemId`, not the video ID.
- `oembed(url)`: the title, channel and thumbnail for any video URL, without a key.

`toMediaItem(entry, details)` turns a feed entry into a `MediaItem`. With details from `videos`, live and upcoming streams get the `live` or `upcoming` kind and their start time. `toSavedItem(entry)` turns a playlist entry into a `saved` item. `videoIdFromUrl` reads the video ID from watch, `youtu.be`, shorts, live and embed URLs, and `playlistIdFrom` reads a playlist ID from an ID or a URL with a `list` parameter.

## Google sign-in

`authorizeUrl`, `exchangeCode` and `refreshTokens` handle a Google sign-in. `authorizeUrl` asks for the read-only YouTube scope, `requiredScope`, unless you pass `scope`, such as `manageScope` to change playlists. They take the ID and secret of a Google OAuth client of the Desktop app type, which can redirect to any loopback port. `authorizeUrl` asks for offline access, so `exchangeCode` returns a refresh token. The returned tokens include the scopes Google granted, when it says.

Failures are a `YouTubeError`, with the HTTP status and the API's reason when there are them, or a `YouTubeAuthError` when Google rejects the sign-in or refresh token, or the sign-in doesn't allow changing playlists.

## Licence

Apache 2.0. See [LICENSE](https://github.com/timmo001/upnext/blob/main/LICENSE).
