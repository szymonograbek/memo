import { describe, expect, test } from "bun:test"

import { Effect } from "effect"

import { searchVectors } from "../../src/db/vectors.ts"
import { Embedder } from "../../src/embed/service.ts"
import { runTest } from "../setup/run.ts"
import { seedMemories, type SeededChunk } from "../setup/seed.ts"

/**
 * Look up the `ord` of the top hit so assertions describe intent
 * ("the design-tokens memory") instead of opaque ids.
 */
const topOrd = (
  hits: ReadonlyArray<{ id: number; distance: number }>,
  seeded: ReadonlyArray<SeededChunk>,
): number => seeded.find((s) => s.id === hits[0]?.id)?.ord ?? -1

const ordsOf = (
  hits: ReadonlyArray<{ id: number; distance: number }>,
  seeded: ReadonlyArray<SeededChunk>,
): ReadonlyArray<number> => hits.map((h) => seeded.find((s) => s.id === h.id)?.ord ?? -1)

const queryFor = (text: string) =>
  Effect.flatMap(Embedder, (emb) => emb.embed({ text, kind: "query" }))

describe("retrieval — semantic recall", () => {
  test("paraphrase: query and memory share no content words", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const seeded = yield* seedMemories(
          [
            "Always free resources in a deferred block to avoid leaks",
            "Bread tastes better the day after baking",
            "Cats sleep about sixteen hours per day",
          ],
          "paraphrase",
        )

        const q = yield* queryFor("Make sure cleanup runs even when an error happens")
        const hits = yield* searchVectors(q.vector, 3)

        return topOrd(hits, seeded)
      }),
    )

    expect(result).toBe(0)
  })

  test("disambiguation: programming 'python' beats reptile 'python'", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const seeded = yield* seedMemories(
          [
            "Pythons are large non-venomous snakes that constrict their prey",
            "Python list comprehensions are syntactic sugar for map and filter",
            "The Amazon basin hosts dozens of snake species",
          ],
          "disambig",
        )

        const q = yield* queryFor("How do I iterate a list in Python code?")
        const hits = yield* searchVectors(q.vector, 3)

        return topOrd(hits, seeded)
      }),
    )

    expect(result).toBe(1)
  })

  test("ordering: code-style notes dominate top-3 over lifestyle notes", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        // Indices 0..2 are code-style, 3..5 are lifestyle. We don't assert
        // a strict prefix — small models can interleave — but the top-3
        // must be majority code-style and the top-1 must be code-style.
        const seeded = yield* seedMemories(
          [
            "Use design tokens instead of magic numbers in styles",
            "Prefer composition over inheritance in component design",
            "Name boolean variables with is/has prefixes for readability",
            "Walk the dog every morning before 8am",
            "Sourdough needs at least four hours of bulk fermentation",
            "Cats sleep about sixteen hours per day",
          ],
          "ordering",
        )

        const q = yield* queryFor("Best practices for writing clean component code")
        const hits = yield* searchVectors(q.vector, 6)

        return ordsOf(hits, seeded)
      }),
    )

    const top3 = result.slice(0, 3)
    const codeStyle = top3.filter((ord) => ord >= 0 && ord <= 2).length

    expect(top3[0]).toBeLessThanOrEqual(2) // top-1 is code-style
    expect(codeStyle).toBeGreaterThanOrEqual(2) // ≥2/3 of top-3 are code-style
  })

  test("specificity: TS-specific query prefers TS note over generic programming note", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const seeded = yield* seedMemories(
          [
            "Writing software requires careful thought and iteration",
            "TypeScript discriminated unions make illegal states unrepresentable",
            "A good README explains what, why, and how to use a project",
          ],
          "specificity",
        )

        const q = yield* queryFor("How do I model variants with tagged types in TypeScript?")
        const hits = yield* searchVectors(q.vector, 3)

        return topOrd(hits, seeded)
      }),
    )

    expect(result).toBe(1)
  })

  test("query/passage symmetry: top hit is stable when roles are swapped", async () => {
    // The same texts indexed as passages should still match when the would-be
    // query text is also embedded as a passage. Sanity check on the kind axis.
    const result = await runTest(
      Effect.gen(function* () {
        const seeded = yield* seedMemories(
          [
            "Effect's Layer composes services with explicit dependencies",
            "Espresso extraction depends on grind size and pressure",
            "Hiking the Tatra mountains is best in late summer",
          ],
          "symmetry",
        )

        const emb = yield* Embedder

        const asQuery = yield* emb.embed({
          text: "How do I wire services together in Effect?",
          kind: "query",
        })

        const asPassage = yield* emb.embed({
          text: "How do I wire services together in Effect?",
          kind: "passage",
        })

        const a = yield* searchVectors(asQuery.vector, 1)
        const b = yield* searchVectors(asPassage.vector, 1)

        return { a: topOrd(a, seeded), b: topOrd(b, seeded) }
      }),
    )

    expect(result.a).toBe(0)
    expect(result.b).toBe(0)
  })

  test("typo robustness: misspelled query still recovers the right memory", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const seeded = yield* seedMemories(
          [
            "Kubernetes pods share a network namespace within a node",
            "Docker images are layered filesystems built from a Dockerfile",
            "Git rebase rewrites history; prefer merge for shared branches",
          ],
          "typos",
        )

        const q = yield* queryFor("kuberntes pod netwroking basics")
        const hits = yield* searchVectors(q.vector, 3)

        return topOrd(hits, seeded)
      }),
    )

    expect(result).toBe(0)
  })

  test("top-k cap: searchVectors returns at most k results", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        yield* seedMemories(
          Array.from({ length: 8 }, (_, i) => `memory item number ${i}`),
          "topk",
        )
        const q = yield* queryFor("memory item")
        const hits = yield* searchVectors(q.vector, 3)

        return hits.length
      }),
    )

    expect(result).toBeLessThanOrEqual(3)
  })

  test("distances are sorted ascending", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        yield* seedMemories(
          [
            "Functional programming favors pure functions and immutability",
            "Espresso is brewed under pressure with finely ground beans",
            "Concurrent code benefits from message passing over shared state",
          ],
          "sorted",
        )
        const q = yield* queryFor("benefits of pure functions in code")
        const hits = yield* searchVectors(q.vector, 3)

        return hits.map((h) => h.distance)
      }),
    )

    for (let i = 1; i < result.length; i++) {
      expect(result[i]!).toBeGreaterThanOrEqual(result[i - 1]!)
    }
  })
})
