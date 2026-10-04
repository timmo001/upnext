import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  SynchronizedRef,
} from "effect";
import { MediaItem } from "@timmo001/effect-upnext-shared";
import { resolvePaths, writePrivate } from "../config/Config.js";

export class StateError extends Schema.TaggedError<StateError>()("StateError", {
  message: Schema.String,
}) {}

// What the daemon writes for itself, kept apart from the files you edit.
export const State = Schema.Struct({
  twitch: Schema.optional(
    Schema.Struct({
      accessToken: Schema.optional(Schema.String),
      refreshToken: Schema.optional(Schema.String),
    }),
  ),
  // Item IDs marked watched.
  watched: Schema.optional(Schema.Array(Schema.String)),
  // Items saved to watch later.
  saved: Schema.optional(Schema.Array(MediaItem)),
});

export type State = typeof State.Type;

const StateJson = Schema.fromJsonString(Schema.toCodecJson(State));

export const readState = Effect.fn("readState")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(file))) {
    return {} satisfies State;
  }

  return yield* Schema.decodeEffect(StateJson)(yield* fs.readFileString(file));
});

export const writeState = Effect.fn("writeState")(function* (
  file: string,
  state: State,
) {
  yield* writePrivate(
    file,
    `${yield* Schema.encodeEffect(StateJson)(state)}\n`,
  );
});

export interface UpnextStateService {
  readonly get: Effect.Effect<State>;
  readonly update: (
    f: (state: State) => State,
  ) => Effect.Effect<void, StateError>;
}

export class UpnextState extends Context.Service<
  UpnextState,
  UpnextStateService
>()("UpnextState") {
  static readonly layer = Layer.effect(
    UpnextState,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateFile } = yield* resolvePaths();

      const ref = yield* readState(stateFile).pipe(
        Effect.mapError(
          (cause) =>
            new StateError({ message: `read ${stateFile}: ${cause.message}` }),
        ),
        Effect.flatMap(SynchronizedRef.make),
      );

      // Writes happen inside the ref's lock, so the file matches memory.
      const update = (f: (state: State) => State) =>
        SynchronizedRef.updateEffect(ref, (state) => {
          const next = f(state);

          return writeState(stateFile, next).pipe(Effect.as(next));
        }).pipe(
          Effect.mapError(
            (cause) =>
              new StateError({
                message: `write ${stateFile}: ${cause.message}`,
              }),
          ),
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.withSpan("UpnextState.update"),
        );

      return UpnextState.of({ get: SynchronizedRef.get(ref), update });
    }),
  );
}
