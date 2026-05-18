import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Database } from "../../src/db/service.ts"
import { Embedder } from "../../src/embed/service.ts"
import { searchVectors, upsertChunkVector } from "../../src/db/vectors.ts"
import { runTest } from "../setup/run.ts"

describe("end-to-end retrieval", () => {
  test("40px button query retrieves design-tokens memory", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const db = yield* Database
        const emb = yield* Embedder

        yield* db.run(
          "INSERT OR IGNORE INTO notes(path, content_hash, mtime, body, indexed_at) VALUES (?,?,?,?,?)",
          ["roundtrip.md", "h", 0, "b", 0],
        )
        yield* db.run("DELETE FROM chunks WHERE path = ?", ["roundtrip.md"])

        const memories = [
          "Use design tokens instead of magic numbers in styles",
          "Prefer composition over inheritance in components",
          "Walk the dog every morning before 8am",
        ]

        for (let i = 0; i < memories.length; i++) {
          yield* db.run(
            "INSERT INTO chunks(path, ord, text) VALUES (?, ?, ?)",
            ["roundtrip.md", i, memories[i]!],
          )
        }
        const rows = yield* db.all<{ id: number; ord: number; text: string }>(
          "SELECT id, ord, text FROM chunks WHERE path = ? ORDER BY ord",
          ["roundtrip.md"],
        )
        yield* Effect.forEach(
          rows,
          (row) =>
            Effect.gen(function* () {
              const e = yield* emb.embed({ text: row.text, kind: "passage" })
              yield* upsertChunkVector(row.id, e.vector)
            }),
          { discard: true },
        )

        const q = yield* emb.embed({
          text: "Add a wide button, 40px big",
          kind: "query",
        })
        const hits = yield* searchVectors(q.vector, 3)
        return { hits, rows }
      }),
    )
    expect(result.hits.length).toBeGreaterThan(0)
    const top = result.hits[0]!
    const winner = result.rows.find((r) => r.id === top.id)
    expect(winner?.ord).toBe(0) // index of design-tokens memory
  })
})
