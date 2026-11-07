/**
 * The Code Mode surface. `upnext agent tools --json` describes each tool, and
 * `upnext agent call <tool>` runs one with its input as JSON on stdin, so the
 * OpenCode plugin in `opencode-plugin/` only needs the binary, and its tools
 * always match it. Copied from ha-bridge's.
 */
import {
  CandidatesRequest,
  ChannelCandidate,
  ChannelRequest,
  Feed,
  FeedItem,
  MarkWatchedRequest,
  QueueAddRequest,
  RecheckRequest,
  UpnextClient,
} from "@timmo001/effect-upnext";
import { Duration, Effect, Predicate, Schema } from "effect";
import { RpcClientError } from "effect/rpc/RpcClientError";

/** Why a Code Mode call failed. */
export class AgentError extends Schema.TaggedError<AgentError>()("AgentError", {
  message: Schema.String,
}) {}

const JsonObject = Schema.Record(Schema.String, Schema.Json);

/** One tool as the plugin registers it. */
export const ManifestTool = Schema.Struct({
  name: Schema.String,
  argv: Schema.Array(Schema.String),
  description: Schema.String,
  access: Schema.Literals(["read", "write"]),
  alwaysAsk: Schema.Boolean,
  pinned: Schema.Boolean,
  timeoutMillis: Schema.Int,
  json: Schema.Boolean,
  // The whole input goes to the command as JSON on stdin.
  stdin: Schema.Boolean,
  input: JsonObject,
  // The input key whose value narrows the write permission below the tool,
  // such as channel_add's source, so "always allow" covers one source.
  resource: Schema.optionalKey(Schema.String),
});

export type ManifestTool = typeof ManifestTool.Type;

/** Every tool, and whether the daemon's socket is there to call them. */
export const Manifest = Schema.Struct({
  available: Schema.Boolean,
  tools: Schema.Array(ManifestTool),
});

export type Manifest = typeof Manifest.Type;

interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly access: "read" | "write";
  readonly pinned: boolean;
  readonly timeout: Duration.Duration;
  readonly resource: string | undefined;
  readonly input: Schema.Json;
  readonly call: (
    text: string,
  ) => Effect.Effect<string, AgentError | RpcClientError, UpnextClient>;
}

const isJsonObject = Schema.is(JsonObject);

const decodeJson = Schema.decodeUnknownSync(Schema.Json);

const safeIntegerBounds = new Map([
  ["minimum", Number.MIN_SAFE_INTEGER],
  ["maximum", Number.MAX_SAFE_INTEGER],
]);

// Effect adds the safe-integer range to every Schema.Int; drop it as OpenCode
// does, so the catalogue's signatures stay short.
const dropSafeIntegerBounds = (schema: Schema.Json): Schema.Json => {
  if (Array.isArray(schema)) {
    return schema.map(dropSafeIntegerBounds);
  }

  if (!isJsonObject(schema)) {
    return schema;
  }

  const integer = schema["type"] === "integer";

  return Object.fromEntries(
    Object.entries(schema)
      .filter(
        ([key, value]) => !integer || safeIntegerBounds.get(key) !== value,
      )
      .map(([key, value]) => [key, dropSafeIntegerBounds(value)]),
  );
};

const jsonSchemaOf = (schema: Schema.Top) => {
  const document = Schema.toJsonSchemaDocument(schema, {
    onExcessProperty: "error",
  });

  return dropSafeIntegerBounds(
    decodeJson(
      Object.keys(document.definitions).length === 0
        ? document.schema
        : { ...document.schema, $defs: document.definitions },
    ),
  );
};

// Every daemon failure carries a message; connection failures pass through,
// for the CLI to explain.
const toAgentError = <E>(error: E) =>
  error instanceof RpcClientError
    ? error
    : new AgentError({
        message: Predicate.hasProperty(error, "message")
          ? String(error.message)
          : String(error),
      });

// Binds a tool's input and output schemas to its run, so each call decodes
// its stdin strictly and prints its result in the daemon's wire format.
const tool = <I, IE, O, OE, E>(definition: {
  readonly name: string;
  readonly description: string;
  readonly access: "read" | "write";
  readonly pinned?: boolean;
  readonly timeout?: Duration.Input;
  readonly resource?: string;
  readonly input: Schema.Codec<I, IE>;
  readonly output: Schema.Codec<O, OE>;
  readonly run: (input: I) => Effect.Effect<O, E, UpnextClient>;
}): AgentTool => {
  const timeout = Duration.fromInputUnsafe(definition.timeout ?? "2 minutes");

  const decode = Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.toCodecJson(definition.input)),
  );

  const encode = Schema.encodeEffect(Schema.toCodecJson(definition.output));

  return {
    name: definition.name,
    description: definition.description,
    access: definition.access,
    pinned: definition.pinned ?? false,
    timeout,
    resource: definition.resource,
    input: jsonSchemaOf(definition.input),
    call: (text) =>
      Effect.gen(function* () {
        const input = yield* decode(text.trim() === "" ? "{}" : text, {
          onExcessProperty: "error",
          errors: "all",
        }).pipe(
          Effect.mapError(
            (error) =>
              new AgentError({ message: `Invalid input: ${error.message}` }),
          ),
        );

        const result = yield* definition.run(input).pipe(
          Effect.mapError(toAgentError),
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () =>
              Effect.fail(
                new AgentError({ message: `${definition.name} timed out` }),
              ),
          }),
        );

        const encoded = yield* encode(result).pipe(
          Effect.mapError(
            (error) =>
              new AgentError({
                message: `Could not encode the result: ${error.message}`,
              }),
          ),
        );

        return JSON.stringify(encoded, null, 2);
      }),
  };
};

const withUpnext = <A, E>(
  f: (client: UpnextClient["Service"]) => Effect.Effect<A, E>,
) => Effect.flatMap(Effect.service(UpnextClient), f);

// Struct({}) accepts any keys, so a tool that takes none uses this instead.
const NoInput = Schema.Record(Schema.String, Schema.Never);

const Ok = Schema.Struct({ ok: Schema.Boolean });

const ok = { ok: true } as const;

/** Every Code Mode tool, in the order the catalogue lists them. */
export const agentTools: ReadonlyArray<AgentTool> = [
  tool({
    name: "feed",
    description:
      "Read the feed: live streams first, then new uploads, then saved items, with each source's status.",
    access: "read",
    pinned: true,
    input: NoInput,
    output: Feed,
    run: () => withUpnext((client) => client.GetFeed()),
  }),
  tool({
    name: "candidates",
    description:
      "List followed Twitch channels or YouTube subscriptions that aren't in the feed yet, by the name channel_add takes.",
    access: "read",
    input: CandidatesRequest,
    output: Schema.Array(ChannelCandidate),
    run: (input) => withUpnext((client) => client.ListCandidates(input)),
  }),
  tool({
    name: "recheck",
    description:
      "Check every source, or one, for new items now. With open, live channels set to auto-open are opened.",
    access: "write",
    timeout: "5 minutes",
    input: Schema.Struct({
      source: RecheckRequest.fields.source,
      open: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Open live channels set to auto-open; false by default",
      }),
    }),
    output: Ok,
    run: (input) =>
      withUpnext((client) =>
        client.Recheck({ ...input, open: input.open ?? false }),
      ).pipe(Effect.as(ok)),
  }),
  tool({
    name: "queue_add",
    description: "Save a URL to watch later.",
    access: "write",
    input: QueueAddRequest,
    output: FeedItem,
    run: (input) => withUpnext((client) => client.QueueAdd(input)),
  }),
  tool({
    name: "mark_watched",
    description:
      "Hide YouTube uploads or remove saved items from the feed, by their ids.",
    access: "write",
    input: MarkWatchedRequest,
    output: Ok,
    run: (input) =>
      withUpnext((client) => client.MarkWatched(input)).pipe(Effect.as(ok)),
  }),
  tool({
    name: "channel_add",
    description:
      "Follow a Twitch login or YouTube channel ID, or change its auto-open and YouTube notification settings.",
    access: "write",
    resource: "source",
    input: ChannelRequest,
    output: Ok,
    run: (input) =>
      withUpnext((client) => client.AddChannel(input)).pipe(Effect.as(ok)),
  }),
  tool({
    name: "channel_remove",
    description: "Stop following a Twitch login or YouTube channel ID.",
    access: "write",
    resource: "source",
    input: Schema.Struct({
      source: ChannelRequest.fields.source,
      name: Schema.String,
    }),
    output: Ok,
    run: (input) =>
      withUpnext((client) => client.RemoveChannel(input)).pipe(Effect.as(ok)),
  }),
];

/** The tool names `agent call` accepts. */
export const agentToolNames = agentTools.map(({ name }) => name);

/** The Code Mode manifest; `available` says whether the socket exists. */
export const manifest = (available: boolean): Manifest => ({
  available,
  tools: agentTools.map((entry) => ({
    name: entry.name,
    argv: ["agent", "call", entry.name],
    description: entry.description,
    access: entry.access,
    alwaysAsk: false,
    pinned: entry.pinned,
    timeoutMillis: Duration.toMillis(entry.timeout),
    json: true,
    stdin: true,
    input: isJsonObject(entry.input) ? entry.input : {},
    // JSON.stringify leaves it out when unset.
    resource: entry.resource,
  })),
});

/** Run one tool with its JSON input and return its JSON result. */
export const callAgentTool = Effect.fn("callAgentTool")(function* (
  name: string,
  text: string,
) {
  const entry = agentTools.find((candidate) => candidate.name === name);

  if (entry === undefined) {
    return yield* new AgentError({ message: `No tool ${name}` });
  }

  return yield* entry.call(text);
});
