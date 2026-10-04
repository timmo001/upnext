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

const publishedMillis = ({ item }: FeedItem) =>
  Option.match(Option.fromUndefinedOr(item.publishedAt), {
    onNone: () => 0,
    onSome: DateTime.toEpochMillis,
  });

const feedOrder: Order.Order<FeedItem> = Order.combine(
  Order.mapInput(Order.Number, ({ item }: FeedItem) => kindRank[item.kind]),
  Order.mapInput(Order.flip(Order.Number), publishedMillis),
);

const sourceOrder = Order.mapInput(
  Order.String,
  ({ source }: SourceStatus) => source,
);

const isFrom =
  (source: SourceStatus["source"]) =>
  ({ item }: FeedItem) =>
    item.source === source;

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
  items: Arr.sort(
    Arr.appendAll(
      Arr.filter(feed.items, (feedItem) => !isFrom(status.source)(feedItem)),
      items,
    ),
    feedOrder,
  ),
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
      });
    }),
  );
}
