import { describe, expect, test } from "bun:test"
import { unlinkSync } from "node:fs"
import { Effect } from "effect"
import { Database } from "../src/db/service.ts"
import { SemanticSearch } from "../src/semantic-search/service.ts"
import { makeWorkspace, noteTemplate } from "./helpers.ts"
import { runWithSemantic } from "./setup/semantic.ts"

/** Build the YAML+body markdown a note template expects. */
const noteFile = (slug: string, body: string) =>
  `---
type: note
title: ${slug}
slug: ${slug}
---
${body}
`

const seedWorkspace = (label: string) => {
  const ws = makeWorkspace(label)
  ws.writeTemplate("note", noteTemplate)
  return ws
}

describe("SemanticSearch.reindex", () => {
  test("indexes every note found on disk", async () => {
    const ws = seedWorkspace("reindex-basic")
    ws.writeNote("notes/a.md", noteFile("a", "first note body"))
    ws.writeNote("notes/b.md", noteFile("b", "second note body"))

    const stats = await runWithSemantic(
      ws,
      Effect.gen(function* () {
        const ss = yield* SemanticSearch
        return yield* ss.reindex()
      }),
    )
    expect(stats.indexed).toBe(2)
    expect(stats.removed).toBe(0)
    expect(stats.unchanged).toBe(0)
  })

  test("second reindex marks unchanged notes and re-embeds nothing", async () => {
    const ws = seedWorkspace("reindex-incremental")
    ws.writeNote("notes/a.md", noteFile("a", "unchanging content"))

    const stats = await runWithSemantic(
      ws,
      Effect.gen(function* () {
        const ss = yield* SemanticSearch
        yield* ss.reindex()
        return yield* ss.reindex()
      }),
    )
    expect(stats.indexed).toBe(0)
    expect(stats.unchanged).toBe(1)
  })

  test("removes notes that disappeared from disk", async () => {
    const ws = seedWorkspace("reindex-removed")
    const aPath = ws.writeNote("notes/a.md", noteFile("a", "first"))
    ws.writeNote("notes/b.md", noteFile("b", "second"))

    const stats = await runWithSemantic(
      ws,
      Effect.gen(function* () {
        const ss = yield* SemanticSearch
        yield* ss.reindex()
        // Simulate user deleting a.md between runs.
        yield* Effect.sync(() => unlinkSync(aPath))
        return yield* ss.reindex()
      }),
    )
    expect(stats.removed).toBe(1)
    expect(stats.unchanged).toBe(1)
  })

  test("re-embeds a note whose body changed", async () => {
    const ws = seedWorkspace("reindex-changed")
    ws.writeNote("notes/a.md", noteFile("a", "original body"))

    const stats = await runWithSemantic(
      ws,
      Effect.gen(function* () {
        const ss = yield* SemanticSearch
        yield* ss.reindex()
        // Rewrite the same file with new body.
        ws.writeNote("notes/a.md", noteFile("a", "rewritten body"))
        return yield* ss.reindex()
      }),
    )
    expect(stats.indexed).toBe(1)
    expect(stats.unchanged).toBe(0)
  })
})

describe("SemanticSearch.search", () => {
  test("returns the semantically-closest note", async () => {
    const ws = seedWorkspace("search-semantic")
    ws.writeNote(
      "notes/tokens.md",
      noteFile("tokens", "Use design tokens instead of magic numbers in styles"),
    )
    ws.writeNote(
      "notes/dog.md",
      noteFile("dog", "Walk the dog every morning before 8am"),
    )

    const results = await runWithSemantic(
      ws,
      Effect.gen(function* () {
        const ss = yield* SemanticSearch
        yield* ss.reindex()
        return yield* ss.search("Add a wide button, 40px big", 5, 0)
      }),
    )
    expect(results[0]?.path).toBe("notes/tokens.md")
  })

  test("returns SearchResult shape with frontmatter and score", async () => {
    const ws = seedWorkspace("search-shape")
    ws.writeNote("notes/a.md", noteFile("a", "alpha content"))

    const results = await runWithSemantic(
      ws,
      Effect.gen(function* () {
        const ss = yield* SemanticSearch
        yield* ss.reindex()
        return yield* ss.search("alpha", 5, 0)
      }),
    )
    const [hit] = results
    expect(hit).toBeDefined()
    expect(hit?.path).toBe("notes/a.md")
    expect(hit?.frontmatter.title).toBe("a")
    expect(hit?.frontmatter.type).toBe("note")
    expect(typeof hit?.score).toBe("number")
  })

  test("respects limit", async () => {
    const ws = seedWorkspace("search-limit")
    for (let i = 0; i < 5; i++) {
      ws.writeNote(`notes/n${i}.md`, noteFile(`n${i}`, `topic alpha ${i}`))
    }
    const results = await runWithSemantic(
      ws,
      Effect.gen(function* () {
        const ss = yield* SemanticSearch
        yield* ss.reindex()
        return yield* ss.search("topic alpha", 2, 0)
      }),
    )
    expect(results.length).toBeLessThanOrEqual(2)
  })

  test("offset paginates results", async () => {
    const ws = seedWorkspace("search-offset")
    for (let i = 0; i < 4; i++) {
      ws.writeNote(`notes/n${i}.md`, noteFile(`n${i}`, `pagination probe ${i}`))
    }
    const both = await runWithSemantic(
      ws,
      Effect.gen(function* () {
        const ss = yield* SemanticSearch
        yield* ss.reindex()
        const first = yield* ss.search("pagination probe", 2, 0)
        const second = yield* ss.search("pagination probe", 2, 2)
        return { first, second }
      }),
    )
    const firstPaths = new Set(both.first.map((r) => r.path))
    for (const r of both.second) expect(firstPaths.has(r.path)).toBe(false)
  })

  test("filters by frontmatter type", async () => {
    const ws = makeWorkspace("search-type")
    ws.writeTemplate("note", noteTemplate)
    // Reuse the bookTemplate so we have two distinct types.
    ws.writeTemplate(
      "book",
      `
type: book
path:
  pattern: "books/{slug}.md"
frontmatter:
  required:
    title: { type: string }
    slug: { type: string }
body: |
  # {title}
`,
    )
    ws.writeNote(
      "notes/n.md",
      noteFile("n", "matching content for the search test"),
    )
    ws.writeFile(
      "memory/books/b.md",
      `---
type: book
title: b
slug: b
---
matching content for the search test
`,
    )
    const results = await runWithSemantic(
      ws,
      Effect.gen(function* () {
        const ss = yield* SemanticSearch
        yield* ss.reindex()
        return yield* ss.search("matching content", 10, 0, "book")
      }),
    )
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) expect(r.frontmatter.type).toBe("book")
  })

  test("returns scores in descending order (highest similarity first)", async () => {
    const ws = seedWorkspace("search-scores")
    ws.writeNote(
      "notes/a.md",
      noteFile("a", "Functional programming favors immutability and pure functions"),
    )
    ws.writeNote(
      "notes/b.md",
      noteFile("b", "Espresso depends on grind size and water pressure"),
    )
    ws.writeNote(
      "notes/c.md",
      noteFile("c", "Hiking the Tatras is best in late summer"),
    )

    const results = await runWithSemantic(
      ws,
      Effect.gen(function* () {
        const ss = yield* SemanticSearch
        yield* ss.reindex()
        return yield* ss.search("benefits of pure functions in code", 3, 0)
      }),
    )
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score)
    }
  })
})

describe("SemanticSearch indexing side-effects", () => {
  test("populates notes.frontmatter as JSON", async () => {
    const ws = seedWorkspace("frontmatter-store")
    ws.writeNote("notes/a.md", noteFile("a", "body"))

    const fm = await runWithSemantic(
      ws,
      Effect.gen(function* () {
        const ss = yield* SemanticSearch
        yield* ss.reindex()
        const db = yield* Database
        const row = yield* db.get<{ frontmatter: string }>(
          "SELECT frontmatter FROM notes WHERE path = ?",
          ["notes/a.md"],
        )
        return row ? JSON.parse(row.frontmatter) : null
      }),
    )
    expect(fm).toMatchObject({ type: "note", slug: "a", title: "a" })
  })
})
