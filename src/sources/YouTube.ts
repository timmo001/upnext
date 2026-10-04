import {
  Array as Arr,
  DateTime,
  Duration,
  Effect,
  HashMap,
  HashSet,
  Layer,
  Context,
  Option,
  Queue,
  Ref,
  Result,
  Semaphore,
  Stream,
  String as Str,
} from "effect";
import { HttpClient } from "effect/http";
import type { MediaKind } from "@timmo001/effect-upnext-shared";
import {
  type FeedEntry,
  make as makeYouTubeClient,
  toMediaItem,
  type VideoDetails,
} from "@timmo001/effect-youtube";
import {
  type FeedItem,
  SourceError,
  type SourceStatus,
} from "@timmo001/effect-upnext";
import { UpnextConfig } from "../config/Config.js";
import { Desktop } from "../desktop/Desktop.js";
import { FeedStore } from "../feed/Feed.js";
import { UpnextState } from "../state/State.js";
import { wakeups } from "./wakeups.js";

// Uploads older than this drop out of the feed.
const uploadWindow = Duration.days(7);

const feedConcurrency = 4;

const noApiKey = "Set youtube.api_key to see live and upcoming streams";

const noChannels = "Add YouTube channels to channels.yml";

const youtubeError = (message: string) =>
  new SourceError({ source: "youtube", message });

// Accepts a channel ID or a /channel/<ID> URL.
const channelIdFrom = (value: string) => {
  const trimmed = Str.trim(value);

  return Option.getOrElse(
    Option.flatMap(
      Option.fromNullishOr(/\/channel\/([\w-]+)/.exec(trimmed)),
      (match) => Option.fromNullishOr(match[1]),
    ),
    () => trimmed,
  );
};

export interface YouTubeSourceService {
  // Checks now. With `open`, opens every live stream set to auto-open.
  readonly recheck: (open: boolean) => Effect.Effect<void, SourceError>;
  readonly addChannel: (
    id: string,
    open: Option.Option<boolean>,
  ) => Effect.Effect<void, SourceError>;
  readonly removeChannel: (id: string) => Effect.Effect<void, SourceError>;
}

export class YouTubeSource extends Context.Service<
  YouTubeSource,
  YouTubeSourceService
>()("YouTubeSource") {
  static readonly layer = Layer.effect(
    YouTubeSource,
    Effect.gen(function* () {
      const config = yield* UpnextConfig;
      const state = yield* UpnextState;
      const feed = yield* FeedStore;
      const desktop = yield* Desktop;
      const http = yield* HttpClient.HttpClient;
      const provideHttp = Effect.provideService(HttpClient.HttpClient, http);

      const checking = yield* Semaphore.make(1);
      const trigger = yield* Queue.sliding<void>(1);
      // False until the first check, which counts as startup.
      const started = yield* Ref.make(false);

      // Channels read at least once. A channel's first read isn't announced,
      // so adding one doesn't announce a week of uploads.
      const knownChannels = yield* Ref.make(HashSet.empty<string>());

      const announce = ({ item }: FeedItem) =>
        desktop.notify({
          title:
            item.kind === "live"
              ? `${item.channel?.name ?? "A channel"} is live`
              : `New from ${item.channel?.name ?? "YouTube"}`,
          body: item.title,
          url: item.url,
          sound: true,
        });

      const check = (open: boolean) =>
        Effect.gen(function* () {
          const settings = yield* config.settings;
          const channels = (yield* config.channels).youtube;
          const now = yield* DateTime.now;

          if (Arr.isReadonlyArrayEmpty(channels)) {
            yield* feed.setSource(
              {
                source: "youtube",
                state: "disabled",
                message: noChannels,
                checkedAt: now,
              },
              [],
            );

            return;
          }

          const client = yield* makeYouTubeClient({
            apiKey: settings.youtube.apiKey,
          }).pipe(provideHttp);

          const watched = HashSet.fromIterable(
            (yield* state.get).watched ?? [],
          );

          const before = Arr.filter(
            (yield* feed.get).items,
            ({ item }) => item.source === "youtube",
          );

          const results = yield* Effect.forEach(
            channels,
            (channel) =>
              client.channelFeed(channel.id).pipe(
                Effect.map((entries) => ({ channel, entries })),
                Effect.result,
              ),
            { concurrency: feedConcurrency },
          );

          const failures = Arr.getFailures(results);
          const feeds = Arr.getSuccesses(results);

          const entries = Arr.filter(
            Arr.flatMap(feeds, ({ entries }) => entries),
            ({ videoId }) => !HashSet.has(watched, `youtube:${videoId}`),
          );

          const details = client.hasApiKey
            ? yield* client
                .videos(Arr.map(entries, ({ videoId }) => videoId))
                .pipe(Effect.result)
            : Result.succeed<ReadonlyArray<VideoDetails>>([]);

          const byId = HashMap.fromIterable(
            Arr.map(
              Result.getOrElse(details, () => []),
              (video) => [video.id, video] as const,
            ),
          );

          const openByChannel = HashMap.fromIterable(
            Arr.map(channels, ({ id, open }) => [id, open] as const),
          );

          const cutoff = DateTime.subtractDuration(now, uploadWindow);

          const fetched = Arr.filterMap(entries, (entry: FeedEntry) => {
            const item = toMediaItem(entry, HashMap.get(byId, entry.videoId));

            const recent =
              item.kind !== "upload" ||
              DateTime.isGreaterThanOrEqualTo(entry.publishedAt, cutoff);

            return recent
              ? Result.succeed<FeedItem>({
                  item,
                  tracked: true,
                  autoOpen: Option.getOrElse(
                    HashMap.get(openByChannel, entry.channelId),
                    () => false,
                  ),
                })
              : Result.failVoid;
          });

          // A channel that failed this time keeps what it had, so its
          // uploads don't come back as new next time.
          const failedChannels = HashSet.fromIterable(
            Arr.filterMap(results, (result, index) =>
              Result.isFailure(result)
                ? Result.fromOption(
                    Option.map(Arr.get(channels, index), ({ id }) => id),
                    () => undefined,
                  )
                : Result.failVoid,
            ),
          );

          const kept = Arr.filter(before, ({ item }) =>
            HashSet.has(failedChannels, item.channel?.id ?? ""),
          );

          const items = Arr.appendAll(fetched, kept);

          const status: SourceStatus = Arr.match(failures, {
            onEmpty: () =>
              Result.isFailure(details)
                ? {
                    source: "youtube",
                    state: "error",
                    message: details.failure.message,
                    checkedAt: now,
                  }
                : client.hasApiKey
                  ? { source: "youtube", state: "ok", checkedAt: now }
                  : {
                      source: "youtube",
                      state: "ok",
                      message: noApiKey,
                      checkedAt: now,
                    },
            onNonEmpty: ([first]) => ({
              source: "youtube",
              state: "error",
              message: `Couldn't read ${failures.length} of ${channels.length} channels: ${first.message}`,
              checkedAt: now,
            }),
          });

          const previousKind = HashMap.fromIterable(
            Arr.map(before, ({ item }) => [item.id, item.kind] as const),
          );

          yield* feed.setSource(status, items);

          const startup = !(yield* Ref.getAndSet(started, true));

          const known = yield* Ref.getAndUpdate(knownChannels, (set) =>
            HashSet.union(
              set,
              HashSet.fromIterable(Arr.map(feeds, ({ channel }) => channel.id)),
            ),
          );

          // New items, and upcoming streams that have just gone live.
          const fresh = Arr.filter(fetched, ({ item }) =>
            Option.match(HashMap.get(previousKind, item.id), {
              onNone: () =>
                startup || HashSet.has(known, item.channel?.id ?? ""),
              onSome: (kind: MediaKind) =>
                item.kind === "live" && kind !== "live",
            }),
          );

          const isLive = ({ item }: FeedItem) => item.kind === "live";

          // At startup a week of uploads is new, so only live streams are
          // announced, and only when notify_on_startup is set.
          const toAnnounce = startup
            ? settings.notifyOnStartup
              ? Arr.filter(fresh, isLive)
              : []
            : Arr.filter(fresh, ({ item }) => item.kind !== "upcoming");

          const toOpen = Arr.filter(
            open ? items : startup ? [] : fresh,
            (feedItem) => feedItem.autoOpen && isLive(feedItem),
          );

          yield* Effect.forEach(toAnnounce, announce, { discard: true });

          yield* Effect.forEach(toOpen, ({ item }) => desktop.open(item.url), {
            discard: true,
          });
        }).pipe(
          Effect.catchTags({
            ConfigError: (error) =>
              Effect.flatMap(DateTime.now, (checkedAt) =>
                feed.setStatus({
                  source: "youtube",
                  state: "error",
                  message: error.message,
                  checkedAt,
                }),
              ),
          }),
          Semaphore.withPermit(checking),
          Effect.withSpan("YouTubeSource.check"),
        );

      const requestCheck = Queue.offer(trigger, undefined).pipe(Effect.asVoid);

      // Checks, then waits for the poll interval or something that wants a
      // check sooner, such as a channel change or waking from sleep.
      yield* Effect.gen(function* () {
        yield* check(false);
        const { youtube } = yield* config.settings;

        yield* Queue.take(trigger).pipe(
          Effect.timeoutOrElse({
            duration: youtube.pollInterval,
            orElse: () => Effect.void,
          }),
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("YouTube check failed", cause).pipe(
            Effect.andThen(Effect.sleep(Duration.minutes(1))),
          ),
        ),
        Effect.forever,
        Effect.forkScoped,
      );

      yield* wakeups.pipe(
        Stream.runForEach(() => requestCheck),
        Effect.forkScoped,
      );

      const toSourceError = (error: { readonly message: string }) =>
        youtubeError(error.message);

      const addChannel = Effect.fn("YouTubeSource.addChannel")(function* (
        value: string,
        open: Option.Option<boolean>,
      ) {
        const id = channelIdFrom(value);

        const settings = yield* config.settings.pipe(
          Effect.mapError(toSourceError),
        );

        const client = yield* makeYouTubeClient({
          apiKey: settings.youtube.apiKey,
        }).pipe(provideHttp);

        yield* client
          .channelFeed(id)
          .pipe(
            Effect.mapError((error) =>
              youtubeError(
                error.status === 404
                  ? `There's no YouTube channel with the ID ${id}. Use the ID that starts with UC, not a handle.`
                  : error.message,
              ),
            ),
          );

        yield* config
          .updateChannels((channels) =>
            Effect.succeed({
              ...channels,
              youtube: Option.match(
                Arr.findFirstIndex(
                  channels.youtube,
                  (channel) => channel.id === id,
                ),
                {
                  onNone: () =>
                    Arr.append(channels.youtube, {
                      id,
                      open: Option.getOrElse(open, () => false),
                    }),
                  onSome: (index) =>
                    Arr.map(channels.youtube, (channel, at) =>
                      at === index
                        ? {
                            ...channel,
                            open: Option.getOrElse(open, () => channel.open),
                          }
                        : channel,
                    ),
                },
              ),
            }),
          )
          .pipe(Effect.mapError(toSourceError));

        yield* requestCheck;
      });

      const removeChannel = Effect.fn("YouTubeSource.removeChannel")(function* (
        value: string,
      ) {
        const id = channelIdFrom(value);

        yield* config
          .updateChannels((channels) => {
            const youtube = Arr.filter(
              channels.youtube,
              (channel) => channel.id !== id,
            );

            return youtube.length === channels.youtube.length
              ? Effect.fail(youtubeError(`${id} isn't in channels.yml`))
              : Effect.succeed({ ...channels, youtube });
          })
          .pipe(Effect.mapError(toSourceError));

        yield* requestCheck;
      });

      return YouTubeSource.of({
        recheck: check,
        addChannel,
        removeChannel,
      });
    }),
  );
}
