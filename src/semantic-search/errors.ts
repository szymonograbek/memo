import { Schema } from "effect"

export const SemanticSearchErrorReason = Schema.Literal("IndexInconsistent").annotations({
  identifier: "SemanticSearchErrorReason",
})

export type SemanticSearchErrorReason = typeof SemanticSearchErrorReason.Type

export class SemanticSearchError extends Schema.TaggedError<SemanticSearchError>()(
  "SemanticSearchError",
  {
    reason: SemanticSearchErrorReason,
    message: Schema.String,
  },
) {}
