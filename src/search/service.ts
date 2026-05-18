import { Context, Effect, Layer } from "effect"
import fuzzysort from "fuzzysort"

import { MemoryNote } from "../memory/data.ts"
import { SearchResult } from "./data.ts"

export class SearchEngine extends Context.Tag("@memory/SearchEngine")<
  SearchEngine,
  {
    readonly search: (
      notes: readonly MemoryNote[],
      query: string,
      limit: number,
      offset: number,
      threshold: number | undefined,
    ) => Effect.Effect<readonly SearchResult[]>
  }
>() {
  static readonly layer = Layer.succeed(SearchEngine, {
    search: (notes, query, limit, offset, threshold) =>
      Effect.sync(() => {
        const results = notes.flatMap((note) => {
          const target = [
            note.path,
            note.body,
            ...Object.values(note.frontmatter).flat().map(String),
          ].join(" ")

          const result = fuzzysort.single(query, target)

          if (result === null) return []

          const recalled =
            typeof note.frontmatter.recalledTimes === "number" ? note.frontmatter.recalledTimes : 0

          const score = result.score + Math.min(recalled, 20) * 0.01

          if (threshold !== undefined && score < threshold) return []

          return [new SearchResult({ path: note.path, score, frontmatter: note.frontmatter })]
        })

        return results.sort((left, right) => right.score - left.score).slice(offset, offset + limit)
      }),
  })
}
