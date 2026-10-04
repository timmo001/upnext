# @timmo001/effect-upnext-shared

Effect schemas shared by [upnext](https://github.com/timmo001/upnext)'s media sources and clients.

Every source, such as Twitch or YouTube, maps what it finds to the same `MediaItem`, so apps can show one list without handling each platform separately.

## Install

```bash
bun add @timmo001/effect-upnext-shared effect
npm install @timmo001/effect-upnext-shared effect
npx jsr add @timmo001/effect-upnext-shared
```

`effect` is a peer dependency, so install the same Effect v4 version your app uses.

## Schemas

- `Source`: `twitch`, `youtube` or `link`. A link is any other URL saved to watch later.
- `MediaKind`: `live`, `upcoming`, `upload` or `saved`.
- `MediaChannel`: a channel's `id`, `name` and `url`.
- `MediaItem`: one thing to watch. Its `id` is prefixed with its source, such as `twitch:<login>`, `youtube:<video ID>` or `link:<UUID>`. It has a `title`, `url` and optional `channel`, `thumbnailUrl`, `category` and `publishedAt`.

`publishedAt` is a `DateTime.Utc`. Use `Schema.toCodecJson(MediaItem)` to read or write items as JSON.

```ts
import { MediaItem } from "@timmo001/effect-upnext-shared";
import { Schema } from "effect";

const decode = Schema.decodeUnknownEffect(Schema.toCodecJson(MediaItem));
```

## Licence

Apache 2.0. See [LICENSE](https://github.com/timmo001/upnext/blob/main/LICENSE).
