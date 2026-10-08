import { DateTime, Duration, Effect, Option, String as Str } from "effect";

// Minutes after local midnight. The window runs past midnight when start is
// later than end.
export interface QuietHours {
  readonly start: number;
  readonly end: number;
}

const timeOfDay = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// Reads an HH:MM time as minutes after midnight.
export const parseTimeOfDay = (value: string) =>
  Option.map(
    Option.fromNullishOr(timeOfDay.exec(Str.trim(value))),
    (match) => Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0),
  );

const minuteMillis = 60_000;

const dayMillis = 24 * 60 * minuteMillis;

// How long to wait before the next check, `millisOfDay` after local
// midnight. Quiet hours use the quiet interval, and a wait never runs past
// where they start or end.
export const pollDelayAt = (
  quietHours: Option.Option<QuietHours>,
  interval: Duration.Duration,
  quietInterval: Duration.Duration,
  millisOfDay: number,
) =>
  Option.match(quietHours, {
    onNone: () => interval,
    onSome: ({ start, end }) => {
      const startAt = start * minuteMillis;
      const endAt = end * minuteMillis;

      const quiet =
        startAt < endAt
          ? millisOfDay >= startAt && millisOfDay < endAt
          : millisOfDay >= startAt || millisOfDay < endAt;

      const untilChange =
        ((quiet ? endAt : startAt) - millisOfDay + dayMillis) % dayMillis;

      return Duration.min(
        quiet ? quietInterval : interval,
        Duration.millis(untilChange),
      );
    },
  });

export const pollDelay = Effect.fn("pollDelay")(function* (
  quietHours: Option.Option<QuietHours>,
  interval: Duration.Duration,
  quietInterval: Duration.Duration,
) {
  const { hour, minute, second, millisecond } = DateTime.toParts(
    DateTime.setZone(yield* DateTime.now, DateTime.zoneMakeLocal()),
  );

  return pollDelayAt(
    quietHours,
    interval,
    quietInterval,
    ((hour * 60 + minute) * 60 + second) * 1000 + millisecond,
  );
});
