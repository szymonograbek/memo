import { Schema } from "effect"
import { MemoryNote } from "./model.ts"

export class Resolved extends Schema.TaggedClass<Resolved>()("Resolved", { target: Schema.String }) {}
export class Unresolved extends Schema.TaggedClass<Unresolved>()("Unresolved", {}) {}
export class Ambiguous extends Schema.TaggedClass<Ambiguous>()("Ambiguous", { candidates: Schema.Array(Schema.String) }) {}

export const ResolvedTarget = Schema.Union(Resolved, Unresolved, Ambiguous)
export type ResolvedTarget = typeof ResolvedTarget.Type

export const isResolved = Schema.is(Resolved)
export const isUnresolved = Schema.is(Unresolved)
export const isAmbiguous = Schema.is(Ambiguous)

export const noteKey = (note: MemoryNote) => note.path.replace(/\.md$/, "")

export const extractLinks = (text: string) => [...text.matchAll(/\[\[([^\]]+)\]\]/g)]
  .map((match) => match[1]?.split("|")[0]?.split("#")[0]?.trim())
  .filter((target): target is string => target !== undefined && target.length > 0)

export const resolveTarget = (target: string, keys: ReadonlySet<string>): ResolvedTarget => {
  const normalized = target.replace(/\.md$/, "")
  if (keys.has(normalized)) return new Resolved({ target: normalized })
  const suffix = `/${normalized}`
  const candidates = [...keys].filter((key) => key.endsWith(suffix) || key.split("/").at(-1) === normalized)
  const [candidate] = candidates
  if (candidate !== undefined && candidates.length === 1) return new Resolved({ target: candidate })
  if (candidates.length === 0) return new Unresolved()
  return new Ambiguous({ candidates })
}
