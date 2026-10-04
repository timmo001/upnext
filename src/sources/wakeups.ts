import {
  DateTime,
  Duration,
  Effect,
  Filter,
  Option,
  Ref,
  Stream,
} from "effect";

const interval = Duration.seconds(30);

const allowedDrift = Duration.minutes(2);

const overdue = (previous: DateTime.Utc, current: DateTime.Utc) =>
  Option.liftPredicate(
    Duration.millis(
      DateTime.toEpochMillis(current) -
        DateTime.toEpochMillis(previous) -
        Duration.toMillis(interval),
    ),
    Duration.isGreaterThan(allowedDrift),
  );

// Emits how far behind a tick was. A tick that runs minutes late means the
// machine slept, and sockets opened before then are usually dead.
export const wakeups: Stream.Stream<Duration.Duration> = Stream.unwrap(
  Effect.gen(function* () {
    const last = yield* Ref.make(yield* DateTime.now);

    return Stream.tick(interval).pipe(
      Stream.mapEffect(() =>
        Effect.flatMap(DateTime.now, (now) =>
          Effect.map(Ref.getAndSet(last, now), (previous) =>
            overdue(previous, now),
          ),
        ),
      ),
      Stream.filterMap(Filter.fromPredicateOption((gap) => gap)),
      Stream.tap((gap) => Effect.logInfo("Woke from sleep", gap)),
    );
  }),
);
