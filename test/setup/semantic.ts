import { Effect, Layer, ManagedRuntime } from "effect"
import { BunContext } from "@effect/platform-bun"
import { InfraLive, EmbedderInfra } from "../../src/app/layers.ts"
import { Database } from "../../src/db/service.ts"
import { MemoryService } from "../../src/memory/service.ts"
import { SemanticSearch } from "../../src/semantic-search/service.ts"
import type { Workspace } from "../helpers.ts"
import { TestEnv } from "./env.ts"

/**
 * Heavy infrastructure shared across tests: in-memory libSQL + migrations +
 * transformers embedder + Bun platform services. One ManagedRuntime per
 * test process so the embedder pipeline loads once.
 *
 * MemoryService is layered per-test because it depends on the workspace's
 * filesystem paths; layering it here would tie the runtime to a single
 * workspace.
 */
const HeavyInfra = Layer.mergeAll(InfraLive, EmbedderInfra, BunContext.layer).pipe(
  Layer.provide(TestEnv),
)

const HeavyRuntime = ManagedRuntime.make(HeavyInfra)

/**
 * Run an Effect with both filesystem-backed MemoryService and DB-backed
 * SemanticSearch available. Wipes the index before each test so the
 * workspace's notes are the only ones SemanticSearch sees after reindex.
 */
export const runWithSemantic = <A, E>(
  workspace: Workspace,
  effect: Effect.Effect<A, E, SemanticSearch | MemoryService | Database>,
): Promise<A> => {
  const PerTest = SemanticSearch.layer.pipe(
    Layer.provide(
      MemoryService.layer({
        rootDir: workspace.rootDir,
        templateDirs: [workspace.templateDir],
      }),
    ),
  )

  return HeavyRuntime.runPromise(
    Effect.gen(function* () {
      const db = yield* Database
      yield* db.run("DELETE FROM chunks")
      yield* db.run("DELETE FROM notes")
      return yield* effect
    }).pipe(Effect.provide(PerTest)),
  )
}
