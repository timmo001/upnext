import {
  Array as Arr,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
  String as Str,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { XMLParser } from "fast-xml-parser";
import { type FeedEntry, VideoDetails } from "./Media.js";
import { YouTubeAuthError, YouTubeError } from "./YouTubeError.js";

const feedEndpoint = "https://www.youtube.com/feeds/videos.xml";

const videosEndpoint = "https://www.googleapis.com/youtube/v3/videos";

const subscriptionsEndpoint =
  "https://www.googleapis.com/youtube/v3/subscriptions";

const oembedEndpoint = "https://www.youtube.com/oembed";

// videos.list takes up to 50 IDs per call.
const maxPerRequest = 50;

// Tag values stay strings, so a title like "1984" isn't read as a number.
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === "entry",
});

const FeedXml = Schema.Struct({
  feed: Schema.Struct({
    entry: Schema.optional(
      Schema.Array(
        Schema.Struct({
          "yt:videoId": Schema.String,
          "yt:channelId": Schema.String,
          title: Schema.String,
          author: Schema.Struct({ name: Schema.String }),
          published: Schema.DateTimeUtcFromString,
        }),
      ),
    ),
  }),
});

const VideosResponse = Schema.Struct({
  items: Schema.Array(VideoDetails),
});

// A channel the signed-in account subscribes to.
export const Subscription = Schema.Struct({
  channelId: Schema.String,
  title: Schema.String,
});

export type Subscription = typeof Subscription.Type;

const SubscriptionsResponse = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      snippet: Schema.Struct({
        title: Schema.String,
        resourceId: Schema.Struct({ channelId: Schema.String }),
      }),
    }),
  ),
  nextPageToken: Schema.optional(Schema.String),
});

const ApiErrorBody = Schema.Struct({
  error: Schema.Struct({ message: Schema.String }),
});

export const OEmbed = Schema.Struct({
  title: Schema.String,
  author_name: Schema.String,
  author_url: Schema.String,
  thumbnail_url: Schema.optional(Schema.String),
});

export type OEmbed = typeof OEmbed.Type;

export interface YouTubeClientOptions {
  // Needed to look up videos without signing in. Feeds and oEmbed work
  // without one.
  readonly apiKey: Option.Option<Redacted.Redacted>;
  // From a Google sign-in. Reads subscriptions, and looks up videos when
  // there's no API key.
  readonly accessToken?: Option.Option<Redacted.Redacted>;
}

export interface YouTubeClientService {
  // Whether videos can be looked up, with an API key or a sign-in.
  readonly hasApiKey: boolean;
  // The latest 15 uploads, newest first, from a channel's RSS feed.
  readonly channelFeed: (
    channelId: string,
  ) => Effect.Effect<ReadonlyArray<FeedEntry>, YouTubeError>;
  // Live state and times for each video, 50 at a time. Needs an API key or a
  // sign-in.
  readonly videos: (
    videoIds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<VideoDetails>, YouTubeError>;
  // Every channel the signed-in account subscribes to. Needs a sign-in.
  readonly subscriptions: Effect.Effect<
    ReadonlyArray<Subscription>,
    YouTubeError | YouTubeAuthError
  >;
  readonly oembed: (url: string) => Effect.Effect<OEmbed, YouTubeError>;
}

const failed = (context: string) => (cause: { message: string }) =>
  new YouTubeError({ message: `${context}: ${cause.message}` });

const checkStatus = (
  context: string,
  response: HttpClientResponse.HttpClientResponse,
) =>
  response.status >= 200 && response.status < 300
    ? Effect.succeed(response)
    : HttpClientResponse.schemaBodyJson(ApiErrorBody)(response).pipe(
        Effect.map(({ error }) => `: ${error.message}`),
        Effect.orElseSucceed(() => ""),
        Effect.flatMap((reason) =>
          Effect.fail(
            new YouTubeError({
              message: `${context} failed with status ${response.status}${reason}`,
              status: response.status,
            }),
          ),
        ),
      );

export const make = Effect.fn("YouTubeClient.make")(function* (
  options: YouTubeClientOptions,
) {
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.retryTransient({ times: 3 }),
  );

  const fetch = (
    context: string,
    request: HttpClientRequest.HttpClientRequest,
  ) =>
    http.execute(request).pipe(
      Effect.mapError(failed(context)),
      Effect.flatMap((response) => checkStatus(context, response)),
    );

  const channelFeed = (channelId: string) => {
    const context = `read the feed for ${channelId}`;

    return fetch(
      context,
      HttpClientRequest.get(feedEndpoint).pipe(
        HttpClientRequest.setUrlParam("channel_id", channelId),
      ),
    ).pipe(
      Effect.flatMap((response) =>
        response.text.pipe(
          Effect.flatMap((xml) =>
            Effect.try(() => parser.parse(xml)).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(FeedXml)),
            ),
          ),
          Effect.mapError(failed(context)),
        ),
      ),
      Effect.map(({ feed }) =>
        Arr.map(feed.entry ?? [], (entry): FeedEntry => ({
          videoId: entry["yt:videoId"],
          channelId: entry["yt:channelId"],
          channelName: entry.author.name,
          title: entry.title,
          publishedAt: entry.published,
        })),
      ),
      Effect.withSpan("YouTubeClient.channelFeed"),
    );
  };

  // The key goes in a header, so it never shows up in a logged URL. Without
  // a key, the sign-in's token is used instead.
  const apiKey = Option.filter(options.apiKey, (key) =>
    Str.isNonEmpty(Redacted.value(key)),
  );

  const accessToken = Option.filter(
    options.accessToken ?? Option.none(),
    (token) => Str.isNonEmpty(Redacted.value(token)),
  );

  const bearer = (token: Redacted.Redacted) =>
    HttpClientRequest.setHeader(
      "Authorization",
      `Bearer ${Redacted.value(token)}`,
    );

  const authenticate = Option.orElse(
    Option.map(apiKey, (key) =>
      HttpClientRequest.setHeader("X-Goog-Api-Key", Redacted.value(key)),
    ),
    () => Option.map(accessToken, bearer),
  );

  const videos = (videoIds: ReadonlyArray<string>) =>
    Option.match(authenticate, {
      onNone: () =>
        Effect.fail(
          new YouTubeError({
            message: "looking up videos needs an API key or a sign-in",
          }),
        ),
      onSome: (withAuth) =>
        Effect.forEach(
          Arr.chunksOf(Arr.dedupe(videoIds), maxPerRequest),
          (chunk) =>
            fetch(
              "look up videos",
              HttpClientRequest.get(videosEndpoint).pipe(
                HttpClientRequest.setUrlParams({
                  part: "snippet,liveStreamingDetails",
                  id: Arr.join(chunk, ","),
                  maxResults: String(maxPerRequest),
                }),
                withAuth,
              ),
            ).pipe(
              Effect.flatMap((response) =>
                HttpClientResponse.schemaBodyJson(VideosResponse)(
                  response,
                ).pipe(Effect.mapError(failed("read videos"))),
              ),
              Effect.map(({ items }) => items),
            ),
        ).pipe(Effect.map(Arr.flatten)),
    }).pipe(Effect.withSpan("YouTubeClient.videos"));

  const subscriptionsPage = (
    token: Redacted.Redacted,
    pageToken: Option.Option<string>,
  ): Effect.Effect<
    ReadonlyArray<Subscription>,
    YouTubeError | YouTubeAuthError
  > =>
    fetch(
      "read subscriptions",
      HttpClientRequest.get(subscriptionsEndpoint).pipe(
        HttpClientRequest.setUrlParams({
          part: "snippet",
          mine: "true",
          maxResults: String(maxPerRequest),
          ...Option.match(pageToken, {
            onNone: () => ({}),
            onSome: (value) => ({ pageToken: value }),
          }),
        }),
        bearer(token),
      ),
    ).pipe(
      Effect.catchIf(
        (error) => error.status === 401,
        () =>
          Effect.fail(
            new YouTubeAuthError({ message: "Google rejected the sign-in" }),
          ),
      ),
      Effect.flatMap((response) =>
        HttpClientResponse.schemaBodyJson(SubscriptionsResponse)(response).pipe(
          Effect.mapError(failed("read subscriptions")),
        ),
      ),
      Effect.flatMap(({ items, nextPageToken }) => {
        const page = Arr.map(items, ({ snippet }): Subscription => ({
          channelId: snippet.resourceId.channelId,
          title: snippet.title,
        }));

        return Option.match(Option.fromUndefinedOr(nextPageToken), {
          onNone: () => Effect.succeed(page),
          onSome: (next) =>
            Effect.map(subscriptionsPage(token, Option.some(next)), (rest) =>
              Arr.appendAll(page, rest),
            ),
        });
      }),
    );

  const subscriptions = Option.match(accessToken, {
    onNone: () =>
      Effect.fail(
        new YouTubeAuthError({
          message: "reading subscriptions needs a sign-in",
        }),
      ),
    onSome: (token) => subscriptionsPage(token, Option.none()),
  }).pipe(Effect.withSpan("YouTubeClient.subscriptions"));

  const oembed = (url: string) =>
    fetch(
      "look up the video",
      HttpClientRequest.get(oembedEndpoint).pipe(
        HttpClientRequest.setUrlParams({ url, format: "json" }),
      ),
    ).pipe(
      Effect.flatMap((response) =>
        HttpClientResponse.schemaBodyJson(OEmbed)(response).pipe(
          Effect.mapError(failed("read the video details")),
        ),
      ),
      Effect.withSpan("YouTubeClient.oembed"),
    );

  return {
    hasApiKey: Option.isSome(authenticate),
    channelFeed,
    videos,
    subscriptions,
    oembed,
  } satisfies YouTubeClientService;
});

export class YouTubeClient extends Context.Service<
  YouTubeClient,
  YouTubeClientService
>()("@timmo001/effect-youtube/YouTubeClient") {
  static readonly layer = (options: YouTubeClientOptions) =>
    Layer.effect(YouTubeClient, Effect.map(make(options), YouTubeClient.of));
}
