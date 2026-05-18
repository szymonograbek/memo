import { Schema } from "effect"

export const MemoryErrorReason = Schema.Literal(
  "UnknownTemplate",
  "NoteNotFound",
  "AmbiguousNote",
  "NoteAlreadyExists",
  "UnsafePath",
  "ValidationFailed",
  "ConflictingArguments",
).annotations({ identifier: "MemoryErrorReason" })

export type MemoryErrorReason = typeof MemoryErrorReason.Type

/**
 * Domain-level Memory failures callers can react to. Filesystem and other
 * non-actionable failures bubble up as defects (`Effect.die`) instead.
 */
export class MemoryError extends Schema.TaggedError<MemoryError>()("MemoryError", {
  reason: MemoryErrorReason,
  message: Schema.String,
}) {}
