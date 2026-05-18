import { Layer } from "effect"
import { BunContext } from "@effect/platform-bun"
import { FetchHttpClient } from "@effect/platform"
import { Database } from "../db/service.ts"
import { MigratorLive } from "../db/migrator.ts"
import { EmbedderLive } from "../embed/live.ts"

/** Persistence: DB + migrations. */
export const InfraLive = MigratorLive.pipe(Layer.provideMerge(Database.layer))

/** Embedder with HTTP client (Gemini needs it; Transformers ignores it). */
export const EmbedderInfra = EmbedderLive.pipe(Layer.provide(FetchHttpClient.layer))

/** Full app composition root. Used by production AND tests. */
export const AppLive = Layer.mergeAll(InfraLive, EmbedderInfra, BunContext.layer)
