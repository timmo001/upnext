import { Rpc, RpcGroup } from "effect/rpc";
import { Feed, FeedItem } from "./Feed.js";
import {
  ChannelRequest,
  ItemNotFound,
  MarkWatchedRequest,
  QueueAddRequest,
  RecheckRequest,
  SourceError,
} from "./Requests.js";

export class UpnextRpcs extends RpcGroup.make(
  Rpc.make("GetFeed", {
    success: Feed,
  }),
  // The current feed, then the whole feed again after each change.
  Rpc.make("WatchFeed", {
    success: Feed,
    stream: true,
  }),
  Rpc.make("Recheck", {
    payload: RecheckRequest,
    error: SourceError,
  }),
  // Adds the channel to channels.yml, or changes its auto-open setting.
  Rpc.make("AddChannel", {
    payload: ChannelRequest,
    error: SourceError,
  }),
  Rpc.make("RemoveChannel", {
    payload: ChannelRequest,
    error: SourceError,
  }),
  // Saves a URL to watch later.
  Rpc.make("QueueAdd", {
    payload: QueueAddRequest,
    success: FeedItem,
    error: SourceError,
  }),
  // Hides a YouTube upload or removes a saved item.
  Rpc.make("MarkWatched", {
    payload: MarkWatchedRequest,
    error: ItemNotFound,
  }),
) {}
