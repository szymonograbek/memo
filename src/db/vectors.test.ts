import { describe, expect, test } from "bun:test"

import { Effect } from "effect"

import { runTest } from "../../test/setup/run.ts"
import { Database } from "./service.ts"
import { searchVectors, upsertChunkVector } from "./vectors.ts"

const oneHot = (i: number, dim = 384) => Array.from({ length: dim }, (_, k) => (k === i ? 1 : 0))

describe("vector storage", () => {
  test("top-1 recall on identical vector", async () => {
    const hits = await runTest(
      Effect.gen(function* () {
        const db = yield* Database

        // Each test starts from the same in-memory DB; isolate by unique path.
        yield* db.run(
          "INSERT OR IGNORE INTO notes(path, content_hash, mtime, body, indexed_at) VALUES (?,?,?,?,?)",
          ["vec-test.md", "h", 0, "b", 0],
        )
        yield* db.run("DELETE FROM chunks WHERE path = ?", ["vec-test.md"])
        yield* db.run(
          "INSERT INTO chunks(path, ord, text) VALUES (?, 0, 'alpha'), (?, 1, 'beta')",
          ["vec-test.md", "vec-test.md"],
        )

        const ids = yield* db.all<{ id: number }>(
          "SELECT id FROM chunks WHERE path = ? ORDER BY ord",
          ["vec-test.md"],
        )

        const [a, b] = ids

        yield* upsertChunkVector(a!.id, oneHot(0))
        yield* upsertChunkVector(b!.id, oneHot(1))
        const hits = yield* searchVectors(oneHot(0), 2)

        return { hits, ids }
      }),
    )

    const [a, b] = hits.ids

    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(hits.hits[0]?.id).toBe(a!.id)
    expect(hits.hits[0]!.distance).toBeLessThan(hits.hits[1]!.distance)
  })
})
