import { describe, expect, it } from "bun:test"

import { Effect, Exit } from "effect"

import { decodeMarkdown, encodeMarkdown, normalizeFrontmatter } from "../src/markdown/service.ts"
import { Frontmatter, MemoryNote } from "../src/memory/data.ts"
import { TemplateDefinition } from "../src/template/data.ts"

const book = TemplateDefinition.make({
  type: "book",
  path: { pattern: "books/{slug}.md" },
  frontmatter: {
    required: { title: { type: "string" }, slug: { type: "string" } },
  },
  body: "# {title}",
})

const templates = new Map([[book.type, book]])

describe("normalizeFrontmatter", () => {
  it("assigns id, createdAt, updatedAt, recalledTimes, lastRecalledAt", () => {
    const result = normalizeFrontmatter({ title: "Dune", slug: "dune" })

    expect(typeof result.id).toBe("string")
    expect(typeof result.createdAt).toBe("string")
    expect(typeof result.updatedAt).toBe("string")
    expect(result.recalledTimes).toBe(0)
    expect(result.lastRecalledAt).toBeNull()
  })

  it("preserves existing id and recall counters", () => {
    const result = normalizeFrontmatter({
      title: "Dune",
      id: "abc",
      recalledTimes: 3,
      lastRecalledAt: "2024-01-02",
    })

    expect(result.id).toBe("abc")
    expect(result.recalledTimes).toBe(3)
    expect(result.lastRecalledAt).toBe("2024-01-02")
  })

  it("converts a Date updatedAt into a date string", () => {
    const result = normalizeFrontmatter({ updatedAt: new Date("2024-05-01T12:00:00Z") })

    expect(result.updatedAt).toBe("2024-05-01")
  })
})

describe("decodeMarkdown / encodeMarkdown", () => {
  it("decodes valid markdown", async () => {
    const raw = `---\ntype: book\ntitle: Dune\nslug: dune\n---\n# Dune\n`
    const note = await Effect.runPromise(decodeMarkdown(templates, "books/dune.md", raw))

    expect(note.path).toBe("books/dune.md")
    expect(note.frontmatter.title).toBe("Dune")
    expect(note.body.trim()).toBe("# Dune")
  })

  it("fails when type is missing", async () => {
    const raw = `---\ntitle: Dune\n---\nbody`
    const exit = await Effect.runPromiseExit(decodeMarkdown(templates, "x.md", raw))

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("fails for unknown template type", async () => {
    const raw = `---\ntype: unknown\n---\nbody`
    const exit = await Effect.runPromiseExit(decodeMarkdown(templates, "x.md", raw))

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("fails when frontmatter does not match the template", async () => {
    const raw = `---\ntype: book\nslug: dune\n---\nbody`
    const exit = await Effect.runPromiseExit(decodeMarkdown(templates, "x.md", raw))

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("round-trips via encodeMarkdown", async () => {
    const note = new MemoryNote({
      path: "books/dune.md",
      frontmatter: normalizeFrontmatter({
        type: "book",
        title: "Dune",
        slug: "dune",
      }) as Frontmatter,
      body: "# Dune\n",
    })

    const encoded = await Effect.runPromise(encodeMarkdown(note))
    const decoded = await Effect.runPromise(decodeMarkdown(templates, note.path, encoded))

    expect(decoded.frontmatter.title).toBe("Dune")
    expect(decoded.frontmatter.slug).toBe("dune")
    expect(decoded.body.trim()).toBe("# Dune")
  })
})
