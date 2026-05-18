import { describe, expect, test } from "bun:test"

import { Effect } from "effect"

import { runTest } from "../../test/setup/run.ts"
import { Embedder } from "./service.ts"

const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
  let dot = 0
  let na = 0
  let nb = 0

  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!

    dot += x * y
    na += x * x
    nb += y * y
  }

  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

describe("Embedder (transformers)", () => {
  test("embed returns vector of configured dim", async () => {
    const e = await runTest(
      Effect.gen(function* () {
        const emb = yield* Embedder

        return yield* emb.embed({ text: "hello world", kind: "passage" })
      }),
    )

    expect(e.vector.length).toBe(e.dim)
    expect(e.dim).toBe(384)
  })

  test("embedMany length and dimensions", async () => {
    const out = await runTest(
      Effect.gen(function* () {
        const emb = yield* Embedder

        return yield* emb.embedMany([
          { text: "first", kind: "passage" },
          { text: "second", kind: "passage" },
          { text: "third", kind: "query" },
        ])
      }),
    )

    expect(out).toHaveLength(3)

    for (const e of out) expect(e.vector.length).toBe(e.dim)
  })

  test("embedMany returns vectors in input order (matches individual embeds)", async () => {
    // If the implementation scrambled results, batch[i] would diverge from
    // the individually-embedded vector for the same text at position i.
    const result = await runTest(
      Effect.gen(function* () {
        const emb = yield* Embedder

        const inputs = [
          { text: "alpha", kind: "passage" as const },
          { text: "beta", kind: "passage" as const },
          { text: "gamma", kind: "query" as const },
        ]

        const batch = yield* emb.embedMany(inputs)
        const singles = yield* Effect.all(inputs.map((t) => emb.embed(t)))

        return { batch, singles }
      }),
    )

    const maxAbsDiff = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) =>
      Math.max(...a.map((x, i) => Math.abs(x - b[i]!)))

    for (let i = 0; i < result.batch.length; i++) {
      expect(maxAbsDiff(result.batch[i]!.vector, result.singles[i]!.vector)).toBeLessThan(1e-5)
    }
  })

  test("semantic recall: 40px button query is closer to design-tokens than to dog-walking", async () => {
    const r = await runTest(
      Effect.gen(function* () {
        const emb = yield* Embedder

        const out = yield* emb.embedMany([
          { text: "Add a wide button, 40px big", kind: "query" },
          { text: "Use design tokens instead of magic numbers in styles", kind: "passage" },
          { text: "Walk the dog every morning before 8am", kind: "passage" },
        ])

        return out
      }),
    )

    const [q, relevant, irrelevant] = r

    expect(q).toBeDefined()
    expect(relevant).toBeDefined()
    expect(irrelevant).toBeDefined()
    const relevantScore = cosine(q!.vector, relevant!.vector)
    const irrelevantScore = cosine(q!.vector, irrelevant!.vector)

    expect(relevantScore).toBeGreaterThan(irrelevantScore)
  })
})
