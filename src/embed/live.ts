import { Effect, Layer } from "effect"

import { ProviderConfig } from "./config.ts"
import { GeminiEmbedderLive } from "./gemini.ts"
import { TransformersEmbedderLive } from "./transformers.ts"

/**
 * Selects an Embedder implementation based on EMBEDDING_PROVIDER.
 * The unused branches' configs are not evaluated, so missing API keys
 * for unselected providers don't fail startup.
 *
 * Both branches share the same HttpClient requirement (Gemini needs it;
 * Transformers ignores it) so callers always provide HttpClient.
 */
export const EmbedderLive = Layer.unwrapEffect(
  Effect.map(ProviderConfig, (provider) => {
    switch (provider) {
      case "gemini":
        return GeminiEmbedderLive
      case "transformers":
        return TransformersEmbedderLive
    }
  }),
)
