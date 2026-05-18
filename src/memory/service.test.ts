import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { Effect, Exit } from "effect"

import {
  bookTemplate,
  makeWorkspace,
  noteTemplate,
  runMemory,
  runMemoryExit,
  type Workspace,
} from "../../test/helpers.ts"
import { LinkGraph, NoteLinks } from "./data.ts"
import { MemoryService } from "./service.ts"

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

        return yield* memory.create("book", { title: "Dune", slug: "dune" }, undefined)
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

        return yield* memory.create("book", { title: "Dune", slug: "dune" }, undefined)
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

        return yield* memory.create("widget", { title: "x", slug: "x" }, undefined)
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

        return yield* memory.create("escape", { slug: "x" }, undefined)
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

  it("latest falls back to 'date' field when both 'updatedAt' and 'updated' are absent", async () => {
    const ws = makeWorkspace("latest-date-fallback")

    seedTemplates(ws)
    ws.writeNote(
      "books/a.md",
      [
        "---",
        "type: book",
        'title: "a"',
        'slug: "a"',
        'id: "id-a"',
        'createdAt: "2024-01-01"',
        'date: "2024-03-01"',
        "recalledTimes: 0",
        "lastRecalledAt: null",
        "---",
        "# Body",
      ].join("\n"),
    )
    writeBook(ws, "b", { updatedAt: "2024-01-01" })

    const notes = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.latest(undefined, 10, 0)
      }),
    )

    // 'a' has date=2024-03-01 which is newer than b's updatedAt=2024-01-01
    expect(notes[0]?.path).toBe("books/a.md")
  })

  it("latest falls back to 'updated' field when 'updatedAt' is absent", async () => {
    const ws = makeWorkspace("latest-updated-fallback")

    seedTemplates(ws)
    // Write a note that uses 'updated' instead of 'updatedAt' — the field the
    // implementation falls back to in noteTime().
    ws.writeNote(
      "books/a.md",
      [
        "---",
        "type: book",
        'title: "a"',
        'slug: "a"',
        'id: "id-a"',
        'createdAt: "2024-01-01"',
        'updated: "2024-03-01"',
        "recalledTimes: 0",
        "lastRecalledAt: null",
        "---",
        "# Body",
      ].join("\n"),
    )
    writeBook(ws, "b", { updatedAt: "2024-01-01" })

    const notes = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.latest(undefined, 10, 0)
      }),
    )

    // 'a' has updated=2024-03-01 which is newer than b's updatedAt=2024-01-01
    expect(notes[0]?.path).toBe("books/a.md")
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

        return yield* memory.query("tags", "SCI-FI", 10, 0, undefined)
      }),
    )

    expect(notes.map((n) => n.path)).toEqual(["books/a.md"])
  })

  it("query filters by type when type is provided", async () => {
    const ws = makeWorkspace("query-type")

    seedTemplates(ws)
    writeBook(ws, "a", { tags: ["sci-fi"] })
    // A note that also carries tags — extra frontmatter fields beyond the
    // template's required set are preserved by normalizeFrontmatter.
    ws.writeNote(
      "notes/b.md",
      ["---", "type: note", 'title: "b"', 'slug: "b"', 'tags: ["sci-fi"]', "---", "# b"].join("\n"),
    )

    const notes = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.query("tags", "sci-fi", 10, 0, "book")
      }),
    )

    // Only the book should appear; the note with the same tag is filtered out.
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

        return yield* memory.values("tags", undefined)
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

        return yield* memory.find("sandworm", 10, 0, undefined)
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

        return yield* memory.patch("books/dune.md", { title: 42 }, undefined)
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("patch stamps updatedAt when frontmatter is supplied", async () => {
    const ws = makeWorkspace("patch-updatedAt")

    seedTemplates(ws)
    writeBook(ws, "dune", { updatedAt: "2020-01-01" })

    const patched = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.patch("books/dune.md", { title: "Dune Revised" }, undefined)
      }),
    )

    // updatedAt must be refreshed — leaving it as the original value would
    // silently corrupt the sort order and the note's modification history.
    expect(patched.frontmatter.updatedAt).not.toBe("2020-01-01")
    expect(typeof patched.frontmatter.updatedAt).toBe("string")
  })

  it("recall fails when the path does not exist on disk", async () => {
    const ws = makeWorkspace("recall-missing")

    seedTemplates(ws)

    const exit = await runMemoryExit(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.recall("books/nope.md")
      }),
    )

    // Filesystem errors for non-existent paths surface as defects, not typed
    // errors, because callers are expected to pass valid paths.
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

        return yield* memory.links(undefined)
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

  it("records a link as ambiguous when its target basename matches multiple notes", async () => {
    const ws = makeWorkspace("links-ambiguous")

    seedTemplates(ws)
    // 'source' links to [[dune]] which matches both books/dune and notes/dune.
    writeBook(ws, "source", {}, "References [[dune]].")
    writeBook(ws, "dune")
    // A second note with the same basename under a different directory.
    ws.writeNote(
      "notes/dune.md",
      ["---", "type: note", 'title: "dune"', 'slug: "dune"', "---", "# dune"].join("\n"),
    )

    const result = await runMemory(
      ws,
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.links(undefined)
      }),
    )

    if (!(result instanceof LinkGraph)) throw new Error("expected LinkGraph")

    const ambiguous = result.unresolved.filter((u) => u.ambiguous !== null)

    expect(ambiguous.length).toBeGreaterThan(0)

    const candidates = ambiguous[0]!.ambiguous!.slice().sort()

    expect(candidates).toEqual(["books/dune", "notes/dune"])
  })
})
