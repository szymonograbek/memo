import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers"
import { Effect, Layer } from "effect"

import { DimConfig, TransformersConfig } from "./config.ts"
import { type EmbedInput, Embedding } from "./data.ts"
import { EmbedError } from "./errors.ts"
import { Embedder } from "./service.ts"

export const TransformersEmbedderLive = Layer.scoped(
  Embedder,
  Effect.gen(function* () {
    const { model } = yield* TransformersConfig
    const dim = yield* DimConfig

    const extractor = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => pipeline("feature-extraction", model) as Promise<FeatureExtractionPipeline>,
        catch: (cause) =>
          new EmbedError({
            reason: "ModelLoadFailed",
            message: `failed to load model ${model}: ${String(cause)}`,
          }),
      }),
      () => Effect.void,
    )

    const embedOne = (text: string) =>
      Effect.tryPromise({
        try: async () => {
          const out = await extractor(text, { pooling: "mean", normalize: true })

          return Array.from(out.data as Float32Array) as ReadonlyArray<number>
        },
        catch: (cause) =>
          new EmbedError({ reason: "EmbeddingFailed", message: `embed failed: ${String(cause)}` }),
      }).pipe(
        // Dimension mismatch is a config/code bug, not an actionable runtime
        // error \u2014 fail as a defect so callers don't have to handle it.
        Effect.flatMap((vec) =>
          vec.length === dim
            ? Effect.succeed(vec)
            : Effect.die(`Transformers model produced dim ${vec.length}, EMBEDDING_DIM is ${dim}`),
        ),
      )

    const make = (vector: ReadonlyArray<number>) => new Embedding({ vector, model, dim })

    return Embedder.of({
      model,
      dim,
      embed: (input: EmbedInput) => embedOne(input.text).pipe(Effect.map(make)),
      embedMany: (inputs: ReadonlyArray<EmbedInput>) =>
        Effect.forEach(inputs, (i) => embedOne(i.text), { concurrency: 2 }).pipe(
          Effect.map((vecs) => vecs.map(make)),
        ),
    })
  }),
)
