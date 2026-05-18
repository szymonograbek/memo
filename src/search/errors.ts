import { Schema } from "effect"

export class SearchError extends Schema.TaggedError<SearchError>()("SearchError", {
  message: Schema.String,
}) {}
