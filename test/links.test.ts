import { describe, expect, it } from "bun:test"
import { extractLinks, isAmbiguous, isResolved, isUnresolved, noteKey, resolveTarget } from "../src/models/links.ts"
import { MemoryNote } from "../src/models/model.ts"

describe("extractLinks", () => {
  it("extracts simple wikilinks", () => {
    expect(extractLinks("see [[foo]] and [[bar]]")).toEqual(["foo", "bar"])
  })

  it("strips display text after pipe", () => {
    expect(extractLinks("[[path/to/foo|Foo]]")).toEqual(["path/to/foo"])
  })

  it("strips heading anchors", () => {
    expect(extractLinks("[[foo#section]]")).toEqual(["foo"])
  })

  it("ignores empty/whitespace targets", () => {
    expect(extractLinks("[[  ]] [[ok]]")).toEqual(["ok"])
  })
})

describe("resolveTarget", () => {
  const keys = new Set(["books/dune", "books/foundation", "notes/dune"])

  it("resolves exact match", () => {
    const result = resolveTarget("books/dune", keys)
    expect(isResolved(result) && result.target).toBe("books/dune")
  })

  it("strips .md suffix before resolving", () => {
    const result = resolveTarget("books/dune.md", keys)
    expect(isResolved(result) && result.target).toBe("books/dune")
  })

  it("returns unresolved when nothing matches", () => {
    expect(isUnresolved(resolveTarget("missing", keys))).toBe(true)
  })

  it("returns ambiguous when basename matches multiple", () => {
    const result = resolveTarget("dune", keys)
    expect(isAmbiguous(result)).toBe(true)
    if (isAmbiguous(result)) {
      expect([...result.candidates].sort()).toEqual(["books/dune", "notes/dune"])
    }
  })

  it("resolves unique basename match", () => {
    const result = resolveTarget("foundation", keys)
    expect(isResolved(result) && result.target).toBe("books/foundation")
  })
})

describe("noteKey", () => {
  it("strips .md suffix", () => {
    const note = new MemoryNote({ path: "books/dune.md", frontmatter: {}, body: "" })
    expect(noteKey(note)).toBe("books/dune")
  })
})
