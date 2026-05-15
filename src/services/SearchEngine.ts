import { Context, Effect, Layer, Schema } from "effect"
import fuzzysort from "fuzzysort"
import { MemoryNote, SearchResult } from "../models/model.ts"

export class SearchEngine extends Context.Tag("@memory/SearchEngine")<SearchEngine, {
  readonly search: (notes: readonly MemoryNote[], query: string, limit: number, offset: number) => Effect.Effect<readonly SearchResult[]>
}>() {
  static readonly layer = Layer.succeed(SearchEngine, {
    search: (notes, query, limit, offset) => Effect.sync(() => {
      const results = notes.flatMap((note) => {
        const target = [note.path, note.body, ...Object.values(note.frontmatter).flat().map(String)].join(" ")
        const result = fuzzysort.single(query, target)
        if (result === null) return []
        const recalled = typeof note.frontmatter.recalledTimes === "number" ? note.frontmatter.recalledTimes : 0
        const score = result.score + Math.min(recalled, 20) * 0.01
        return [new SearchResult({ path: note.path, score, frontmatter: note.frontmatter })]
      })
      return results.sort((left, right) => right.score - left.score).slice(offset, offset + limit)
    }),
  })
}

export class SearchError extends Schema.TaggedError<SearchError>()("SearchError", {
  message: Schema.String,
}) {}
