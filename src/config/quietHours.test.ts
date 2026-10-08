import { describe, expect, test } from "bun:test";
import { Duration, Option } from "effect";
import { parseTimeOfDay, pollDelayAt } from "./quietHours.js";

const interval = Duration.minutes(10);

const quietInterval = Duration.minutes(30);

const at = (time: string) => Option.getOrThrow(parseTimeOfDay(time)) * 60_000;

const delay = (start: string, end: string, time: string) =>
  Duration.toMinutes(
    pollDelayAt(
      Option.some({
        start: Option.getOrThrow(parseTimeOfDay(start)),
        end: Option.getOrThrow(parseTimeOfDay(end)),
      }),
      interval,
      quietInterval,
      at(time),
    ),
  );

describe("pollDelayAt", () => {
  test("uses the quiet interval inside a window that runs past midnight", () => {
    expect(delay("23:00", "08:00", "23:30")).toBe(30);
    expect(delay("23:00", "08:00", "03:00")).toBe(30);
    expect(delay("23:00", "08:00", "12:00")).toBe(10);
  });

  test("doesn't wait past where quiet hours start or end", () => {
    expect(delay("00:00", "08:00", "07:50")).toBe(10);
    expect(delay("00:00", "08:00", "23:55")).toBe(5);
  });

  test("starts inclusive and ends exclusive", () => {
    expect(delay("00:00", "08:00", "00:00")).toBe(30);
    expect(delay("00:00", "08:00", "08:00")).toBe(10);
  });
});

describe("parseTimeOfDay", () => {
  test("rejects times that aren't HH:MM", () => {
    expect(Option.isNone(parseTimeOfDay("24:00"))).toBe(true);
    expect(Option.isNone(parseTimeOfDay("8am"))).toBe(true);
    expect(parseTimeOfDay(" 7:05 ")).toEqual(Option.some(425));
  });
});
