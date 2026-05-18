import { ConfigProvider, Layer } from "effect"

/**
 * Test-only ConfigProvider. Production uses real env; tests pin the values.
 *
 * - `:memory:` libSQL keeps every test process isolated and fast.
 * - `transformers` provider runs in-process so tests need no daemon/API key.
 * - 384 matches `Xenova/all-MiniLM-L6-v2`; change this and the model together.
 */
export const TestEnv = Layer.setConfigProvider(
  ConfigProvider.fromMap(
    new Map([
      ["MEMORIES_DB", ":memory:"],
      ["EMBEDDING_PROVIDER", "transformers"],
      ["EMBEDDING_DIM", "384"],
      ["TRANSFORMERS_EMBEDDING_MODEL", "Xenova/all-MiniLM-L6-v2"],
    ]),
  ),
)
