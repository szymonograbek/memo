import type { Effect } from "effect"
import type { Database } from "../../src/db/service.ts"
import type { Embedder } from "../../src/embed/service.ts"
import { TestRuntime } from "./live.ts"

export type TestContext = Database | Embedder

/**
 * Run an Effect against the shared test runtime. The runtime memoizes
 * the embedder pipeline and the DB across all tests in the process.
 */
export const runTest = <A, E>(
  eff: Effect.Effect<A, E, TestContext>,
): Promise<A> => TestRuntime.runPromise(eff)
