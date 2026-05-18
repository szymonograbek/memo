import { Effect } from "effect"

import { Database } from "../../src/db/service.ts"
import { upsertChunkVector } from "../../src/db/vectors.ts"
import { Embedder } from "../../src/embed/service.ts"

export interface SeededChunk {
  readonly id: number
  readonly ord: number
  readonly text: string
}

/**
 * Insert chunks, embed them, store vectors. Returns chunks in input order
 * so tests can map ids back to intent without leaking SQL.
 *
 * Tests share one in-memory DB via the memoized runtime, so this clears
 * all chunks (and their notes) before seeding. Each test then sees only
 * the memories it asked for — `searchVectors` won't surface noise from
 * other tests' fixtures.
 */
export const seedMemories = Effect.fnUntraced(function* (
  texts: ReadonlyArray<string>,
  pathHint?: string,
) {
  const db = yield* Database
  const emb = yield* Embedder
  const path = `seed/${pathHint ?? crypto.randomUUID()}.md`

  // Wipe prior fixtures so retrieval scope is exactly `texts`.
  yield* db.run("DELETE FROM chunks")
  yield* db.run("DELETE FROM notes")

  yield* db.run(
    "INSERT INTO notes(path, content_hash, mtime, body, indexed_at) VALUES (?,?,?,?,?)",
    [path, "h", 0, "b", 0],
  )

  for (let i = 0; i < texts.length; i++) {
    yield* db.run("INSERT INTO chunks(path, ord, text) VALUES (?, ?, ?)", [path, i, texts[i]!])
  }

  const rows = yield* db.all<SeededChunk>(
    "SELECT id, ord, text FROM chunks WHERE path = ? ORDER BY ord",
    [path],
  )

  yield* Effect.forEach(
    rows,
    Effect.fnUntraced(function* (row: SeededChunk) {
      const e = yield* emb.embed({ text: row.text, kind: "passage" })

      yield* upsertChunkVector(row.id, e.vector)
    }),
    { discard: true },
  ).pipe(
    // Embedder failures here mean a broken test setup, not a domain error.
    Effect.catchTag("EmbedError", (cause) => Effect.die(cause)),
  )

  return rows
}) as (
  texts: ReadonlyArray<string>,
  pathHint?: string,
) => Effect.Effect<ReadonlyArray<SeededChunk>, never, Database | Embedder>
