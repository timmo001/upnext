import { Schema } from "effect";
import { MediaItem, Source } from "@timmo001/effect-upnext-shared";

// A media item with what the daemon knows about it.
export const FeedItem = Schema.Struct({
  item: MediaItem,
  // False for followed Twitch channels that aren't in channels.yml.
  tracked: Schema.Boolean,
  // Whether the daemon opens it as soon as it appears.
  autoOpen: Schema.Boolean,
});

export type FeedItem = typeof FeedItem.Type;

export const SourceState = Schema.Literals([
  "ok",
  "auth-required",
  "error",
  "disabled",
]);

export type SourceState = typeof SourceState.Type;

// How a source's last check went.
export const SourceStatus = Schema.Struct({
  source: Source,
  state: SourceState,
  message: Schema.optional(Schema.String),
  checkedAt: Schema.optional(Schema.DateTimeUtc),
});

export type SourceStatus = typeof SourceStatus.Type;

// Live items first, then upcoming, uploads and saved items, newest first.
export const Feed = Schema.Struct({
  sources: Schema.Array(SourceStatus),
  items: Schema.Array(FeedItem),
});

export type Feed = typeof Feed.Type;
