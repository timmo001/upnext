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

export const CandidatesRequest = Schema.Struct({
  source: Source,
});

export type CandidatesRequest = typeof CandidatesRequest.Type;

// A followed Twitch channel or YouTube subscription that isn't in
// channels.yml yet. `name` is what AddChannel takes.
export const ChannelCandidate = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
});

export type ChannelCandidate = typeof ChannelCandidate.Type;

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

export const SignInRequest = Schema.Struct({
  source: Source,
});

export type SignInRequest = typeof SignInRequest.Type;

// The daemon opens this page itself. Clients show it in case that fails.
export const SignInResult = Schema.Struct({
  url: Schema.String,
});

export type SignInResult = typeof SignInResult.Type;
