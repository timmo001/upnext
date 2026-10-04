import { BunFileSystem, BunPath } from "@effect/platform-bun";
import { describe, expect, test } from "bun:test";
import { Effect, FileSystem, Layer, Path } from "effect";
import type { Paths } from "./Config.js";
import { importTwitchNotifications } from "./legacy.js";

const run = <A>(
  effect: Effect.Effect<A, unknown, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
    ),
  );

const legacyConfig = `notify_on_startup: false
sound_file: ""
poll_interval: 30
system_tray: true
twitch:
    client_id: \${TWITCH_CLIENT_ID}
    client_secret: secret
    access_token: access
    refresh_token: refresh
`;

const legacyChannels = `---
watched_channels:
    - name: some_streamer
      open: true
    - name: another_streamer
`;

const makePaths = Effect.fn(function* (root: string) {
  const path = yield* Path.Path;
  const configHome = path.join(root, "config");
  const stateDirectory = path.join(root, "state", "upnext");

  return {
    configDirectory: path.join(configHome, "upnext"),
    configFile: path.join(configHome, "upnext", "config.yml"),
    channelsFile: path.join(configHome, "upnext", "channels.yml"),
    stateDirectory,
    stateFile: path.join(stateDirectory, "state.json"),
    dataDirectory: path.join(root, "data", "upnext"),
    libraryFile: path.join(root, "data", "upnext", "library.json"),
    legacyDirectory: path.join(configHome, "twitch-notifications"),
  } satisfies Paths;
});

const readImport = Effect.fn(function* (paths: Paths) {
  const fs = yield* FileSystem.FileSystem;

  return {
    config: Bun.YAML.parse(yield* fs.readFileString(paths.configFile)),
    channels: Bun.YAML.parse(yield* fs.readFileString(paths.channelsFile)),
    state: JSON.parse(yield* fs.readFileString(paths.stateFile)),
  };
});

const expected = {
  config: {
    notify_on_startup: false,
    sound_file: "",
    twitch: {
      client_id: "${TWITCH_CLIENT_ID}",
      client_secret: "secret",
      poll_interval: 30,
    },
    youtube: {
      api_key: "",
      client_id: "",
      client_secret: "",
      poll_interval: 600,
    },
  },
  channels: {
    twitch: [
      { name: "some_streamer", open: true },
      { name: "another_streamer", open: false },
    ],
    youtube: [],
  },
  state: { twitch: { accessToken: "access", refreshToken: "refresh" } },
};

describe("importTwitchNotifications", () => {
  test("copies config, channels and tokens, keeping env references", async () => {
    const result = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({ prefix: "upnext-import-" });
        const paths = yield* makePaths(root);

        yield* fs.makeDirectory(paths.legacyDirectory, { recursive: true });
        yield* fs.writeFileString(
          path.join(paths.legacyDirectory, "config.yaml"),
          legacyConfig,
        );
        yield* fs.writeFileString(
          path.join(paths.legacyDirectory, "channels.yml"),
          legacyChannels,
        );

        const imported = yield* importTwitchNotifications(paths);
        const again = yield* importTwitchNotifications(paths);

        return { imported, again, files: yield* readImport(paths) };
      }),
    );

    expect(result.imported).toBe(true);
    expect(result.again).toBe(false);
    expect(result.files).toEqual(expected);
  });

  test("keeps a stowed channels.yml stowed in the same package", async () => {
    const result = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({ prefix: "upnext-stow-" });
        const paths = yield* makePaths(root);
        const stowPackage = path.join(root, "dotfiles", "twitch-notifications");

        const stowedLegacy = path.join(
          stowPackage,
          "twitch-notifications",
          "channels.yml",
        );

        yield* fs.makeDirectory(path.dirname(stowedLegacy), {
          recursive: true,
        });
        yield* fs.writeFileString(stowedLegacy, legacyChannels);
        yield* fs.makeDirectory(paths.legacyDirectory, { recursive: true });
        yield* fs.writeFileString(
          path.join(paths.legacyDirectory, "config.yaml"),
          legacyConfig,
        );
        yield* fs.symlink(
          path.relative(paths.legacyDirectory, stowedLegacy),
          path.join(paths.legacyDirectory, "channels.yml"),
        );

        yield* importTwitchNotifications(paths);

        return {
          link: yield* fs.readLink(paths.channelsFile),
          expectedLink: path.relative(
            paths.configDirectory,
            path.join(stowPackage, "upnext", "channels.yml"),
          ),
          configIsLink: yield* fs.readLink(paths.configFile).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          ),
          legacyKept: yield* fs.readFileString(stowedLegacy),
          files: yield* readImport(paths),
        };
      }),
    );

    expect(result.link).toBe(result.expectedLink);
    expect(result.configIsLink).toBe(false);
    expect(result.legacyKept).toBe(legacyChannels);
    expect(result.files).toEqual(expected);
  });
});
