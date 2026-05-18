import { createHash } from "node:crypto"

import { Context, Effect, Layer } from "effect"

import { Database } from "../db/service.ts"
import { searchVectors, upsertChunkVector } from "../db/vectors.ts"
import { EmbedError } from "../embed/errors.ts"
import { Embedder } from "../embed/service.ts"
import { MarkdownError } from "../markdown/errors.ts"
import type { Frontmatter } from "../memory/data.ts"
import { MemoryError } from "../memory/errors.ts"
import { MemoryService } from "../memory/service.ts"
import { SearchResult } from "../search/data.ts"
import { TemplateError } from "../template/errors.ts"
import { SemanticSearchError } from "./errors.ts"

type Errors = SemanticSearchError | EmbedError | MemoryError | MarkdownError | TemplateError

export interface ReindexStats {
  readonly indexed: number
  readonly unchanged: number
  readonly removed: number
}

const hashBody = (body: string) => createHash("sha256").update(body).digest("hex")

export class SemanticSearch extends Context.Tag("@memory/SemanticSearch")<
  SemanticSearch,
  {
    /**
     * Sync the index to the live filesystem. Notes are keyed by path;
     * unchanged bodies (by content hash) are skipped, changed bodies are
     * re-embedded, missing paths are deleted.
     */
    readonly reindex: () => Effect.Effect<ReindexStats, Errors>

    /**
     * Embed `query` and return the top notes by cosine similarity.
     * `score` is `1 - cosine_distance`, higher is better.
     * Optional `type` filters by frontmatter `type` field.
     */
    readonly search: (
      query: string,
      limit: number,
      offset: number,
      type: string | undefined,
      threshold: number | undefined,
    ) => Effect.Effect<ReadonlyArray<SearchResult>, Errors>
  }
>() {
  static readonly layer = Layer.effect(
    SemanticSearch,
    Effect.gen(function* () {
      const db = yield* Database
      const emb = yield* Embedder
      const memory = yield* MemoryService

      // Helpers in db/vectors.ts pull Database from context; supply the
      // already-acquired client so the public methods report R = never.
      const provideDeps = <A, E, R>(eff: Effect.Effect<A, E, R>) =>
        eff.pipe(
          Effect.provideService(Database, db),
          Effect.provideService(Embedder, emb),
          Effect.provideService(MemoryService, memory),
        )

      const reindexOne = Effect.fnUntraced(function* (note: {
        readonly path: string
        readonly body: string
        readonly frontmatter: Readonly<Record<string, unknown>>
      }) {
        const now = Date.now()

        // Replace any prior row+chunks for this path (cascade clears chunks).
        yield* db.run("DELETE FROM notes WHERE path = ?", [note.path])
        yield* db.run(
          `INSERT INTO notes(path, content_hash, mtime, frontmatter, body, indexed_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          [note.path, hashBody(note.body), now, JSON.stringify(note.frontmatter), note.body, now],
        )
        yield* db.run("INSERT INTO chunks(path, ord, text) VALUES (?, 0, ?)", [
          note.path,
          note.body,
        ])

        const row = yield* db.get<{ id: number }>(
          "SELECT id FROM chunks WHERE path = ? AND ord = 0",
          [note.path],
        )

        if (!row) {
          return yield* new SemanticSearchError({
            reason: "IndexInconsistent",
            message: `failed to read back chunk id for ${note.path}`,
          })
        }
        const e = yield* emb.embed({ text: note.body, kind: "passage" })

        yield* upsertChunkVector(row.id, e.vector)
      })

      const reindex = Effect.fn("SemanticSearch.reindex")(function* () {
        return yield* provideDeps(
          Effect.gen(function* () {
            const notes = yield* memory.list()

            const existing = yield* db.all<{ path: string; content_hash: string }>(
              "SELECT path, content_hash FROM notes",
            )

            const existingHash = new Map(existing.map((r) => [r.path, r.content_hash]))
            const currentPaths = new Set(notes.map((n) => n.path))

            let indexed = 0
            let unchanged = 0
            let removed = 0

            for (const [path] of existingHash) {
              if (currentPaths.has(path)) continue
              yield* db.run("DELETE FROM notes WHERE path = ?", [path])
              removed += 1
            }

            for (const note of notes) {
              const fresh = hashBody(note.body)

              if (existingHash.get(note.path) === fresh) {
                unchanged += 1
                continue
              }
              yield* reindexOne(note)
              indexed += 1
            }

            return { indexed, unchanged, removed } satisfies ReindexStats
          }),
        )
      })

      interface Row {
        readonly path: string
        readonly frontmatter: string
        readonly distance: number
      }

      const search = Effect.fn("SemanticSearch.search")(function* (
        query: string,
        limit: number,
        offset: number,
        type: string | undefined,
        threshold: number | undefined,
      ) {
        return yield* provideDeps(
          Effect.gen(function* () {
            const q = yield* emb.embed({ text: query, kind: "query" })
            // Over-fetch by `offset` so pagination has material to drop.
            const k = Math.max(limit + offset, 1)
            const hits = yield* searchVectors(q.vector, k)

            const rows = yield* Effect.forEach(hits, (h) =>
              db
                .get<{ path: string; frontmatter: string }>(
                  `SELECT c.path AS path, n.frontmatter AS frontmatter
                 FROM chunks c
                 JOIN notes  n ON n.path = c.path
                WHERE c.id = ?`,
                  [h.id],
                )
                .pipe(
                  Effect.map((row): Row | null =>
                    row
                      ? {
                          path: row.path,
                          frontmatter: row.frontmatter,
                          distance: h.distance,
                        }
                      : null,
                  ),
                ),
            )

            const filtered = rows.flatMap((r): ReadonlyArray<SearchResult> => {
              if (!r) return []
              const fm = JSON.parse(r.frontmatter) as Frontmatter

              if (type !== undefined && fm.type !== type) return []
              const score = 1 - r.distance

              if (threshold !== undefined && score < threshold) return []

              return [
                new SearchResult({
                  path: r.path,
                  score,
                  frontmatter: fm,
                }),
              ]
            })

            return filtered.slice(offset, offset + limit)
          }),
        )
      })

      return SemanticSearch.of({ reindex, search })
    }),
  )
}
