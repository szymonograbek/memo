import { MemoryNote } from "../memory/data.ts"
import { Ambiguous, Resolved, ResolvedTarget, Unresolved } from "./data.ts"

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
