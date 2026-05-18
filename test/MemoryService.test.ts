import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { Effect, Exit } from "effect"

import { LinkGraph, NoteLinks } from "../src/memory/data.ts"
import { MemoryService } from "../src/memory/service.ts"
import {
  bookTemplate,
  makeWorkspace,
  noteTemplate,
  runMemory,
  runMemoryExit,
  type Workspace,
} from "./helpers.ts"

const seedTemplates = (ws: Workspace) => {
  ws.writeTemplate("book", bookTemplate)
  ws.writeTemplate("note", noteTemplate)
}

const writeBook = (
  ws: Workspace,
  slug: string,
  extra: Record<string, unknown> = {},
  body = "# Body",
) => {
  const fm: Record<string, unknown> = {
    type: "book",
    title: slug,
    slug,
    id: `id-${slug}`,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    recalledTimes: 0,
    lastRecalledAt: null,
    ...extra,
  }
  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")

  ws.writeNote(`books/${slug}.md`, `---\n${yaml}\n---\n${body}\n`)
}

describe("MemoryService.create", () => {
  it("creates a note on disk with interpolated path and default body", async () => {
    const ws = makeWorkspace("create-basic")

    seedTemplates(ws)

    const note = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.create("book", { title: "Dune", slug: "dune" })
      }),
    )

    expect(note.path).toBe("books/dune.md")
    expect(note.body.trim()).toBe("# Dune")
    const onDisk = readFileSync(join(ws.rootDir, "books/dune.md"), "utf8")

    expect(onDisk).toContain("title: Dune")
    expect(onDisk).toContain("type: book")
    expect(onDisk).toContain("# Dune")
  })

  it("refuses to overwrite an existing note", async () => {
    const ws = makeWorkspace("create-conflict")

    seedTemplates(ws)
    writeBook(ws, "dune")

    const exit = await runMemoryExit(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.create("book", { title: "Dune", slug: "dune" })
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects unknown template type", async () => {
    const ws = makeWorkspace("create-unknown")

    seedTemplates(ws)
    const exit = await runMemoryExit(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.create("widget", { title: "x", slug: "x" })
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects unsafe path patterns", async () => {
    const ws = makeWorkspace("create-unsafe")

    ws.writeTemplate(
      "escape",
      `
type: escape
path:
  pattern: "../{slug}.md"
frontmatter:
  required:
    slug: { type: string }
body: ""
`,
    )
    const exit = await runMemoryExit(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.create("escape", { slug: "x" })
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("uses provided body verbatim when --body is supplied", async () => {
    const ws = makeWorkspace("create-body")

    seedTemplates(ws)
    const note = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.create("book", { title: "Dune", slug: "dune" }, "raw {title} body")
      }),
    )

    expect(note.body).toBe("raw {title} body")
  })
})

describe("MemoryService.list / latest / query / values / find", () => {
  it("lists all notes recursively", async () => {
    const ws = makeWorkspace("list")

    seedTemplates(ws)
    writeBook(ws, "dune")
    writeBook(ws, "foundation")
    const notes = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.list()
      }),
    )

    expect(notes.map((n) => n.path).sort()).toEqual(["books/dune.md", "books/foundation.md"])
  })

  it("returns latest notes sorted by updatedAt descending", async () => {
    const ws = makeWorkspace("latest")

    seedTemplates(ws)
    writeBook(ws, "a", { updatedAt: "2024-01-01" })
    writeBook(ws, "b", { updatedAt: "2024-03-01" })
    writeBook(ws, "c", { updatedAt: "2024-02-01" })
    const notes = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.latest(undefined, 10, 0)
      }),
    )

    expect(notes.map((n) => n.path)).toEqual(["books/b.md", "books/c.md", "books/a.md"])
  })

  it("queries by exact frontmatter field value (case-insensitive)", async () => {
    const ws = makeWorkspace("query")

    seedTemplates(ws)
    writeBook(ws, "a", { tags: ["sci-fi", "classic"] })
    writeBook(ws, "b", { tags: ["fantasy"] })
    const notes = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.query("tags", "SCI-FI", 10, 0)
      }),
    )

    expect(notes.map((n) => n.path)).toEqual(["books/a.md"])
  })

  it("counts values across notes", async () => {
    const ws = makeWorkspace("values")

    seedTemplates(ws)
    writeBook(ws, "a", { tags: ["sci-fi", "classic"] })
    writeBook(ws, "b", { tags: ["sci-fi"] })
    writeBook(ws, "c", { tags: ["fantasy"] })
    const values = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.values("tags")
      }),
    )

    expect(values).toEqual([
      { value: "sci-fi", count: 2 },
      { value: "classic", count: 1 },
      { value: "fantasy", count: 1 },
    ])
  })

  it("finds notes via fuzzy search", async () => {
    const ws = makeWorkspace("find")

    seedTemplates(ws)
    writeBook(ws, "dune", {}, "Sandworms of Arrakis")
    writeBook(ws, "foundation", {}, "Psychohistory across the galaxy")
    const results = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.find("sandworm", 10, 0)
      }),
    )

    expect(results.length).toBe(1)
    expect(results[0]?.path).toBe("books/dune.md")
  })
})

describe("MemoryService.recall / patch", () => {
  it("recall increments recalledTimes and stamps lastRecalledAt", async () => {
    const ws = makeWorkspace("recall")

    seedTemplates(ws)
    writeBook(ws, "dune")

    const first = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.recall("books/dune.md")
      }),
    )

    expect(first.frontmatter.recalledTimes).toBe(1)
    expect(typeof first.frontmatter.lastRecalledAt).toBe("string")

    const second = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.recall("books/dune.md")
      }),
    )

    expect(second.frontmatter.recalledTimes).toBe(2)

    // Persisted to disk
    const onDisk = readFileSync(join(ws.rootDir, "books/dune.md"), "utf8")

    expect(onDisk).toContain("recalledTimes: 2")
  })

  it("patch updates frontmatter and body and re-validates", async () => {
    const ws = makeWorkspace("patch")

    seedTemplates(ws)
    writeBook(ws, "dune")

    const patched = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.patch("books/dune.md", { title: "Dune (Revised)" }, "new body")
      }),
    )

    expect(patched.frontmatter.title).toBe("Dune (Revised)")
    expect(patched.body).toBe("new body")

    const onDisk = readFileSync(join(ws.rootDir, "books/dune.md"), "utf8")

    expect(onDisk).toContain("Dune (Revised)")
    expect(onDisk).toContain("new body")
  })

  it("patch rejects frontmatter that violates the template", async () => {
    const ws = makeWorkspace("patch-invalid")

    seedTemplates(ws)
    writeBook(ws, "dune")
    const exit = await runMemoryExit(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.patch("books/dune.md", { title: 42 })
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("MemoryService.links", () => {
  const seedLinkedNotes = (ws: Workspace) => {
    seedTemplates(ws)
    writeBook(ws, "dune", {}, "See [[books/foundation]] and [[ghost]].")
    writeBook(ws, "foundation", {}, "Pairs with [[dune]].")
  }

  it("returns a LinkGraph when no path is provided", async () => {
    const ws = makeWorkspace("links-graph")

    seedLinkedNotes(ws)
    const result = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.links()
      }),
    )

    expect(result).toBeInstanceOf(LinkGraph)

    if (!(result instanceof LinkGraph)) return
    const targets = result.notes.flatMap((n) => n.outgoing.map((o) => o.target)).sort()

    expect(targets).toEqual(["books/dune", "books/foundation"])
    expect(result.unresolved.map((u) => u.raw)).toContain("ghost")
  })

  it("returns NoteLinks for a specific note", async () => {
    const ws = makeWorkspace("links-note")

    seedLinkedNotes(ws)
    const result = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.links("books/foundation")
      }),
    )

    expect(result).toBeInstanceOf(NoteLinks)

    if (!(result instanceof NoteLinks)) return
    expect(result.path).toBe("books/foundation")
    expect(result.outgoing.map((o) => o.target)).toEqual(["books/dune"])
    expect(result.incoming.map((i) => i.from)).toEqual(["books/dune"])
  })

  it("fails on an unknown path", async () => {
    const ws = makeWorkspace("links-missing")

    seedTemplates(ws)
    writeBook(ws, "dune")
    const exit = await runMemoryExit(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.links("nope")
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })
})
