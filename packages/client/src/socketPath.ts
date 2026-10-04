import { Config, Effect, Option, Path } from "effect";

// Resolution order: --socket, then UPNEXT_SOCK, then the per-user default.
export const resolveSocketPath = Effect.fn("resolveSocketPath")(function* (
  flag: Option.Option<string>,
) {
  if (Option.isSome(flag)) {
    return flag.value;
  }

  const fromEnv = yield* Config.option(Config.String("UPNEXT_SOCK"));

  if (Option.isSome(fromEnv) && fromEnv.value !== "") {
    return fromEnv.value;
  }

  const path = yield* Path.Path;
  const runtimeDir = yield* Config.option(Config.String("XDG_RUNTIME_DIR"));

  if (Option.isSome(runtimeDir) && runtimeDir.value !== "") {
    return path.join(runtimeDir.value, "upnext", "upnext.sock");
  }

  const tmpDir = yield* Config.String("TMPDIR").pipe(
    Config.withDefault("/tmp"),
  );

  const user = yield* Config.String("USER").pipe(Config.withDefault("default"));

  return path.join(tmpDir, `upnext-${user}`, "upnext.sock");
});
