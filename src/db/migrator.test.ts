import { describe, expect, test } from "bun:test"

import { Effect } from "effect"

import { runTest } from "../../test/setup/run.ts"
import { Database } from "./service.ts"

describe("Migrator", () => {
  test("applies all migrations", async () => {
    const ids = await runTest(
      Effect.gen(function* () {
        const db = yield* Database

        return yield* db.all<{ id: number }>("SELECT id FROM schema_migrations ORDER BY id")
      }),
    )

    expect(ids.map((r) => r.id)).toEqual([1, 2])
  })

  test("creates the core tables", async () => {
    const tables = await runTest(
      Effect.gen(function* () {
        const db = yield* Database

        return yield* db.all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
      }),
    )

    const names = tables.map((t) => t.name)

    for (const required of ["notes", "chunks", "links", "meta"]) {
      expect(names).toContain(required)
    }
  })

  test("chunks.embedding column uses configured dim", async () => {
    const cols = await runTest(
      Effect.gen(function* () {
        const db = yield* Database

        return yield* db.all<{ name: string; type: string }>("PRAGMA table_info(chunks)")
      }),
    )

    const embedding = cols.find((c) => c.name === "embedding")

    expect(embedding).toBeDefined()
    expect(embedding?.type.toUpperCase()).toContain("F32_BLOB(384)")
  })
})
