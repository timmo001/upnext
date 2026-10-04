import {
  Array as Arr,
  Config,
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Record,
  Redacted,
  Schema,
  Semaphore,
  String as Str,
} from "effect";

export class ConfigError extends Schema.TaggedError<ConfigError>()(
  "ConfigError",
  { message: Schema.String },
) {}

export interface Paths {
  readonly configDirectory: string;
  readonly configFile: string;
  readonly channelsFile: string;
  readonly stateDirectory: string;
  readonly stateFile: string;
  // Watched and saved items, which can be synced between machines.
  readonly dataDirectory: string;
  readonly libraryFile: string;
  // Where twitch-notifications kept its config.
  readonly legacyDirectory: string;
}

export const resolvePaths = Effect.fn("resolvePaths")(function* () {
  const path = yield* Path.Path;
  const home = yield* Config.String("HOME").pipe(Config.withDefault(""));

  const configHome = yield* Config.String("XDG_CONFIG_HOME").pipe(
    Config.withDefault(path.join(home, ".config")),
  );

  const stateHome = yield* Config.String("XDG_STATE_HOME").pipe(
    Config.withDefault(path.join(home, ".local", "state")),
  );

  const dataHome = yield* Config.String("XDG_DATA_HOME").pipe(
    Config.withDefault(path.join(home, ".local", "share")),
  );

  const configDirectory = path.join(configHome, "upnext");
  const stateDirectory = path.join(stateHome, "upnext");
  const dataDirectory = path.join(dataHome, "upnext");

  return {
    configDirectory,
    configFile: path.join(configDirectory, "config.yml"),
    channelsFile: path.join(configDirectory, "channels.yml"),
    stateDirectory,
    stateFile: path.join(stateDirectory, "state.json"),
    dataDirectory,
    libraryFile: path.join(dataDirectory, "library.json"),
    legacyDirectory: path.join(configHome, "twitch-notifications"),
  } satisfies Paths;
});

const envReference = /\$\{(\w+)\}|\$(\w+)/g;

// Replaces $VAR and ${VAR} with the variable's value, or nothing when unset,
// as twitch-notifications did.
export const expandEnv = Effect.fn("expandEnv")(function* (value: string) {
  const names = Arr.dedupe(
    Arr.map(
      Arr.fromIterable(Str.matchAll(envReference)(value)),
      (match) => match[1] ?? match[2] ?? "",
    ),
  );

  const env = yield* Config.all(
    Record.fromIterableWith(names, (name) => [
      name,
      Config.String(name).pipe(Config.withDefault("")),
    ]),
  );

  return value.replace(
    envReference,
    (_, braced: string | undefined, bare: string | undefined) =>
      env[braced ?? bare ?? ""] ?? "",
  );
});

const withDefault = <S extends Schema.Top>(schema: S, value: S["Encoded"]) =>
  Schema.withDecodingDefault<S>(Effect.succeed(value))(schema);

export const ConfigFile = Schema.Struct({
  notify_on_startup: withDefault(Schema.Boolean, true),
  sound_file: withDefault(Schema.String, ""),
  twitch: withDefault(
    Schema.Struct({
      client_id: withDefault(Schema.String, ""),
      client_secret: withDefault(Schema.String, ""),
      poll_interval: withDefault(Schema.Finite, 60),
    }),
    {},
  ),
  youtube: withDefault(
    Schema.Struct({
      api_key: withDefault(Schema.String, ""),
      // A Google OAuth client of the Desktop app type, for reading
      // subscriptions.
      client_id: withDefault(Schema.String, ""),
      client_secret: withDefault(Schema.String, ""),
      poll_interval: withDefault(Schema.Finite, 600),
    }),
    {},
  ),
});

const TwitchChannel = Schema.Struct({
  name: Schema.String,
  open: withDefault(Schema.Boolean, false),
});

const YouTubeChannel = Schema.Struct({
  id: Schema.String,
  open: withDefault(Schema.Boolean, false),
});

export const ChannelsFile = Schema.Struct({
  twitch: withDefault(Schema.Array(TwitchChannel), []),
  youtube: withDefault(Schema.Array(YouTubeChannel), []),
});

export type ChannelsFile = typeof ChannelsFile.Type;

export interface Settings {
  readonly notifyOnStartup: boolean;
  readonly soundFile: Option.Option<string>;
  readonly twitch: {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted;
    readonly pollInterval: Duration.Duration;
  };
  readonly youtube: {
    readonly apiKey: Option.Option<Redacted.Redacted>;
    // None until both the client ID and secret are set.
    readonly google: Option.Option<{
      readonly clientId: string;
      readonly clientSecret: Redacted.Redacted;
    }>;
    readonly pollInterval: Duration.Duration;
  };
}

// Expands env references and trims, giving None for an empty result.
export const optionalText = (value: string) =>
  expandEnv(value).pipe(
    Effect.map((expanded) =>
      Option.liftPredicate(Str.trim(expanded), Str.isNonEmpty),
    ),
  );

const positiveSeconds = (value: number, fallback: number) =>
  Duration.seconds(value > 0 ? value : fallback);

// Encodes a value with its schema, then writes block-style YAML with a
// document start, which yamllint expects.
export const encodeYaml = <S extends Schema.Encoder<unknown>>(
  schema: S,
  value: S["Type"],
) =>
  Schema.encodeEffect(schema)(value).pipe(
    // Bun leaves a space after keys that open a block.
    Effect.map(
      (encoded) =>
        `---\n${Str.replaceAll(/ +$/gm, "")(Bun.YAML.stringify(encoded, null, 2))}\n`,
    ),
  );

// Parses a YAML file, or returns None when it doesn't exist. An empty file
// counts as an empty object.
export const readYaml = Effect.fn("readYaml")(function* <
  S extends Schema.Decoder<unknown>,
>(file: string, schema: S) {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(file))) {
    return Option.none<S["Type"]>();
  }

  const content = yield* fs.readFileString(file);

  const parsed: unknown = yield* Effect.try({
    try: () => Bun.YAML.parse(content),
    catch: (cause) =>
      new ConfigError({ message: `parse ${file}: ${String(cause)}` }),
  });

  return Option.some(
    yield* Schema.decodeEffect(schema)(parsed ?? {}).pipe(
      Effect.mapError(
        (cause) =>
          new ConfigError({ message: `read ${file}: ${cause.message}` }),
      ),
    ),
  );
});

// Writes a file only its owner can read, as it can hold credentials.
export const writePrivate = Effect.fn("writePrivate")(function* (
  file: string,
  content: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 });
  yield* fs.writeFileString(file, content, { mode: 0o600 });
  yield* fs.chmod(file, 0o600);
});

export const writeYaml = <S extends Schema.Encoder<unknown>>(
  file: string,
  schema: S,
  value: S["Type"],
) =>
  Effect.flatMap(encodeYaml(schema, value), (content) =>
    writePrivate(file, content),
  );

const toSettings = Effect.fn("toSettings")(function* (
  file: typeof ConfigFile.Type,
) {
  const soundFile = yield* optionalText(file.sound_file);
  const clientId = yield* optionalText(file.twitch.client_id);
  const clientSecret = yield* optionalText(file.twitch.client_secret);
  const apiKey = yield* optionalText(file.youtube.api_key);
  const googleClientId = yield* optionalText(file.youtube.client_id);
  const googleClientSecret = yield* optionalText(file.youtube.client_secret);

  return {
    notifyOnStartup: file.notify_on_startup,
    soundFile,
    twitch: {
      clientId: Option.getOrElse(clientId, () => ""),
      clientSecret: Redacted.make(Option.getOrElse(clientSecret, () => "")),
      pollInterval: positiveSeconds(file.twitch.poll_interval, 60),
    },
    youtube: {
      apiKey: Option.map(apiKey, Redacted.make),
      google: Option.zipWith(
        googleClientId,
        googleClientSecret,
        (clientId, clientSecret) => ({
          clientId,
          clientSecret: Redacted.make(clientSecret),
        }),
      ),
      pollInterval: positiveSeconds(file.youtube.poll_interval, 600),
    },
  } satisfies Settings;
});

export interface UpnextConfigService {
  readonly paths: Paths;
  readonly settings: Effect.Effect<Settings, ConfigError>;
  readonly channels: Effect.Effect<ChannelsFile, ConfigError>;
  // Reads, changes and writes channels.yml one change at a time, so changes
  // made together don't overwrite each other.
  readonly updateChannels: <E>(
    update: (channels: ChannelsFile) => Effect.Effect<ChannelsFile, E>,
  ) => Effect.Effect<void, ConfigError | E>;
}

export class UpnextConfig extends Context.Service<
  UpnextConfig,
  UpnextConfigService
>()("UpnextConfig") {
  static readonly layer = Layer.effect(
    UpnextConfig,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const paths = yield* resolvePaths();

      const provide = <A, E>(
        effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
      ) =>
        effect.pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        );

      const toConfigError = (cause: { readonly message: string }) =>
        new ConfigError({ message: cause.message });

      const settings = readYaml(paths.configFile, ConfigFile).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Schema.decodeEffect(ConfigFile)({}),
            onSome: Effect.succeed,
          }),
        ),
        Effect.flatMap(toSettings),
        Effect.mapError(toConfigError),
        provide,
      );

      const channels = readYaml(paths.channelsFile, ChannelsFile).pipe(
        Effect.map(Option.getOrElse(() => ({ twitch: [], youtube: [] }))),
        Effect.mapError(toConfigError),
        provide,
      );

      const saving = yield* Semaphore.make(1);

      const updateChannels = <E>(
        update: (value: ChannelsFile) => Effect.Effect<ChannelsFile, E>,
      ) =>
        channels.pipe(
          Effect.flatMap(update),
          Effect.flatMap((value) =>
            writeYaml(paths.channelsFile, ChannelsFile, value).pipe(
              Effect.mapError(
                (cause) =>
                  new ConfigError({
                    message: `save channels: ${cause.message}`,
                  }),
              ),
              provide,
            ),
          ),
          Semaphore.withPermit(saving),
        );

      return UpnextConfig.of({ paths, settings, channels, updateChannels });
    }),
  );
}
