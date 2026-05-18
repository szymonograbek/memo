import { Schema } from "effect"

export const EmbedErrorReason = Schema.Literal(
  "ModelLoadFailed",
  "EmbeddingFailed",
  "ProviderRejected",
).annotations({ identifier: "EmbedErrorReason" })

export type EmbedErrorReason = typeof EmbedErrorReason.Type

export class EmbedError extends Schema.TaggedError<EmbedError>()("EmbedError", {
  reason: EmbedErrorReason,
  message: Schema.String,
}) {}
