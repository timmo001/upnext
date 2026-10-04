import { BunFileSystem, BunPath } from "@effect/platform-bun";
import { describe, expect, test } from "bun:test";
import { Effect, FileSystem, Layer, Path } from "effect";
import { prepareSocket } from "./Server.js";

const run = <A>(
  effect: Effect.Effect<A, unknown, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
    ),
  );

const modeOf = (info: FileSystem.File.Info) => info.mode & 0o777;

describe("prepareSocket", () => {
  test("tightens a world-writable socket directory and removes a stale socket", async () => {
    const result = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({ prefix: "upnext-sock-" });
        const directory = path.join(root, "upnext");
        const socketPath = path.join(directory, "upnext.sock");

        yield* fs.makeDirectory(directory);
        yield* fs.chmod(directory, 0o777);
        yield* fs.writeFileString(socketPath, "stale");
        yield* prepareSocket(socketPath);

        const info = yield* fs.stat(directory);

        return {
          mode: modeOf(info),
          socketExists: yield* fs.exists(socketPath),
        };
      }),
    );

    expect(result).toEqual({ mode: 0o700, socketExists: false });
  });

  test("refuses a socket directory that is a symbolic link", async () => {
    const result = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({ prefix: "upnext-link-" });
        const real = path.join(root, "real");
        const link = path.join(root, "link");
        const socketPath = path.join(link, "upnext.sock");

        yield* fs.makeDirectory(real, { mode: 0o755 });
        yield* fs.symlink(real, link);

        const error = yield* prepareSocket(socketPath).pipe(Effect.flip);
        const afterwards = yield* fs.stat(real);

        return {
          message: error.message,
          realMode: modeOf(afterwards),
        };
      }),
    );

    expect(result.realMode).toBe(0o755);
    expect(result.message).toContain("symbolic link");
  });
});
