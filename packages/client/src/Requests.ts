import { Schema } from "effect";
import { Source } from "@timmo001/effect-upnext-shared";

// Checks every source, or only `source`. With `open`, live items set to
// auto-open are opened even if they were already live.
export const RecheckRequest = Schema.Struct({
  source: Schema.optional(Source),
  open: Schema.Boolean,
});

export type RecheckRequest = typeof RecheckRequest.Type;

// A Twitch login or a YouTube channel ID.
export const ChannelRequest = Schema.Struct({
  source: Source,
  name: Schema.String,
  open: Schema.optional(Schema.Boolean),
});

export type ChannelRequest = typeof ChannelRequest.Type;

export const QueueAddRequest = Schema.Struct({
  url: Schema.String,
  title: Schema.optional(Schema.String),
});

export type QueueAddRequest = typeof QueueAddRequest.Type;

export const MarkWatchedRequest = Schema.Struct({
  id: Schema.String,
});

export type MarkWatchedRequest = typeof MarkWatchedRequest.Type;

// A source couldn't do what was asked, such as add an unknown channel.
export class SourceError extends Schema.TaggedError<SourceError>()(
  "SourceError",
  { source: Schema.optional(Source), message: Schema.String },
) {}

export class ItemNotFound extends Schema.TaggedError<ItemNotFound>()(
  "ItemNotFound",
  { id: Schema.String },
) {}
