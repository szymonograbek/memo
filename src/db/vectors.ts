import { Effect } from "effect"
import { Database } from "./service.ts"

/**
 * Bind a vector as JSON; libSQL's `vector32(?)` parses it into F32_BLOB.
 */
const vec = (v: ReadonlyArray<number>) => JSON.stringify(v)

export const upsertChunkVector = Effect.fnUntraced(function* (
  chunkId: number,
  vector: ReadonlyArray<number>,
) {
  const db = yield* Database
  yield* db.run(
    "UPDATE chunks SET embedding = vector32(?) WHERE id = ?",
    [vec(vector), chunkId],
  )
})

export type VecHit = { readonly id: number; readonly distance: number }

export const searchVectors = Effect.fnUntraced(function* (
  query: ReadonlyArray<number>,
  k: number,
) {
  const db = yield* Database
  return yield* db.all<VecHit>(
    `SELECT chunks.id AS id,
            vector_distance_cos(chunks.embedding, vector32(?)) AS distance
       FROM vector_top_k('chunks_embedding_idx', vector32(?), ?) AS v
       JOIN chunks ON chunks.rowid = v.id
      ORDER BY distance`,
    [vec(query), vec(query), k],
  )
})
