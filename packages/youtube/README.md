# @timmo001/effect-youtube

An Effect client for YouTube: channel RSS feeds, live and upcoming streams from the Data API, oEmbed lookups, and mapping videos to [upnext](https://github.com/timmo001/upnext) media items.

It works on its own and knows nothing about upnext's config files or socket.

## Install

```bash
bun add @timmo001/effect-youtube effect
npm install @timmo001/effect-youtube effect
npx jsr add @timmo001/effect-youtube
```

`effect` is a peer dependency, so install the same Effect v4 version your app uses.

## Client

`YouTubeClient.layer` takes an optional Data API key. Feeds and oEmbed work without one; only `videos` needs it.

```ts
import { YouTubeClient, toMediaItem } from "@timmo001/effect-youtube";
import { Effect, Option } from "effect";
import { FetchHttpClient } from "effect/http";

const uploads = Effect.gen(function* () {
  const youtube = yield* YouTubeClient;
  const entries = yield* youtube.channelFeed("UCXuqSBlHAE6Xw-yeJA0Tunw");

  return entries.map((entry) => toMediaItem(entry, Option.none()));
}).pipe(
  Effect.provide(YouTubeClient.layer({ apiKey: Option.none() })),
  Effect.provide(FetchHttpClient.layer),
);
```

- `channelFeed(channelId)`: the latest 15 uploads from a channel's RSS feed. It takes the channel ID that starts with `UC`, not a handle.
- `videos(videoIds)`: titles, live state and stream times, 50 videos per request. The key is sent as a header, so it never appears in a URL.
- `oembed(url)`: the title, channel and thumbnail for any video URL, without a key.

`toMediaItem(entry, details)` turns a feed entry into a `MediaItem`. With details from `videos`, live and upcoming streams get the `live` or `upcoming` kind and their start time. `videoIdFromUrl` reads the video ID from watch, `youtu.be`, shorts, live and embed URLs.

Failures are a `YouTubeError`, with the HTTP status when there is one.

## Licence

Apache 2.0. See [LICENSE](https://github.com/timmo001/upnext/blob/main/LICENSE).
