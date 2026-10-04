import {
  Array as Arr,
  Context,
  DateTime,
  Effect,
  HashSet,
  Layer,
  Option,
  Order,
  SubscriptionRef,
} from "effect";
import type { Stream } from "effect";
import type { MediaKind } from "@timmo001/effect-upnext-shared";
import type { Feed, FeedItem, SourceStatus } from "@timmo001/effect-upnext";

const kindRank: Record<MediaKind, number> = {
  live: 0,
  upcoming: 1,
  upload: 2,
  saved: 3,
};

const sourceRank: Record<FeedItem["item"]["source"], number> = {
  twitch: 0,
  youtube: 1,
  link: 2,
};

const publishedMillis = ({ item }: FeedItem) =>
  Option.match(Option.fromUndefinedOr(item.publishedAt), {
    onNone: () => 0,
    onSome: DateTime.toEpochMillis,
  });

const isLive = ({ item }: FeedItem) => item.kind === "live";

// Orders live items only; every other pair compares equal here.
const liveOrder = (rank: (feedItem: FeedItem) => number) =>
  Order.mapInput(Order.Number, (feedItem: FeedItem) =>
    isLive(feedItem) ? rank(feedItem) : 0,
  );

const feedOrder: Order.Order<FeedItem> = Order.combineAll([
  Order.mapInput(Order.Number, ({ item }: FeedItem) => kindRank[item.kind]),
  liveOrder(({ tracked }) => (tracked ? 0 : 1)),
  liveOrder(({ item, tracked }) => (tracked ? sourceRank[item.source] : 0)),
  liveOrder(({ position, tracked }) => (tracked ? (position ?? 0) : 0)),
  liveOrder(({ item, tracked }) => (tracked ? 0 : -(item.viewers ?? 0))),
  Order.mapInput(Order.flip(Order.Number), publishedMillis),
]);

const sourceOrder = Order.mapInput(
  Order.String,
  ({ source }: SourceStatus) => source,
);

const isSaved = ({ item }: FeedItem) => item.kind === "saved";

// Saved items belong to the watch-later queue, whatever their source.
const isFrom = (source: SourceStatus["source"]) => (feedItem: FeedItem) =>
  feedItem.item.source === source && !isSaved(feedItem);

// Sorts the feed. A saved video that's also a recent upload shows once, as
// the upload.
const sortItems = (items: ReadonlyArray<FeedItem>) =>
  Arr.dedupeWith(
    Arr.sort(items, feedOrder),
    (a: FeedItem, b: FeedItem) => a.item.id === b.item.id,
  );

const replaceItems = (
  feed: Feed,
  belongs: (feedItem: FeedItem) => boolean,
  items: ReadonlyArray<FeedItem>,
) =>
  sortItems(
    Arr.appendAll(
      Arr.filter(feed.items, (feedItem) => !belongs(feedItem)),
      items,
    ),
  );

// Replaces one source's status and items, leaving the other sources alone.
export const replaceSource = (
  feed: Feed,
  status: SourceStatus,
  items: ReadonlyArray<FeedItem>,
): Feed => ({
  sources: Arr.sort(
    Arr.append(
      Arr.filter(feed.sources, ({ source }) => source !== status.source),
      status,
    ),
    sourceOrder,
  ),
  items: replaceItems(feed, isFrom(status.source), items),
});

export interface FeedStoreService {
  readonly get: Effect.Effect<Feed>;
  // The current feed, then each change.
  readonly changes: Stream.Stream<Feed>;
  // Replaces the source's slice and returns the items that weren't in it
  // before, so notifications and auto-open happen in one place.
  readonly setSource: (
    status: SourceStatus,
    items: ReadonlyArray<FeedItem>,
  ) => Effect.Effect<ReadonlyArray<FeedItem>>;
  // Replaces the source's status and keeps its items, such as after a
  // failed check.
  readonly setStatus: (status: SourceStatus) => Effect.Effect<void>;
  // Replaces the watch-later queue.
  readonly setSaved: (items: ReadonlyArray<FeedItem>) => Effect.Effect<void>;
  // Drops an item straight away, such as one marked watched.
  readonly remove: (ids: ReadonlyArray<string>) => Effect.Effect<void>;
}

export class FeedStore extends Context.Service<FeedStore, FeedStoreService>()(
  "FeedStore",
) {
  static readonly layer = Layer.effect(
    FeedStore,
    Effect.gen(function* () {
      const ref = yield* SubscriptionRef.make<Feed>({ sources: [], items: [] });

      return FeedStore.of({
        get: SubscriptionRef.get(ref),
        changes: SubscriptionRef.changes(ref),
        setSource: (status, items) =>
          SubscriptionRef.modify(ref, (feed) => {
            const before = HashSet.fromIterable(
              Arr.map(
                Arr.filter(feed.items, isFrom(status.source)),
                ({ item }) => item.id,
              ),
            );

            return [
              Arr.filter(items, ({ item }) => !HashSet.has(before, item.id)),
              replaceSource(feed, status, items),
            ];
          }).pipe(Effect.withSpan("FeedStore.setSource")),
        setStatus: (status) =>
          SubscriptionRef.update(ref, (feed) =>
            replaceSource(
              feed,
              status,
              Arr.filter(feed.items, isFrom(status.source)),
            ),
          ).pipe(Effect.withSpan("FeedStore.setStatus")),
        setSaved: (items) =>
          SubscriptionRef.update(ref, (feed) => ({
            ...feed,
            items: replaceItems(feed, isSaved, items),
          })),
        remove: (ids) => {
          const removed = HashSet.fromIterable(ids);

          return SubscriptionRef.update(ref, (feed) => ({
            ...feed,
            items: Arr.filter(
              feed.items,
              ({ item }) => !HashSet.has(removed, item.id),
            ),
          }));
        },
      });
    }),
  );
}
