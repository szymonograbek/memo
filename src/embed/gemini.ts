import { Array as Arr, Effect, Layer, Redacted, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform"
import { DimConfig, GeminiConfig } from "./config.ts"
import { type EmbedInput, Embedding } from "./data.ts"
import { EmbedError } from "./errors.ts"
import { Embedder } from "./service.ts"

const BatchResponse = Schema.Struct({
  embeddings: Schema.Array(Schema.Struct({ values: Schema.Array(Schema.Number) })),
}).annotations({ identifier: "GeminiBatchResponse" })

const MAX_BATCH = 100

const taskTypeFor = (kind: "query" | "passage") =>
  kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT"

export const GeminiEmbedderLive = Layer.effect(
  Embedder,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const { apiKey, model } = yield* GeminiConfig
    const dim = yield* DimConfig

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`
    const modelPath = `models/${model}`

    const callBatch = (
      texts: ReadonlyArray<string>,
      kind: "query" | "passage",
    ): Effect.Effect<typeof BatchResponse.Type, EmbedError> => {
      const request = HttpClientRequest.post(endpoint).pipe(
        HttpClientRequest.setHeader("x-goog-api-key", Redacted.value(apiKey)),
        HttpClientRequest.bodyUnsafeJson({
          requests: texts.map((t) => ({
            model: modelPath,
            content: { parts: [{ text: t }] },
            taskType: taskTypeFor(kind),
            outputDimensionality: dim,
          })),
        }),
      )

      const decode = Effect.fnUntraced(function* (res: HttpClientResponse.HttpClientResponse) {
        if (res.status >= 400) {
          const body = yield* res.text
          return yield* new EmbedError({
            reason: "ProviderRejected",
            message: `gemini ${res.status}: ${body.slice(0, 200)}`,
          })
        }
        return yield* HttpClientResponse.schemaBodyJson(BatchResponse)(res)
      })

      return http.execute(request).pipe(
        Effect.flatMap(decode),
        // Funnel transport/parse failures into EmbedError uniformly.
        Effect.catchAll((cause) =>
          cause instanceof EmbedError
            ? Effect.fail(cause)
            : Effect.fail(new EmbedError({ reason: "EmbeddingFailed", message: `gemini request failed: ${String(cause)}` })),
        ),
        Effect.retry({
          schedule: Schedule.exponential("500 millis").pipe(
            Schedule.compose(Schedule.recurs(3)),
          ),
          while: (e) => /5\d\d/.test(e.message),
        }),
        // http.execute requires Scope; provide a fresh one per call.
        Effect.scoped,
      )
    }

    const make = (vector: ReadonlyArray<number>) =>
      new Embedding({ vector, model, dim })

    const embed = (input: EmbedInput) =>
      callBatch([input.text], input.kind).pipe(
        Effect.map((r) => make(r.embeddings[0]!.values)),
      )

    const embedMany = (inputs: ReadonlyArray<EmbedInput>) => {
      const indices = inputs.map((_, i) => i)
      const queryIdx: ReadonlyArray<number> = Arr.filter(indices, (i) => inputs[i]!.kind === "query")
      const passageIdx: ReadonlyArray<number> = Arr.filter(indices, (i) => inputs[i]!.kind === "passage")

      const chunkInto = (xs: ReadonlyArray<number>): ReadonlyArray<ReadonlyArray<number>> =>
        xs.length === 0 ? [] : Arr.chunksOf(xs, MAX_BATCH)

      const runGroup = (
        idxs: ReadonlyArray<number>,
        kind: "query" | "passage",
      ): Effect.Effect<ReadonlyArray<readonly [number, Embedding]>, EmbedError> =>
        Effect.forEach(
          chunkInto(idxs),
          (batch) =>
            callBatch(
              batch.map((i) => inputs[i]!.text),
              kind,
            ).pipe(
              Effect.map((r) =>
                r.embeddings.map(
                  (e, j): readonly [number, Embedding] => [batch[j]!, make(e.values)],
                ),
              ),
            ),
          { concurrency: 4 },
        ).pipe(Effect.map(Arr.flatten))

      return Effect.zip(
        runGroup(queryIdx, "query"),
        runGroup(passageIdx, "passage"),
      ).pipe(
        Effect.map(([a, b]) => {
          const out = new Array<Embedding>(inputs.length)
          for (const [i, e] of [...a, ...b]) out[i] = e
          return out as ReadonlyArray<Embedding>
        }),
      )
    }

    return Embedder.of({ model, dim, embed, embedMany })
  }),
)
