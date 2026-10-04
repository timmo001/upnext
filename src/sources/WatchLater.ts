import {
  Array as Arr,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  String as Str,
} from "effect";
import { HttpClient } from "effect/http";
import type { MediaItem } from "@timmo001/effect-upnext-shared";
import {
  make as makeYouTubeClient,
  thumbnailUrl,
  videoIdFromUrl,
  videoUrl,
} from "@timmo001/effect-youtube";
import {
  type FeedItem,
  ItemNotFound,
  SourceError,
} from "@timmo001/effect-upnext";
import { FeedStore } from "../feed/Feed.js";
import { UpnextState } from "../state/State.js";

// Enough to hide anything still in a channel's feed.
const maxWatched = 500;

const toFeedItem = (item: MediaItem): FeedItem => ({
  item,
  tracked: true,
  autoOpen: false,
});

const parseUrl = (value: string) =>
  Option.filter(
    Option.liftThrowable(() => new URL(Str.trim(value)))(),
    ({ protocol }) => protocol === "http:" || protocol === "https:",
  );

export interface WatchLaterService {
  // Saves a URL. Saving one that's already saved returns the saved item.
  readonly add: (
    url: string,
    title: Option.Option<string>,
  ) => Effect.Effect<FeedItem, SourceError>;
  // Removes a saved item, and hides a YouTube video from the feed for good.
  readonly markWatched: (id: string) => Effect.Effect<void, ItemNotFound>;
}

export class WatchLater extends Context.Service<
  WatchLater,
  WatchLaterService
>()("WatchLater") {
  static readonly layer = Layer.effect(
    WatchLater,
    Effect.gen(function* () {
      const state = yield* UpnextState;
      const feed = yield* FeedStore;
      const http = yield* HttpClient.HttpClient;

      // oEmbed needs no API key.
      const youtube = yield* makeYouTubeClient({ apiKey: Option.none() }).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      );

      const saved = Effect.map(state.get, (current) => current.saved ?? []);

      const publish = Effect.flatMap(saved, (items) =>
        feed.setSaved(Arr.map(items, toFeedItem)),
      );

      yield* publish;

      const youtubeItem = Effect.fn("WatchLater.youtubeItem")(function* (
        videoId: string,
        title: Option.Option<string>,
        savedAt: DateTime.Utc,
      ) {
        const url = videoUrl(videoId);

        const details = yield* youtube.oembed(url).pipe(
          Effect.asSome,
          Effect.catch((error) =>
            Effect.logWarning("Couldn't look up the video", error.message).pipe(
              Effect.as(Option.none()),
            ),
          ),
        );

        return {
          id: `youtube:${videoId}`,
          source: "youtube",
          kind: "saved",
          title: Option.getOrElse(
            Option.orElse(title, () =>
              Option.map(details, (value) => value.title),
            ),
            () => url,
          ),
          url,
          ...Option.match(details, {
            onNone: () => ({}),
            onSome: (value) => ({
              channel: {
                id: value.author_url,
                name: value.author_name,
                url: value.author_url,
              },
            }),
          }),
          thumbnailUrl: thumbnailUrl(videoId),
          publishedAt: savedAt,
        } satisfies MediaItem;
      });

      const add = Effect.fn("WatchLater.add")(function* (
        value: string,
        title: Option.Option<string>,
      ) {
        const url = yield* Effect.fromOption(parseUrl(value)).pipe(
          Effect.mapError(
            () =>
              new SourceError({
                source: "link",
                message: `${value} isn't a web address`,
              }),
          ),
        );

        const wantedTitle = Option.filter(
          Option.map(title, Str.trim),
          Str.isNonEmpty,
        );

        const videoId = videoIdFromUrl(url.href);

        const existing = Arr.findFirst(yield* saved, (item) =>
          Option.match(videoId, {
            onNone: () => item.url === url.href,
            onSome: (id) => item.id === `youtube:${id}`,
          }),
        );

        if (Option.isSome(existing)) {
          return toFeedItem(existing.value);
        }

        const now = yield* DateTime.now;

        const item = yield* Option.match(videoId, {
          onNone: () =>
            Effect.succeed<MediaItem>({
              id: `link:${crypto.randomUUID()}`,
              source: "link",
              kind: "saved",
              title: Option.getOrElse(wantedTitle, () => url.href),
              url: url.href,
              publishedAt: now,
            }),
          onSome: (id) => youtubeItem(id, wantedTitle, now),
        });

        yield* state
          .update((current) => ({
            ...current,
            saved: Arr.append(current.saved ?? [], item),
          }))
          .pipe(
            Effect.mapError(
              (error) =>
                new SourceError({
                  source: item.source,
                  message: error.message,
                }),
            ),
          );

        yield* publish;

        return toFeedItem(item);
      });

      const markWatched = Effect.fn("WatchLater.markWatched")(function* (
        id: string,
      ) {
        const isSaved = Arr.some(yield* saved, (item) => item.id === id);

        const inFeed = Arr.some(
          (yield* feed.get).items,
          ({ item }) => item.id === id,
        );

        const isYouTube = Str.startsWith("youtube:")(id);

        if (!isSaved && !(isYouTube && inFeed)) {
          return yield* new ItemNotFound({ id });
        }

        yield* state
          .update((current) => ({
            ...current,
            saved: Arr.filter(current.saved ?? [], (item) => item.id !== id),
            watched: isYouTube
              ? Arr.takeRight(
                  Arr.append(
                    Arr.filter(current.watched ?? [], (seen) => seen !== id),
                    id,
                  ),
                  maxWatched,
                )
              : (current.watched ?? []),
          }))
          .pipe(Effect.orDie);

        yield* feed.remove(id);
        yield* publish;
      });

      return WatchLater.of({ add, markWatched });
    }),
  );
}
