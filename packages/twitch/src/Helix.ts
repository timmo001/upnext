import { Option, Schema, String as Str } from "effect";
import type { MediaItem } from "@timmo001/effect-upnext-shared";

export const TwitchUser = Schema.Struct({
  id: Schema.String,
  login: Schema.String,
  display_name: Schema.String,
});

export type TwitchUser = typeof TwitchUser.Type;

export const TwitchStream = Schema.Struct({
  id: Schema.String,
  user_id: Schema.String,
  user_login: Schema.String,
  user_name: Schema.String,
  game_name: Schema.String,
  title: Schema.String,
  started_at: Schema.DateTimeUtcFromString,
  thumbnail_url: Schema.String,
  viewer_count: Schema.Finite,
});

export type TwitchStream = typeof TwitchStream.Type;

export const channelUrl = (login: string) =>
  `https://www.twitch.tv/${Str.toLowerCase(login)}`;

const thumbnailSize = { width: "440", height: "248" };

// Live streams use the channel login as their ID, so a stream that drops and
// comes back stays the same item.
export const toMediaItem = (stream: TwitchStream): MediaItem => {
  const url = channelUrl(stream.user_login);

  return {
    id: `twitch:${Str.toLowerCase(stream.user_login)}`,
    source: "twitch",
    kind: "live",
    title: stream.title,
    url,
    channel: { id: stream.user_id, name: stream.user_name, url },
    thumbnailUrl: stream.thumbnail_url
      .replace("{width}", thumbnailSize.width)
      .replace("{height}", thumbnailSize.height),
    ...Option.match(
      Option.liftPredicate(Str.trim(stream.game_name), Str.isNonEmpty),
      {
        onNone: () => ({}),
        onSome: (category) => ({ category }),
      },
    ),
    publishedAt: stream.started_at,
    viewers: stream.viewer_count,
  };
};
