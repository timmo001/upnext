import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
  Array as Arr,
  Cause,
  Console,
  Data,
  DateTime,
  Duration,
  Effect,
  Layer,
  Logger,
  Option,
  Predicate,
  Schema,
  Stream,
} from "effect";
import { Argument, CliError, Command, Flag, Prompt } from "effect/cli";
import { RpcClientError } from "effect/rpc/RpcClientError";
import packageJson from "../package.json" with { type: "json" };
import { Source } from "@timmo001/effect-upnext-shared";
import {
  Feed,
  FeedItem,
  resolveSocketPath,
  UpnextClient,
} from "@timmo001/effect-upnext";
import { resolvePaths, UpnextConfig } from "./config/Config.js";
import { importTwitchNotifications } from "./config/legacy.js";
import { serve as serveDaemon } from "./server/Server.js";

const upnext = Command.make("upnext").pipe(
  Command.withSharedFlags({
    socket: Flag.String("socket").pipe(
      Flag.withDescription(
        "Path to the daemon socket (default: $UPNEXT_SOCK, then $XDG_RUNTIME_DIR/upnext/upnext.sock)",
      ),
      Flag.optional,
    ),
  }),
  Command.withDescription(
    "Twitch live channels, YouTube uploads and a watch-later queue in one feed",
  ),
);

const socketPath = Effect.flatMap(upnext, ({ socket }) =>
  resolveSocketPath(socket),
);

class CommandError extends Data.TaggedError("CommandError")<{
  readonly message: string;
}> {}

// Runs a client effect against the daemon socket, explaining connection
// failures.
const withDaemon = <A, E, R>(
  effect: Effect.Effect<A, E | RpcClientError, R | UpnextClient>,
) =>
  Effect.gen(function* () {
    const path = yield* socketPath;

    return yield* effect.pipe(
      Effect.catchIf(
        (error) => error instanceof RpcClientError,
        (error) =>
          Effect.fail(
            new CommandError({
              message: `Could not reach the daemon at ${path} (is upnext serve running?): ${error.message}`,
            }),
          ),
      ),
      Effect.provide(UpnextClient.layer(path)),
    );
  });

const encodeFeed = Schema.encodeEffect(
  Schema.fromJsonString(Schema.toCodecJson(Feed)),
);

const encodeFeedItem = Schema.encodeEffect(
  Schema.fromJsonString(Schema.toCodecJson(FeedItem)),
);

const itemLine = ({ item }: FeedItem) =>
  Arr.join(
    [
      item.kind,
      item.source,
      Option.match(Option.fromUndefinedOr(item.channel), {
        onNone: () => "-",
        onSome: ({ name }) => name,
      }),
      item.title,
      item.url,
    ],
    "\t",
  );

const printFeed = (feed: Feed, json: boolean) =>
  json
    ? Effect.flatMap(encodeFeed(feed), Console.log)
    : Effect.gen(function* () {
        yield* Effect.forEach(
          Arr.filter(feed.sources, ({ state }) => state !== "ok"),
          ({ source, state, message }) =>
            Console.error(
              `${source}: ${state}${message ? ` (${message})` : ""}`,
            ),
          { discard: true },
        );

        yield* Arr.match(feed.items, {
          onEmpty: () => Console.error("Nothing to watch"),
          onNonEmpty: (items) =>
            Effect.forEach(items, (item) => Console.log(itemLine(item)), {
              discard: true,
            }),
        });
      });

const jsonFlag = (description: string) =>
  Flag.Boolean("json").pipe(
    Flag.withDescription(description),
    Flag.withDefault(false),
  );

const openFlag = (description: string) =>
  Flag.Boolean("open").pipe(
    Flag.withDescription(description),
    Flag.withDefault(false),
  );

const sourceArgument = Argument.Literals("source", Source.literals).pipe(
  Argument.withDescription("twitch or youtube"),
);

const serve = Command.make("serve", {}, () =>
  Effect.gen(function* () {
    yield* importTwitchNotifications(yield* resolvePaths());

    // Fail at startup on a broken config rather than on the first request.
    const config = yield* UpnextConfig;
    yield* config.settings;
    yield* config.channels;

    return yield* serveDaemon(yield* socketPath);
  }).pipe(Effect.provide(UpnextConfig.layer)),
).pipe(
  Command.withDescription("Run the daemon and serve the feed on its socket"),
);

const feed = Command.make(
  "feed",
  { json: jsonFlag("Print the feed as JSON") },
  ({ json }) =>
    withDaemon(
      Effect.gen(function* () {
        const client = yield* UpnextClient;
        yield* printFeed(yield* client.GetFeed(), json);
      }),
    ),
).pipe(Command.withDescription("Print what's live, new and saved"));

const watch = Command.make(
  "watch",
  { json: jsonFlag("Print each feed as one line of JSON") },
  ({ json }) =>
    withDaemon(
      Effect.gen(function* () {
        const client = yield* UpnextClient;

        yield* client
          .WatchFeed()
          .pipe(Stream.runForEach((value) => printFeed(value, json)));
      }),
    ),
).pipe(Command.withDescription("Print the feed, then again after each change"));

const recheck = Command.make(
  "recheck",
  {
    source: Flag.Literals("source", Source.literals).pipe(
      Flag.withDescription("Only check this source"),
      Flag.optional,
    ),
    open: openFlag("Open live channels set to auto-open, even if already live"),
  },
  ({ source, open }) =>
    withDaemon(
      Effect.gen(function* () {
        const client = yield* UpnextClient;

        yield* client.Recheck({ source: Option.getOrUndefined(source), open });
      }),
    ),
).pipe(Command.withDescription("Check sources now instead of waiting"));

const channelName = Argument.String("name").pipe(
  Argument.withDescription("A Twitch login or a YouTube channel ID"),
);

const channelSources = ["twitch", "youtube"] as const;

type ChannelSource = (typeof channelSources)[number];

const candidateNoun: Record<ChannelSource, string> = {
  twitch: "followed Twitch channels",
  youtube: "YouTube subscriptions",
};

// Lists followed channels or subscriptions that aren't in channels.yml yet
// and lets you pick some.
const pickChannels = (source: ChannelSource) =>
  Effect.gen(function* () {
    const client = yield* UpnextClient;
    const candidates = yield* client.ListCandidates({ source });

    if (Arr.isReadonlyArrayEmpty(candidates)) {
      return yield* new CommandError({
        message: `All your ${candidateNoun[source]} are already in channels.yml`,
      });
    }

    return yield* Prompt.run(
      Prompt.MultiSelect({
        message: `Add ${candidateNoun[source]} (space to pick, enter to add)`,
        choices: Arr.map(candidates, ({ name, title }) => ({
          title,
          value: name,
          description: name,
        })),
        maxPerPage: 15,
        min: 1,
      }),
    );
  });

const channel = Command.make("channel").pipe(
  Command.withDescription("Add or remove followed channels"),
  Command.withSubcommands([
    Command.make(
      "add",
      {
        source: Argument.Literals("source", channelSources).pipe(
          Argument.withDescription(
            "twitch or youtube. Asks which when left out",
          ),
          Argument.optional,
        ),
        name: channelName.pipe(
          Argument.withDescription(
            "A Twitch login or a YouTube channel ID. Without one, pick from the channels you follow",
          ),
          Argument.optional,
        ),
        open: openFlag("Open the channel as soon as it goes live"),
      },
      ({ source, name, open }) =>
        withDaemon(
          Effect.gen(function* () {
            const client = yield* UpnextClient;

            const chosenSource = yield* Option.match(source, {
              onNone: () =>
                Prompt.run(
                  Prompt.Select({
                    message: "Add channels from",
                    choices: [
                      { title: "Twitch", value: "twitch" as const },
                      { title: "YouTube", value: "youtube" as const },
                    ],
                  }),
                ),
              onSome: Effect.succeed,
            });

            const names = yield* Option.match(name, {
              onNone: () => pickChannels(chosenSource),
              onSome: (value) => Effect.succeed([value]),
            });

            yield* Effect.forEach(
              names,
              (each) =>
                client.AddChannel({ source: chosenSource, name: each, open }),
              { discard: true },
            );

            yield* Console.error(
              names.length === 1
                ? `Added ${names[0]}`
                : `Added ${names.length} channels`,
            );
          }),
        ),
    ).pipe(
      Command.withDescription(
        "Add a channel, or change whether it opens when live",
      ),
    ),
    Command.make(
      "remove",
      { source: sourceArgument, name: channelName },
      ({ source, name }) =>
        withDaemon(
          Effect.gen(function* () {
            const client = yield* UpnextClient;
            yield* client.RemoveChannel({ source, name });
          }),
        ),
    ).pipe(Command.withDescription("Remove a channel")),
  ]),
);

const queue = Command.make("queue").pipe(
  Command.withDescription("Manage the watch-later queue"),
  Command.withSubcommands([
    Command.make(
      "add",
      {
        url: Argument.String("url").pipe(
          Argument.withDescription("What to watch later"),
        ),
        title: Flag.String("title").pipe(
          Flag.withDescription("Title to show instead of the one looked up"),
          Flag.optional,
        ),
        json: jsonFlag("Print the saved item as JSON"),
      },
      ({ url, title, json }) =>
        withDaemon(
          Effect.gen(function* () {
            const client = yield* UpnextClient;

            const saved = yield* client.QueueAdd({
              url,
              title: Option.getOrUndefined(title),
            });

            yield* json
              ? Effect.flatMap(encodeFeedItem(saved), Console.log)
              : Console.log(itemLine(saved));
          }),
        ),
    ).pipe(Command.withDescription("Save a URL to watch later")),
  ]),
);

const signInTimeout = Duration.minutes(5);

const isSignedIn =
  (source: Source, since: DateTime.Utc) =>
  ({ sources }: Feed) =>
    Arr.some(
      sources,
      (status) =>
        status.source === source &&
        status.state === "ok" &&
        Option.exists(Option.fromUndefinedOr(status.checkedAt), (at) =>
          DateTime.isGreaterThan(at, since),
        ),
    );

const auth = Command.make(
  "auth",
  {
    source: Argument.Literals("source", channelSources).pipe(
      Argument.withDescription("The source to sign in to: twitch or youtube"),
    ),
  },
  ({ source }) =>
    withDaemon(
      Effect.gen(function* () {
        const client = yield* UpnextClient;
        const since = yield* DateTime.now;
        const { url } = yield* client.SignIn({ source });

        yield* Console.error(
          `Sign in from the browser. If it didn't open, go to:\n${url}`,
        );

        const done = yield* client.WatchFeed().pipe(
          Stream.filter(isSignedIn(source, since)),
          Stream.runHead,
          Effect.timeoutOrElse({
            duration: signInTimeout,
            orElse: () => Effect.succeedNone,
          }),
        );

        if (Option.isNone(done)) {
          return yield* new CommandError({
            message: "Sign-in timed out. Run the command again to retry.",
          });
        }

        yield* Console.error("Signed in.");
      }),
    ),
).pipe(Command.withDescription("Sign in to a source that needs it"));

const watched = Command.make(
  "watched",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription("The item ID, as shown by feed --json"),
    ),
  },
  ({ id }) =>
    withDaemon(
      Effect.gen(function* () {
        const client = yield* UpnextClient;
        yield* client.MarkWatched({ id }).pipe(
          Effect.catchTag("ItemNotFound", () =>
            Effect.fail(
              new CommandError({
                message: `Nothing in the feed has the ID ${id}`,
              }),
            ),
          ),
        );
      }),
    ),
).pipe(Command.withDescription("Hide a YouTube upload or remove a saved item"));

const reportCliCause = (cause: Cause.Cause<unknown>) => {
  if (Cause.hasInterruptsOnly(cause)) {
    return Effect.failCause(cause);
  }

  const error = Cause.squash(cause);

  const setExitCode = Effect.sync(() => {
    process.exitCode = 1;
  });

  // effect/cli has already printed help and the usage error.
  if (CliError.isCliError(error)) {
    return setExitCode;
  }

  const message = Predicate.hasProperty(error, "message")
    ? String(error.message)
    : String(error);

  return Console.error(`upnext: ${message}`).pipe(Effect.andThen(setExitCode));
};

upnext.pipe(
  Command.withSubcommands([
    serve,
    feed,
    watch,
    recheck,
    auth,
    channel,
    queue,
    watched,
  ]),
  Command.run({ version: packageJson.version }),
  Effect.catchCause(reportCliCause),
  Effect.provide(
    Layer.mergeAll(BunServices.layer, Layer.succeed(Logger.LogToStderr, true)),
  ),
  BunRuntime.runMain,
);
