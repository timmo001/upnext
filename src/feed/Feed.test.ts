import { describe, expect, test } from "bun:test";
import type { FeedItem } from "@timmo001/effect-upnext";
import type { MediaItem } from "@timmo001/effect-upnext-shared";
import { replaceSource } from "./Feed.js";

const live = (
  id: string,
  source: MediaItem["source"],
  extra: {
    readonly tracked?: boolean;
    readonly position?: number;
    readonly viewers?: number;
  },
): FeedItem => {
  const item: MediaItem = {
    id,
    source,
    kind: "live",
    title: id,
    url: `https://example.com/${id}`,
    viewers: extra.viewers,
  };

  return {
    item,
    tracked: extra.tracked ?? false,
    position: extra.position,
    autoOpen: false,
  };
};

describe("replaceSource", () => {
  test("orders tracked live channels by source and position, then the rest by viewers", () => {
    const withYouTube = replaceSource(
      { sources: [], items: [] },
      { source: "youtube", state: "ok" },
      [
        live("youtube-other", "youtube", { viewers: 500 }),
        live("youtube-second", "youtube", { tracked: true, position: 1 }),
        live("youtube-first", "youtube", { tracked: true, position: 0 }),
      ],
    );

    const feed = replaceSource(withYouTube, { source: "twitch", state: "ok" }, [
      live("twitch-busy", "twitch", { viewers: 9000 }),
      live("twitch-quiet", "twitch", { viewers: 20 }),
      live("twitch-second", "twitch", {
        tracked: true,
        position: 1,
        viewers: 1,
      }),
      live("twitch-first", "twitch", {
        tracked: true,
        position: 0,
        viewers: 1,
      }),
    ]);

    expect(feed.items.map(({ item }) => item.id)).toEqual([
      "twitch-first",
      "twitch-second",
      "youtube-first",
      "youtube-second",
      "twitch-busy",
      "youtube-other",
      "twitch-quiet",
    ]);
  });
});
