import {
  Array as Arr,
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  PubSub,
  Ref,
  Schema,
  Stream,
  Struct,
  SynchronizedRef,
} from "effect";
import { MediaItem } from "@timmo001/effect-upnext-shared";
import { resolvePaths, writePrivate } from "../config/Config.js";

export class StateError extends Schema.TaggedError<StateError>()("StateError", {
  message: Schema.String,
}) {}

const tokenFields = {
  twitch: Schema.optional(
    Schema.Struct({
      accessToken: Schema.optional(Schema.String),
      refreshToken: Schema.optional(Schema.String),
    }),
  ),
  youtube: Schema.optional(
    Schema.Struct({
      refreshToken: Schema.optional(Schema.String),
    }),
  ),
};

const libraryFields = {
  // Item IDs marked watched.
  watched: Schema.optional(Schema.Array(Schema.String)),
  // Items saved to watch later.
  saved: Schema.optional(Schema.Array(MediaItem)),
};

// What the daemon writes for itself, kept apart from the files you edit.
// Tokens stay in state.json on each machine. The library (watched and saved)
// has its own file, so it can be synced between machines.
export const State = Schema.Struct({ ...tokenFields, ...libraryFields });

export type State = typeof State.Type;

export const Library = Schema.Struct(libraryFields);

export type Library = typeof Library.Type;

const StateJson = Schema.fromJsonString(Schema.toCodecJson(State));

const LibraryJson = Schema.fromJsonString(Schema.toCodecJson(Library));

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

const encodeLibrary = (state: State) =>
  Schema.encodeEffect(LibraryJson)(Struct.pick(state, ["watched", "saved"]));

// The library file's text and contents, or None when there isn't one.
const readLibrary = Effect.fn("readLibrary")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(file))) {
    return Option.none();
  }

  const text = yield* fs.readFileString(file);

  return Option.some({
    text,
    library: yield* Schema.decodeEffect(LibraryJson)(text),
  });
});

// Another machine can mark things watched while this daemon runs, so its
// watched IDs are added to ours. Saved items follow the file, so removing one
// elsewhere removes it here too.
export const mergeLibrary = (state: State, library: Library): State => ({
  ...state,
  watched: Arr.union(state.watched ?? [], library.watched ?? []),
  saved: library.saved ?? [],
});

export interface UpnextStateService {
  readonly get: Effect.Effect<State>;
  readonly update: (
    f: (state: State) => State,
  ) => Effect.Effect<void, StateError>;
  // Emits after the library changes on disk, such as when it syncs.
  readonly libraryChanges: Stream.Stream<void>;
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
      const { stateFile, dataDirectory, libraryFile } = yield* resolvePaths();

      const provide = <A, E>(
        effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
      ) =>
        effect.pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        );

      const toStateError =
        (action: string, file: string) =>
        (cause: { readonly message: string }) =>
          new StateError({ message: `${action} ${file}: ${cause.message}` });

      // A library that can't be read is left alone rather than failing, as
      // it may be partway through syncing. The next write replaces it.
      const loadLibrary = readLibrary(libraryFile).pipe(
        Effect.catch((cause) =>
          Effect.logWarning(`Couldn't read ${libraryFile}`, cause.message).pipe(
            Effect.as(Option.none()),
          ),
        ),
        provide,
      );

      const saved = yield* readState(stateFile).pipe(
        Effect.mapError(toStateError("read", stateFile)),
        provide,
      );

      const onDisk = yield* loadLibrary;

      const initial = Option.match(onDisk, {
        onNone: () => saved,
        onSome: ({ library }) =>
          mergeLibrary(saved, {
            ...library,
            // Keeps anything still saved in an older state.json.
            saved: Arr.unionWith(
              library.saved ?? [],
              saved.saved ?? [],
              (a, b) => a.id === b.id,
            ),
          }),
      });

      const libraryText = yield* encodeLibrary(initial).pipe(
        Effect.mapError(toStateError("encode", libraryFile)),
      );

      // The library file's text as this daemon last read or wrote it, so its
      // own writes don't count as changes.
      const lastLibraryText = yield* Ref.make(
        Option.match(onDisk, { onNone: () => "", onSome: ({ text }) => text }),
      );

      const writeLibrary = Effect.fn("UpnextState.writeLibrary")(function* (
        text: string,
      ) {
        if (text === (yield* Ref.get(lastLibraryText))) {
          return;
        }

        yield* writePrivate(libraryFile, text).pipe(
          Effect.mapError(toStateError("write", libraryFile)),
          provide,
        );

        yield* Ref.set(lastLibraryText, text);
      });

      const writeTokens = (state: State) =>
        writeState(stateFile, Struct.omit(state, ["watched", "saved"])).pipe(
          Effect.mapError(toStateError("write", stateFile)),
          provide,
        );

      // Moves the library out of an older state.json on the first start.
      yield* writeLibrary(libraryText);

      if (saved.watched !== undefined || saved.saved !== undefined) {
        yield* writeTokens(initial);
      }

      const ref = yield* SynchronizedRef.make(initial);
      const changes = yield* PubSub.unbounded<void>();

      // Writes happen inside the ref's lock, so the files match memory. The
      // library is read first, so a change synced from another machine isn't
      // overwritten.
      const update = (f: (state: State) => State) =>
        SynchronizedRef.updateEffect(ref, (current) =>
          Effect.gen(function* () {
            const fresh = Option.match(yield* loadLibrary, {
              onNone: () => current,
              onSome: ({ library }) => mergeLibrary(current, library),
            });

            const next = f(fresh);

            yield* writeLibrary(
              yield* encodeLibrary(next).pipe(
                Effect.mapError(toStateError("encode", libraryFile)),
              ),
            );

            if (
              next.twitch !== current.twitch ||
              next.youtube !== current.youtube
            ) {
              yield* writeTokens(next);
            }

            return next;
          }),
        ).pipe(Effect.withSpan("UpnextState.update"));

      const reload = SynchronizedRef.modifyEffect(ref, (current) =>
        Effect.gen(function* () {
          const onDisk = yield* loadLibrary;

          if (
            Option.isNone(onDisk) ||
            onDisk.value.text === (yield* Ref.get(lastLibraryText))
          ) {
            return [false, current] as const;
          }

          yield* Ref.set(lastLibraryText, onDisk.value.text);

          return [true, mergeLibrary(current, onDisk.value.library)] as const;
        }),
      ).pipe(
        Effect.flatMap((changed) =>
          changed
            ? Effect.logInfo("Library changed on disk, reloaded it").pipe(
                Effect.andThen(PubSub.publish(changes, undefined)),
              )
            : Effect.void,
        ),
      );

      // Watches the directory rather than the file, as sync tools replace the
      // file instead of writing to it.
      yield* fs.makeDirectory(dataDirectory, { recursive: true, mode: 0o700 });

      yield* fs.watch(dataDirectory).pipe(
        Stream.filter(
          (event) => path.basename(event.path) === path.basename(libraryFile),
        ),
        Stream.debounce(Duration.millis(500)),
        Stream.runForEach(() => reload),
        Effect.catch((cause) =>
          Effect.logWarning(
            `Stopped watching ${dataDirectory} for library changes`,
            cause.message,
          ),
        ),
        Effect.forkScoped,
      );

      return UpnextState.of({
        get: SynchronizedRef.get(ref),
        update,
        libraryChanges: Stream.fromPubSub(changes),
      });
    }),
  );
}
