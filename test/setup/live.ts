import { Layer, ManagedRuntime } from "effect"
import { AppLive } from "../../src/app/layers.ts"
import { TestEnv } from "./env.ts"

/**
 * Production AppLive provided with test config. Same dependency graph
 * as `bun start`; only the ConfigProvider differs.
 */
export const TestLive = AppLive.pipe(Layer.provide(TestEnv))

/**
 * One ManagedRuntime per test process. Memoizes scoped resources
 * (the transformers pipeline, the libSQL client) so they load once
 * across all tests, not once per test.
 */
export const TestRuntime = ManagedRuntime.make(TestLive)
