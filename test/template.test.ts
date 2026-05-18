import { describe, expect, it } from "bun:test"
import { Cause, Effect, Exit, Option } from "effect"
import { BunContext } from "@effect/platform-bun"
import { interpolate, loadTemplates, validateFrontmatter } from "../src/template/service.ts"
import { TemplateDefinition } from "../src/template/data.ts"
import { bookTemplate, makeWorkspace, noteTemplate } from "./helpers.ts"

const runExit = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromiseExit(effect)

describe("interpolate", () => {
  it("replaces placeholders", async () => {
    const result = await Effect.runPromise(interpolate("books/{slug}.md", { slug: "dune" }))
    expect(result).toBe("books/dune.md")
  })

  it("fails when a placeholder is missing", async () => {
    const exit = await runExit(interpolate("books/{slug}.md", {}))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("treats null as missing", async () => {
    const exit = await runExit(interpolate("books/{slug}.md", { slug: null }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("leaves unknown braces alone", async () => {
    const result = await Effect.runPromise(interpolate("hello {name} :)", { name: "world" }))
    expect(result).toBe("hello world :)")
  })
})

const book = TemplateDefinition.make({
  type: "book",
  path: { pattern: "books/{slug}.md" },
  frontmatter: {
    required: {
      title: { type: "string" },
      rating: { type: "int", min: 1 },
    },
    optional: {
      tags: { type: "array", items: { type: "string" } },
      status: { type: "enum", values: ["reading", "done"] },
    },
  },
  body: "# {title}",
})

describe("validateFrontmatter", () => {
  it("accepts a valid frontmatter", async () => {
    const exit = await runExit(validateFrontmatter(book, { title: "Dune", rating: 5, tags: ["sci-fi"], status: "done" }))
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("rejects missing required fields", async () => {
    const exit = await runExit(validateFrontmatter(book, { title: "Dune" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects int below min", async () => {
    const exit = await runExit(validateFrontmatter(book, { title: "Dune", rating: 0 }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects enum outside allowed values", async () => {
    const exit = await runExit(validateFrontmatter(book, { title: "Dune", rating: 3, status: "abandoned" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("ignores absent optional fields", async () => {
    const exit = await runExit(validateFrontmatter(book, { title: "Dune", rating: 3 }))
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("rejects wrong array item types", async () => {
    const exit = await runExit(validateFrontmatter(book, { title: "Dune", rating: 3, tags: ["a", 2] }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("loadTemplates", () => {
  it("reads templates from disk", async () => {
    const ws = makeWorkspace("templates-load")
    ws.writeTemplate("book", bookTemplate)
    ws.writeTemplate("note", noteTemplate)

    const templates = await Effect.runPromise(
      loadTemplates([ws.templateDir]).pipe(Effect.provide(BunContext.layer)),
    )
    expect([...templates.keys()].sort()).toEqual(["book", "note"])
    expect(templates.get("book")?.path.pattern).toBe("books/{slug}.md")
  })

  it("fails on malformed YAML", async () => {
    const ws = makeWorkspace("templates-bad")
    ws.writeTemplate("broken", "type: book\nfrontmatter: not-a-struct")
    const exit = await Effect.runPromiseExit(
      loadTemplates([ws.templateDir]).pipe(Effect.provide(BunContext.layer)),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause)
      expect(Option.isSome(failure)).toBe(true)
      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe("TemplateError")
      }
    }
  })
})
