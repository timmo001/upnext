import { Array as Arr, Option, Schema, String as Str } from "effect";
import type { MediaItem, MediaKind } from "@timmo001/effect-upnext-shared";

// One upload from a channel's RSS feed.
export const FeedEntry = Schema.Struct({
  videoId: Schema.String,
  channelId: Schema.String,
  channelName: Schema.String,
  title: Schema.String,
  publishedAt: Schema.DateTimeUtc,
});

export type FeedEntry = typeof FeedEntry.Type;

const OptionalTime = Schema.optional(Schema.DateTimeUtcFromString);

// What videos.list says about a video, which the RSS feed doesn't.
export const VideoDetails = Schema.Struct({
  id: Schema.String,
  snippet: Schema.Struct({
    title: Schema.String,
    channelId: Schema.String,
    channelTitle: Schema.String,
    publishedAt: Schema.DateTimeUtcFromString,
    // live, upcoming or none.
    liveBroadcastContent: Schema.String,
  }),
  liveStreamingDetails: Schema.optional(
    Schema.Struct({
      actualStartTime: OptionalTime,
      scheduledStartTime: OptionalTime,
      actualEndTime: OptionalTime,
      // Only while the stream is live. The API sends it as a string.
      concurrentViewers: Schema.optional(Schema.FiniteFromString),
    }),
  ),
});

export type VideoDetails = typeof VideoDetails.Type;

export const videoUrl = (videoId: string) =>
  `https://www.youtube.com/watch?v=${videoId}`;

export const channelUrl = (channelId: string) =>
  `https://www.youtube.com/channel/${channelId}`;

export const thumbnailUrl = (videoId: string) =>
  `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

const videoIdPattern = /^[\w-]{11}$/;

const youtubeHosts = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
];

// The video ID in a watch, youtu.be, shorts, live or embed URL.
export const videoIdFromUrl = (url: string): Option.Option<string> =>
  Option.flatMap(Option.liftThrowable(() => new URL(url))(), (parsed) => {
    const segments = Arr.filter(
      Str.split(parsed.pathname, "/"),
      Str.isNonEmpty,
    );

    const candidate =
      parsed.hostname === "youtu.be"
        ? Arr.head(segments)
        : Arr.contains(youtubeHosts, parsed.hostname)
          ? Option.orElse(
              Option.fromNullishOr(parsed.searchParams.get("v")),
              () =>
                Option.flatMap(Arr.head(segments), (first) =>
                  Arr.contains(["shorts", "live", "embed"], first)
                    ? Arr.get(segments, 1)
                    : Option.none(),
                ),
            )
          : Option.none();

    return Option.filter(candidate, (id) => videoIdPattern.test(id));
  });

const kindOf = (details: VideoDetails): MediaKind => {
  switch (details.snippet.liveBroadcastContent) {
    case "live":
      return "live";
    case "upcoming":
      return "upcoming";
    default:
      return "upload";
  }
};

// Without details, every entry counts as an upload. Live streams use their
// start time and upcoming ones their scheduled time.
export const toMediaItem = (
  entry: FeedEntry,
  details: Option.Option<VideoDetails>,
): MediaItem => {
  const kind = Option.match(details, {
    onNone: (): MediaKind => "upload",
    onSome: kindOf,
  });

  const stream = Option.flatMap(details, ({ liveStreamingDetails }) =>
    Option.fromUndefinedOr(liveStreamingDetails),
  );

  const streamTime = Option.flatMap(stream, (value) => {
    switch (kind) {
      case "live":
        return Option.fromUndefinedOr(value.actualStartTime);
      case "upcoming":
        return Option.fromUndefinedOr(value.scheduledStartTime);
      default:
        return Option.none();
    }
  });

  return {
    id: `youtube:${entry.videoId}`,
    source: "youtube",
    kind,
    title: Option.match(details, {
      onNone: () => entry.title,
      onSome: ({ snippet }) => snippet.title,
    }),
    url: videoUrl(entry.videoId),
    channel: {
      id: entry.channelId,
      name: entry.channelName,
      url: channelUrl(entry.channelId),
    },
    thumbnailUrl: thumbnailUrl(entry.videoId),
    publishedAt: Option.getOrElse(streamTime, () => entry.publishedAt),
    ...Option.match(
      Option.flatMap(stream, ({ concurrentViewers }) =>
        kind === "live"
          ? Option.fromUndefinedOr(concurrentViewers)
          : Option.none(),
      ),
      {
        onNone: () => ({}),
        onSome: (viewers) => ({ viewers }),
      },
    ),
  };
};
