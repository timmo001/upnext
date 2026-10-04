import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { Feed, FeedItem } from "./Feed.js";
import {
  CandidatesRequest,
  ChannelCandidate,
  ChannelRequest,
  ItemNotFound,
  MarkWatchedRequest,
  QueueAddRequest,
  RecheckRequest,
  SignInRequest,
  SignInResult,
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
  // Starts signing in to the source. The feed shows the source as ok once
  // it has finished.
  Rpc.make("SignIn", {
    payload: SignInRequest,
    success: SignInResult,
    error: SourceError,
  }),
  // Adds the channel to channels.yml, or changes its auto-open setting.
  Rpc.make("AddChannel", {
    payload: ChannelRequest,
    error: SourceError,
  }),
  // Followed channels or subscriptions that could be added. Needs a sign-in.
  Rpc.make("ListCandidates", {
    payload: CandidatesRequest,
    success: Schema.Array(ChannelCandidate),
    error: SourceError,
  }),
  Rpc.make("RemoveChannel", {
    payload: ChannelRequest,
    error: SourceError,
  }),
  // Saves a URL to watch later, in the watch-later playlist for a YouTube
  // video when one is set.
  Rpc.make("QueueAdd", {
    payload: QueueAddRequest,
    success: FeedItem,
    error: SourceError,
  }),
  // Hides a YouTube upload or removes a saved item.
  Rpc.make("MarkWatched", {
    payload: MarkWatchedRequest,
    error: Schema.Union([ItemNotFound, SourceError]),
  }),
) {}
