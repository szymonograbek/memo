import { Schema } from "effect"

export const MarkdownErrorReason = Schema.Literal(
  "InvalidJson",
  "InvalidFrontmatter",
  "UnknownTemplate",
  "EncodeFailed",
).annotations({ identifier: "MarkdownErrorReason" })
export type MarkdownErrorReason = typeof MarkdownErrorReason.Type

export class MarkdownError extends Schema.TaggedError<MarkdownError>()("MarkdownError", {
  reason: MarkdownErrorReason,
  message: Schema.String,
}) {}
