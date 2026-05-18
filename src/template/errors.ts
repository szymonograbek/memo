import { Schema } from "effect"

export const TemplateErrorReason = Schema.Literal(
  "ValidationFailed",
  "MissingPlaceholder",
  "InvalidTemplateFile",
  "ReadFailed",
).annotations({ identifier: "TemplateErrorReason" })
export type TemplateErrorReason = typeof TemplateErrorReason.Type

export class TemplateError extends Schema.TaggedError<TemplateError>()("TemplateError", {
  reason: TemplateErrorReason,
  message: Schema.String,
}) {}
