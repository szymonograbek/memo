import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { NodeContext } from "@effect/platform-node"
import { Effect, Exit, Layer } from "effect"

import { MemoryService } from "../src/memory/service.ts"
import { TemplateError } from "../src/template/errors.ts"
import { TESTING_ROOT } from "./setup.ts"

let counter = 0
const processTag = `${process.pid}`

export interface Workspace {
  readonly root: string
  readonly rootDir: string
  readonly templateDir: string
  writeNote: (relativePath: string, contents: string) => string
  writeTemplate: (name: string, contents: string) => string
  writeFile: (relativePath: string, contents: string) => string
}

/**
 * Create a fresh, unique workspace on the real filesystem under testing/.
 * Each call returns a workspace with empty rootDir + templateDir directories.
 */
export const makeWorkspace = (label: string): Workspace => {
  counter += 1
  const root = resolve(TESTING_ROOT, `${label}-${processTag}-${counter}`)
  const rootDir = join(root, "memory")
  const templateDir = join(root, "templates")

  mkdirSync(rootDir, { recursive: true })
  mkdirSync(templateDir, { recursive: true })

  const writeFile = (relativePath: string, contents: string) => {
    const target = join(root, relativePath)

    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, contents)

    return target
  }

  return {
    root,
    rootDir,
    templateDir,
    writeNote: (path, contents) => writeFile(join("memory", path), contents),
    writeTemplate: (name, contents) =>
      writeFile(join("templates", `${name}.memory-template.yaml`), contents),
    writeFile,
  }
}

// Building the MemoryService layer can itself fail with a TemplateError
// (e.g. malformed template files), so it joins the effect's error channel.
const memoryLayer = (workspace: Workspace) =>
  MemoryService.layer({ rootDir: workspace.rootDir, templateDirs: [workspace.templateDir] }).pipe(
    Layer.provide(NodeContext.layer),
  )

const provideMemory = <A, E>(
  workspace: Workspace,
  effect: Effect.Effect<A, E, MemoryService>,
): Effect.Effect<A, E | TemplateError> => effect.pipe(Effect.provide(memoryLayer(workspace)))

/**
 * Run an Effect against a workspace, providing MemoryService backed by the
 * workspace's real on-disk directories. Rejects on failure.
 */
export const runMemory = <A, E>(
  workspace: Workspace,
  effect: Effect.Effect<A, E, MemoryService>,
): Promise<A> => Effect.runPromise(provideMemory(workspace, effect))

/**
 * Like {@link runMemory} but always resolves with an {@link Exit}, so tests
 * can assert on failure cases without throwing.
 */
export const runMemoryExit = <A, E>(
  workspace: Workspace,
  effect: Effect.Effect<A, E, MemoryService>,
): Promise<Exit.Exit<A, E | TemplateError>> =>
  Effect.runPromiseExit(provideMemory(workspace, effect))

export const bookTemplate = `
type: book
description: Reading notes
path:
  pattern: "books/{slug}.md"
frontmatter:
  required:
    title: { type: string }
    slug: { type: string }
  optional:
    rating: { type: int, min: 1 }
    tags:
      type: array
      items: { type: string }
search:
  fields: [title, tags]
  title: title
body: |
  # {title}
`

export const noteTemplate = `
type: note
path:
  pattern: "notes/{slug}.md"
frontmatter:
  required:
    title: { type: string }
    slug: { type: string }
body: |
  # {title}
`
