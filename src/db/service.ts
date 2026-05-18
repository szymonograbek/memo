import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import { createClient, type Client, type InValue } from "@libsql/client"
import { Config, Context, Effect, Layer } from "effect"

/**
 * Low-level libsql failures are not actionable by application code in this
 * codebase — every caller simply propagates them. They are surfaced as
 * defects (`Effect.promise` lifts rejections into the defect channel) so the
 * typed error channels of higher-level services stay focused on domain
 * failures, per the architecture rules. OTEL spans capture the op + cause.
 */
const tryDb = <A>(op: string, f: () => Promise<A>): Effect.Effect<A> =>
  Effect.promise(f).pipe(Effect.withSpan(`Database.${op}`))

export class Database extends Context.Tag("@memory/Database")<
  Database,
  {
    readonly raw: Client
    readonly exec: (sql: string) => Effect.Effect<void>
    readonly run: (sql: string, params?: ReadonlyArray<InValue>) => Effect.Effect<void>
    readonly all: <T>(
      sql: string,
      params?: ReadonlyArray<InValue>,
    ) => Effect.Effect<ReadonlyArray<T>>
    readonly get: <T>(sql: string, params?: ReadonlyArray<InValue>) => Effect.Effect<T | null>
    readonly transaction: <A, E, R>(eff: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  }
>() {
  /**
   * Resolve the DB URL. Explicit `MEMORIES_DB` wins (use `:memory:` for
   * tests or `libsql://...` for remote). Otherwise the index lives next
   * to the markdown root: `${MEMORY_DIR}/.index/notes.db`.
   */
  static readonly UrlConfig = Config.string("MEMORIES_DB").pipe(
    Config.orElse(() =>
      Config.string("MEMORY_DIR").pipe(
        Config.withDefault("memory-data"),
        Config.map((dir) => `file:${dir}/.index/notes.db`),
      ),
    ),
  )

  static readonly layer = Layer.scoped(
    Database,
    Effect.gen(function* () {
      const url = yield* Database.UrlConfig

      const client = yield* Effect.acquireRelease(
        Effect.sync(() => {
          // libSQL doesn't create intermediate dirs for `file:` URLs.
          // `:memory:` and `libsql://` URLs have no fs path to create.
          const filePath = url.startsWith("file:") ? url.slice("file:".length) : null

          if (filePath !== null && filePath !== ":memory:") {
            mkdirSync(dirname(filePath), { recursive: true })
          }

          return createClient({ url })
        }),
        (c) => Effect.sync(() => c.close()),
      )

      yield* tryDb("pragma", () =>
        client.executeMultiple(`
          PRAGMA foreign_keys = ON;
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
        `),
      ).pipe(Effect.ignore) // in-memory DBs reject some PRAGMAs; non-fatal

      const exec = (sql: string) =>
        tryDb("exec", () => client.executeMultiple(sql)).pipe(Effect.asVoid)

      const run = (sql: string, params: ReadonlyArray<InValue> = []) =>
        tryDb("run", () => client.execute({ sql, args: [...params] })).pipe(Effect.asVoid)

      const all = <T>(sql: string, params: ReadonlyArray<InValue> = []) =>
        tryDb("all", () => client.execute({ sql, args: [...params] })).pipe(
          Effect.map((rs) => rs.rows as unknown as ReadonlyArray<T>),
        )

      const get = <T>(sql: string, params: ReadonlyArray<InValue> = []) =>
        all<T>(sql, params).pipe(Effect.map((rows) => rows[0] ?? null))

      const transaction = Effect.fnUntraced(function* <A, E, R>(eff: Effect.Effect<A, E, R>) {
        yield* run("BEGIN")
        const result = yield* Effect.either(eff)

        if (result._tag === "Left") {
          yield* run("ROLLBACK").pipe(Effect.ignore)

          return yield* Effect.fail(result.left)
        }
        yield* run("COMMIT")

        return result.right
      })

      return Database.of({ raw: client, exec, run, all, get, transaction })
    }),
  )
}
