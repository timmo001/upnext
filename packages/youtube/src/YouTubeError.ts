import { Schema } from "effect";

// A YouTube request failed. Messages never include the API key.
export class YouTubeError extends Schema.TaggedError<YouTubeError>()(
  "YouTubeError",
  { message: Schema.String, status: Schema.optional(Schema.Finite) },
) {}
