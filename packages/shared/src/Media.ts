import { Schema } from "effect";

// Where an item comes from. A link is any other URL saved to watch later.
export const Source = Schema.Literals(["twitch", "youtube", "link"]);

export type Source = typeof Source.Type;

// Feeds sort in this order: live first, saved items last.
export const MediaKind = Schema.Literals([
  "live",
  "upcoming",
  "upload",
  "saved",
]);

export type MediaKind = typeof MediaKind.Type;

export const MediaChannel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
});

export type MediaChannel = typeof MediaChannel.Type;

// One thing to watch, in the same shape for every source. The ID is prefixed
// with its source, such as twitch:<login>, youtube:<video ID> or link:<UUID>.
export const MediaItem = Schema.Struct({
  id: Schema.String,
  source: Source,
  kind: MediaKind,
  title: Schema.String,
  url: Schema.String,
  // Missing for a plain link.
  channel: Schema.optional(MediaChannel),
  thumbnailUrl: Schema.optional(Schema.String),
  // The Twitch category, such as the game being played.
  category: Schema.optional(Schema.String),
  // When the stream started, the video was uploaded or the item was saved.
  publishedAt: Schema.optional(Schema.DateTimeUtc),
  // How many people are watching a live stream.
  viewers: Schema.optional(Schema.Finite),
});

export type MediaItem = typeof MediaItem.Type;
