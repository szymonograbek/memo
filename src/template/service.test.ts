import { describe, expect, it } from "bun:test"

import { BunContext } from "@effect/platform-bun"
import { Cause, Effect, Exit, Option } from "effect"

import { bookTemplate, makeWorkspace, noteTemplate } from "../../test/helpers.ts"
import { TemplateDefinition } from "./data.ts"
import { interpolate, loadTemplates, validateFrontmatter } from "./service.ts"

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

const full = TemplateDefinition.make({
  type: "full",
  description: "Every supported frontmatter field kind",
  path: { pattern: "full/{slug}.md" },
  frontmatter: {
    required: {
      slug: { type: "string" },
      score: { type: "number" },
      priority: { type: "int", min: 0 },
      active: { type: "boolean" },
      observedOn: { type: "date" },
      observedAt: { type: "datetime" },
      state: { type: "enum", values: ["draft", "published"] },
      tags: { type: "array", items: { type: "string" } },
      checkpoints: { type: "array", items: { type: "int", min: 1 } },
    },
    optional: {
      aliases: { type: "array" },
      confidence: { type: "number" },
    },
  },
  search: {
    fields: ["slug", "state", "tags", "aliases"],
    title: "slug",
  },
  body: "# {slug}\nState: {state}",
})

describe("validateFrontmatter", () => {
  it("accepts a valid frontmatter", async () => {
    const exit = await runExit(
      validateFrontmatter(book, { title: "Dune", rating: 5, tags: ["sci-fi"], status: "done" }),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("accepts every supported field kind", async () => {
    const exit = await runExit(
      validateFrontmatter(full, {
        slug: "complete",
        score: 98.5,
        priority: 0,
        active: true,
        observedOn: "2026-05-18",
        observedAt: new Date("2026-05-18T12:34:56.000Z"),
        state: "published",
        tags: ["a", "b"],
        checkpoints: [1, 2, 3],
        aliases: ["first", "second"],
        confidence: 0.75,
      }),
    )

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
    const exit = await runExit(
      validateFrontmatter(book, { title: "Dune", rating: 3, status: "abandoned" }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("ignores absent optional fields", async () => {
    const exit = await runExit(validateFrontmatter(book, { title: "Dune", rating: 3 }))

    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("rejects wrong array item types", async () => {
    const exit = await runExit(
      validateFrontmatter(book, { title: "Dune", rating: 3, tags: ["a", 2] }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects wrong primitive field kinds", async () => {
    const exit = await runExit(
      validateFrontmatter(full, {
        slug: "complete",
        score: "98.5",
        priority: 0,
        active: true,
        observedOn: "2026-05-18",
        observedAt: "2026-05-18T12:34:56.000Z",
        state: "published",
        tags: ["a", "b"],
        checkpoints: [1, 2, 3],
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects nested array items that violate their spec", async () => {
    const exit = await runExit(
      validateFrontmatter(full, {
        slug: "complete",
        score: 98.5,
        priority: 0,
        active: true,
        observedOn: "2026-05-18",
        observedAt: "2026-05-18T12:34:56.000Z",
        state: "published",
        tags: ["a", "b"],
        checkpoints: [0],
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("loadTemplates", () => {
  it("reads complex templates from disk", async () => {
    const ws = makeWorkspace("templates-load")

    ws.writeTemplate("book", bookTemplate)
    ws.writeTemplate("note", noteTemplate)
    ws.writeTemplate(
      "full",
      `
type: full
description: Every supported frontmatter field kind
path:
  pattern: "full/{slug}.md"
frontmatter:
  required:
    slug: { type: string }
    score: { type: number }
    priority: { type: int, min: 0 }
    active: { type: boolean }
    observedOn: { type: date }
    observedAt: { type: datetime }
    state: { type: enum, values: [draft, published] }
    tags:
      type: array
      items: { type: string }
    checkpoints:
      type: array
      items: { type: int, min: 1 }
  optional:
    aliases: { type: array }
    confidence: { type: number }
search:
  fields: [slug, state, tags, aliases]
  title: slug
body: |
  # {slug}
  State: {state}
`,
    )

    const templates = await Effect.runPromise(
      loadTemplates([ws.templateDir]).pipe(Effect.provide(BunContext.layer)),
    )

    expect([...templates.keys()].sort()).toEqual(["book", "full", "note"])
    expect(templates.get("book")?.path.pattern).toBe("books/{slug}.md")
    expect(templates.get("full")?.description).toBe("Every supported frontmatter field kind")
    expect(templates.get("full")?.frontmatter.required.score?.type).toBe("number")
    expect(templates.get("full")?.frontmatter.required.priority?.min).toBe(0)
    expect(templates.get("full")?.frontmatter.required.state?.values).toEqual([
      "draft",
      "published",
    ])
    expect(templates.get("full")?.frontmatter.required.checkpoints?.items?.type).toBe("int")
    expect(templates.get("full")?.frontmatter.optional?.aliases?.items).toBeUndefined()
    expect(templates.get("full")?.search?.fields).toEqual(["slug", "state", "tags", "aliases"])
    expect(templates.get("full")?.body).toContain("State: {state}")
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

  it("fails when a template uses an unsupported field type", async () => {
    const ws = makeWorkspace("templates-wrong-field")

    ws.writeTemplate(
      "wrong",
      `
type: wrong
path:
  pattern: "wrong/{slug}.md"
frontmatter:
  required:
    slug: { type: string }
    metadata: { type: object }
body: ""
`,
    )

    const exit = await Effect.runPromiseExit(
      loadTemplates([ws.templateDir]).pipe(Effect.provide(BunContext.layer)),
    )

    expect(Exit.isFailure(exit)).toBe(true)

    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause)

      expect(Option.isSome(failure)).toBe(true)

      if (Option.isSome(failure)) {
        expect(failure.value.reason).toBe("InvalidTemplateFile")
      }
    }
  })
})
