import { Schema } from "effect";
import { MediaItem, Source } from "@timmo001/effect-upnext-shared";

// A media item with what the daemon knows about it.
export const FeedItem = Schema.Struct({
  item: MediaItem,
  // False for followed Twitch channels and YouTube subscriptions that aren't
  // in channels.yml.
  tracked: Schema.Boolean,
  // Where a tracked item's channel is listed in channels.yml.
  position: Schema.optional(Schema.Int),
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

// The YouTube playlist that saved videos go in. The title is missing until
// the playlist has been read.
export const WatchLaterPlaylist = Schema.Struct({
  url: Schema.String,
  title: Schema.optional(Schema.String),
});

export type WatchLaterPlaylist = typeof WatchLaterPlaylist.Type;

// Live items first: tracked Twitch channels, then tracked YouTube channels,
// each in channels.yml order, then everything else live by viewers. Then
// upcoming, uploads and saved items, newest first.
export const Feed = Schema.Struct({
  sources: Schema.Array(SourceStatus),
  items: Schema.Array(FeedItem),
  // Missing when there's no watch-later playlist set.
  watchLaterPlaylist: Schema.optional(WatchLaterPlaylist),
});

export type Feed = typeof Feed.Type;
