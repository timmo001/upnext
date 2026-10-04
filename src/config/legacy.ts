import { Array as Arr, Effect, FileSystem, Option, Path, Schema } from "effect";
import {
  ConfigError,
  optionalText,
  readYaml,
  writePrivate,
  ChannelsFile,
  ConfigFile,
  encodeYaml,
  type Paths,
} from "./Config.js";
import { readState, writeState } from "../state/State.js";

const LegacyChannel = Schema.Struct({
  name: Schema.String,
  open: Schema.OptionFromNullishOr(Schema.Boolean).pipe(Schema.optional),
});

const LegacyChannelList = Schema.OptionFromNullishOr(
  Schema.Array(LegacyChannel),
).pipe(Schema.optional);

const LegacyChannels = Schema.Struct({
  watched_channels: LegacyChannelList,
});

const LegacyConfig = Schema.Struct({
  notify_on_startup: Schema.optional(Schema.Boolean),
  sound_file: Schema.OptionFromNullishOr(Schema.String).pipe(Schema.optional),
  poll_interval: Schema.optional(Schema.Finite),
  watched_channels: LegacyChannelList,
  twitch: Schema.optional(
    Schema.Struct({
      client_id: Schema.optional(Schema.String),
      client_secret: Schema.optional(Schema.String),
      access_token: Schema.optional(Schema.String),
      refresh_token: Schema.optional(Schema.String),
    }),
  ),
});

const flattenOptional = <A>(value: Option.Option<A> | undefined) =>
  Option.flatten(Option.fromUndefinedOr(value));

// Keeps a value as written, including ${VAR} references, unless it's blank.
const keepText = (value: string | undefined) =>
  Option.getOrUndefined(
    Option.filter(Option.fromUndefinedOr(value), (text) => text.trim() !== ""),
  );

// When the legacy file is a stow link, finds where its replacement belongs in
// the same stow package: the target's path, with the legacy path relative to
// the config home swapped for the new one.
const stowedTarget = Effect.fn("stowedTarget")(function* (
  legacyFile: string,
  newFile: string,
  configHome: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const isLink = yield* fs.readLink(legacyFile).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

  if (!isLink) {
    return Option.none<string>();
  }

  const target = yield* fs.realPath(legacyFile);
  const suffix = path.relative(configHome, legacyFile);

  if (!target.endsWith(`${path.sep}${suffix}`)) {
    yield* Effect.logWarning(
      "Not keeping link: its target isn't laid out like the config home",
      legacyFile,
      target,
    );

    return Option.none<string>();
  }

  return Option.some(
    path.join(
      target.slice(0, -suffix.length),
      path.relative(configHome, newFile),
    ),
  );
});

// Writes an imported file. A stowed legacy file gets a stowed replacement:
// the content goes into the same stow package and the new path links to it,
// the same relative link stow makes. An existing package file is kept.
const writeImported = Effect.fn("writeImported")(function* (
  legacyFile: string,
  newFile: string,
  configHome: string,
  content: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* Option.match(yield* stowedTarget(legacyFile, newFile, configHome), {
    onNone: () => writePrivate(newFile, content),
    onSome: Effect.fnUntraced(function* (target) {
      if (!(yield* fs.exists(target))) {
        yield* writePrivate(target, content);
      }

      yield* fs.makeDirectory(path.dirname(newFile), {
        recursive: true,
        mode: 0o700,
      });
      yield* fs.symlink(path.relative(path.dirname(newFile), target), newFile);
      yield* Effect.logInfo("Kept stowed config", newFile, target);
    }),
  });
});

// Copies twitch-notifications' config into upnext's on first run. Client
// credentials keep any ${VAR} references; tokens are expanded, since the
// daemon writes refreshed ones back to state.json. The old directory is left
// alone so you can go back to it.
export const importTwitchNotifications = Effect.fn("importTwitchNotifications")(
  function* (paths: Paths) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const legacyConfigFile = path.join(paths.legacyDirectory, "config.yaml");
    const legacyChannelsFile = path.join(paths.legacyDirectory, "channels.yml");

    if (
      (yield* fs.exists(paths.configFile)) ||
      !(yield* fs.exists(legacyConfigFile))
    ) {
      return false;
    }

    const legacy = Option.getOrElse(
      yield* readYaml(legacyConfigFile, LegacyConfig),
      (): typeof LegacyConfig.Type => ({}),
    );

    // channels.yml wins; older setups kept the list inline in config.yaml.
    const watched = Option.match(
      yield* readYaml(legacyChannelsFile, LegacyChannels),
      {
        onNone: () => flattenOptional(legacy.watched_channels),
        onSome: (file) => flattenOptional(file.watched_channels),
      },
    );

    const configHome = path.dirname(paths.legacyDirectory);

    // Written before channels.yml, so a plain config.yml keeps the new
    // directory real and stow links files into it instead of folding it.
    const config = yield* Schema.decodeEffect(ConfigFile)({
      notify_on_startup: legacy.notify_on_startup,
      sound_file: keepText(
        Option.getOrUndefined(flattenOptional(legacy.sound_file)),
      ),
      twitch: {
        client_id: keepText(legacy.twitch?.client_id),
        client_secret: keepText(legacy.twitch?.client_secret),
        // twitch-notifications treated 0 as "use the default".
        poll_interval: Option.getOrUndefined(
          Option.filter(
            Option.fromUndefinedOr(legacy.poll_interval),
            (s) => s > 0,
          ),
        ),
      },
    });

    yield* writeImported(
      legacyConfigFile,
      paths.configFile,
      configHome,
      yield* encodeYaml(ConfigFile, config),
    );

    if (!(yield* fs.exists(paths.channelsFile))) {
      const channels: ChannelsFile = {
        twitch: Arr.map(
          Option.getOrElse(watched, () => []),
          ({ name, open }) => ({
            name,
            open: Option.getOrElse(flattenOptional(open), () => false),
          }),
        ),
        youtube: [],
      };

      yield* writeImported(
        legacyChannelsFile,
        paths.channelsFile,
        configHome,
        yield* encodeYaml(ChannelsFile, channels),
      );
    }

    const accessToken = yield* optionalText(legacy.twitch?.access_token ?? "");

    const refreshToken = yield* optionalText(
      legacy.twitch?.refresh_token ?? "",
    );

    if (Option.isSome(accessToken) || Option.isSome(refreshToken)) {
      const state = yield* readState(paths.stateFile);

      yield* writeState(paths.stateFile, {
        ...state,
        twitch: {
          accessToken: Option.getOrUndefined(accessToken),
          refreshToken: Option.getOrUndefined(refreshToken),
        },
      });
    }

    yield* Effect.logInfo(
      "Imported twitch-notifications config",
      paths.configDirectory,
    );

    return true;
  },
  Effect.mapError(
    (cause) =>
      new ConfigError({
        message: `import twitch-notifications config: ${cause.message}`,
      }),
  ),
);
