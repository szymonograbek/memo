import { describe, expect, test } from "bun:test"

import { bookTemplate, makeWorkspace } from "../test/helpers.ts"
import Memory from "./client.ts"

describe("Memory client", () => {
  test("exposes a Promise API without Effect in consumer code", async () => {
    const workspace = makeWorkspace("client")

    workspace.writeTemplate("book", bookTemplate)

    const memory = new Memory({
      rootDir: workspace.rootDir,
      templateDirs: [workspace.templateDir],
    })

    const created = await memory.create("book", {
      frontmatter: { title: "Dune", slug: "dune" },
    })

    const listed = await memory.list("book")

    expect(created.path).toBe("books/dune.md")
    expect(listed.map((note) => note.path)).toEqual(["books/dune.md"])
  })
})
