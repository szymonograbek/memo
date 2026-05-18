import { Schema } from "effect"

export class Resolved extends Schema.TaggedClass<Resolved>()("Resolved", {
  target: Schema.String,
}) {}

export class Unresolved extends Schema.TaggedClass<Unresolved>()("Unresolved", {}) {}

export class Ambiguous extends Schema.TaggedClass<Ambiguous>()("Ambiguous", {
  candidates: Schema.Array(Schema.String),
}) {}

export const ResolvedTarget = Schema.Union(Resolved, Unresolved, Ambiguous)

export type ResolvedTarget = typeof ResolvedTarget.Type

export const isResolved = Schema.is(Resolved)

export const isUnresolved = Schema.is(Unresolved)

export const isAmbiguous = Schema.is(Ambiguous)
