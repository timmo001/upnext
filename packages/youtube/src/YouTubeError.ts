import { Schema } from "effect";

// A YouTube request failed. Messages never include the API key. `reason` is
// the API's own, such as quotaExceeded.
export class YouTubeError extends Schema.TaggedError<YouTubeError>()(
  "YouTubeError",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Finite),
    reason: Schema.optional(Schema.String),
  },
) {}

// Google rejected the sign-in or the refresh token, so signing in again is
// the fix.
export class YouTubeAuthError extends Schema.TaggedError<YouTubeAuthError>()(
  "YouTubeAuthError",
  { message: Schema.String },
) {}
