import { Context, Effect } from "effect"
import { EmbedInput, Embedding } from "./data.ts"
import { EmbedError } from "./errors.ts"

export class Embedder extends Context.Tag("@memory/Embedder")<
  Embedder,
  {
    readonly model: string
    readonly dim: number
    readonly embed: (input: EmbedInput) => Effect.Effect<Embedding, EmbedError>
    readonly embedMany: (
      inputs: ReadonlyArray<EmbedInput>,
    ) => Effect.Effect<ReadonlyArray<Embedding>, EmbedError>
  }
>() {}
