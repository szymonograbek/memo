import { Schema } from "effect"

export const EmbedKind = Schema.Literal("query", "passage")
export type EmbedKind = typeof EmbedKind.Type

export class EmbedInput extends Schema.Class<EmbedInput>("EmbedInput")({
  text: Schema.NonEmptyString,
  kind: EmbedKind,
}) {}

export class Embedding extends Schema.Class<Embedding>("Embedding")({
  vector: Schema.Array(Schema.Number),
  model: Schema.String,
  dim: Schema.Number,
}) {}
