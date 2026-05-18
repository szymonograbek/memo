import { Config } from "effect"

export type ProviderName = "gemini" | "transformers"

export const ProviderConfig = Config.literal(
  "gemini",
  "transformers",
)("EMBEDDING_PROVIDER").pipe(Config.withDefault<ProviderName>("gemini"))

export const DimConfig = Config.integer("EMBEDDING_DIM").pipe(Config.withDefault(768))

export const GeminiConfig = Config.all({
  apiKey: Config.redacted("GEMINI_API_KEY"),
  model: Config.string("GEMINI_EMBEDDING_MODEL").pipe(Config.withDefault("gemini-embedding-001")),
})

export const TransformersConfig = Config.all({
  model: Config.string("TRANSFORMERS_EMBEDDING_MODEL").pipe(
    Config.withDefault("Xenova/all-MiniLM-L6-v2"),
  ),
})
