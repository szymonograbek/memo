import { dirname, join, relative } from "node:path"

import { FileSystem } from "@effect/platform"
import type { PlatformError } from "@effect/platform/Error"
import { Array as Arr, Context, Effect, Layer } from "effect"

import { isAmbiguous, isResolved, isUnresolved } from "../links/data.ts"
import { extractLinks, noteKey, resolveTarget } from "../links/service.ts"
import { MarkdownError } from "../markdown/errors.ts"
import { decodeMarkdown, encodeMarkdown } from "../markdown/service.ts"
import { SearchResult } from "../search/data.ts"
import { SearchEngine } from "../search/service.ts"
import { TemplateDefinition } from "../template/data.ts"
import { TemplateError } from "../template/errors.ts"
import { interpolate, loadTemplates, validateFrontmatter } from "../template/service.ts"
import {
  Frontmatter,
  IncomingLink,
  LinkGraph,
  MemoryNote,
  NoteLink,
  NoteLinks,
  UnresolvedLink,
} from "./data.ts"
import { MemoryError } from "./errors.ts"

export interface MemoryOptions {
  readonly rootDir: string
  readonly templateDirs: ReadonlyArray<string>
}

type Errors = MemoryError | MarkdownError | TemplateError

/**
 * Filesystem failures on the memory directory are not actionable by callers,
 * so we surface them as defects instead of typed errors.
 */
const dieOnFsError = <A, R>(eff: Effect.Effect<A, PlatformError, R>): Effect.Effect<A, never, R> =>
  eff.pipe(
    Effect.catchTags({
      SystemError: (cause) => Effect.die(cause),
      BadArgument: (cause) => Effect.die(cause),
    }),
  )

const listMdFiles: (
  fs: FileSystem.FileSystem,
  dir: string,
) => Effect.Effect<ReadonlyArray<string>> = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  dir: string,
) {
  const entries = yield* dieOnFsError(fs.readDirectory(dir))

  const nested = yield* Effect.all(
    entries.map(
      Effect.fnUntraced(function* (entry: string) {
        const path = join(dir, entry)
        const info = yield* dieOnFsError(fs.stat(path))

        if (info.type === "Directory") return yield* listMdFiles(fs, path)

        if (info.type === "File" && entry.endsWith(".md")) return [path] as ReadonlyArray<string>

        return [] as ReadonlyArray<string>
      }),
    ),
  )

  return Arr.flatten(nested)
})

export class MemoryService extends Context.Tag("@memory/MemoryService")<
  MemoryService,
  {
    readonly templates: ReadonlyMap<string, TemplateDefinition>
    readonly list: () => Effect.Effect<ReadonlyArray<MemoryNote>, Errors>
    readonly find: (
      query: string,
      limit: number,
      offset: number,
      type: string | undefined,
    ) => Effect.Effect<ReadonlyArray<SearchResult>, Errors>
    readonly latest: (
      type: string | undefined,
      limit: number,
      offset: number,
    ) => Effect.Effect<ReadonlyArray<MemoryNote>, Errors>
    readonly query: (
      field: string,
      value: string,
      limit: number,
      offset: number,
      type: string | undefined,
    ) => Effect.Effect<ReadonlyArray<MemoryNote>, Errors>
    readonly values: (
      field: string,
      type: string | undefined,
    ) => Effect.Effect<ReadonlyArray<{ readonly value: string; readonly count: number }>, Errors>
    readonly links: (path: string | undefined) => Effect.Effect<LinkGraph | NoteLinks, Errors>
    readonly recall: (path: string) => Effect.Effect<MemoryNote, Errors>
    readonly patch: (
      path: string,
      frontmatterPatch: Frontmatter | undefined,
      body: string | undefined,
    ) => Effect.Effect<MemoryNote, Errors>
    readonly create: (
      type: string,
      frontmatter: Frontmatter,
      body: string | undefined,
    ) => Effect.Effect<MemoryNote, Errors>
  }
>() {
  static readonly layer = (
    options: MemoryOptions,
  ): Layer.Layer<MemoryService, TemplateError, FileSystem.FileSystem> =>
    Layer.effect(
      MemoryService,
      Effect.gen(function* () {
        const search = yield* SearchEngine
        const fs = yield* FileSystem.FileSystem
        const templates = yield* loadTemplates(options.templateDirs)

        const readNote = Effect.fnUntraced(function* (file: string) {
          const raw = yield* dieOnFsError(fs.readFileString(file, "utf8"))

          return yield* decodeMarkdown(
            templates,
            relative(options.rootDir, file).replaceAll("\\", "/"),
            raw,
          )
        })

        const list = Effect.fn("MemoryService.list")(function* () {
          const files = yield* listMdFiles(fs, options.rootDir)

          return yield* Effect.all(files.map(readNote))
        })

        const find = Effect.fn("MemoryService.find")(function* (
          query: string,
          limit: number,
          offset: number,
          type: string | undefined,
        ) {
          const notes = yield* list()

          const filtered =
            type === undefined ? notes : Arr.filter(notes, (note) => note.frontmatter.type === type)

          return yield* search.search(filtered, query, limit, offset)
        })

        const noteTime = (note: MemoryNote) => {
          const value =
            note.frontmatter.updatedAt ??
            note.frontmatter.updated ??
            note.frontmatter.date ??
            note.frontmatter.valid_from

          const time = Date.parse(String(value ?? ""))

          return Number.isNaN(time) ? 0 : time
        }

        const compactTimeSort = (left: MemoryNote, right: MemoryNote) =>
          noteTime(right) - noteTime(left) || left.path.localeCompare(right.path)

        const matchesType = (type: string | undefined) => (note: MemoryNote) =>
          type === undefined || note.frontmatter.type === type

        const latest = Effect.fn("MemoryService.latest")(function* (
          type: string | undefined,
          limit: number,
          offset: number,
        ) {
          const notes = yield* list()

          return Arr.filter(notes, matchesType(type))
            .toSorted(compactTimeSort)
            .slice(offset, offset + limit)
        })

        const query = Effect.fn("MemoryService.query")(function* (
          field: string,
          value: string,
          limit: number,
          offset: number,
          type: string | undefined,
        ) {
          const notes = yield* list()
          const expected = value.toLowerCase()
          const filtered = Arr.filter(notes, matchesType(type))

          const matched = Arr.filter(filtered, (note) => {
            const actual = note.frontmatter[field]
            const items = Array.isArray(actual) ? actual : [actual]

            return items.some((item) => String(item).toLowerCase() === expected)
          })

          return matched.toSorted(compactTimeSort).slice(offset, offset + limit)
        })

        const values = Effect.fn("MemoryService.values")(function* (
          field: string,
          type: string | undefined,
        ) {
          const notes = yield* list()
          const counts = new Map<string, number>()

          for (const note of notes) {
            if (type !== undefined && note.frontmatter.type !== type) continue
            const value = note.frontmatter[field]
            const items = Array.isArray(value) ? value : [value]

            for (const item of items) {
              if (item === undefined || item === null) continue
              const key = String(item)

              counts.set(key, (counts.get(key) ?? 0) + 1)
            }
          }

          return Arr.fromIterable(counts.entries())
            .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .map(([value, count]) => ({ value, count }))
        })

        const links = Effect.fn("MemoryService.links")(function* (path: string | undefined) {
          const notes = yield* list()
          const keys = new Set(notes.map(noteKey))
          const outgoing = new Map<string, ReadonlyArray<NoteLink>>()
          const incoming = new Map<string, ReadonlyArray<IncomingLink>>()
          let unresolved: ReadonlyArray<UnresolvedLink> = []

          for (const note of notes) {
            const from = noteKey(note)
            let out: ReadonlyArray<NoteLink> = []

            for (const raw of extractLinks(note.body)) {
              const resolved = resolveTarget(raw, keys)

              if (isResolved(resolved)) {
                out = Arr.append(out, new NoteLink({ raw, target: resolved.target }))
                const existing = incoming.get(resolved.target) ?? []

                incoming.set(resolved.target, Arr.append(existing, new IncomingLink({ from, raw })))
              } else {
                unresolved = Arr.append(
                  unresolved,
                  new UnresolvedLink({
                    from,
                    raw,
                    ambiguous: isAmbiguous(resolved) ? resolved.candidates : null,
                  }),
                )
              }
            }
            outgoing.set(from, out)
          }

          const noteLinks = (key: string) =>
            new NoteLinks({
              path: key,
              outgoing: outgoing.get(key) ?? [],
              incoming: incoming.get(key) ?? [],
            })

          if (path !== undefined) {
            const resolved = resolveTarget(path, keys)

            if (isUnresolved(resolved))
              return yield* new MemoryError({
                reason: "NoteNotFound",
                message: `No note matches ${path}`,
              })

            if (isAmbiguous(resolved))
              return yield* new MemoryError({
                reason: "AmbiguousNote",
                message: `Ambiguous note ${path}: ${resolved.candidates.join(", ")}`,
              })

            return noteLinks(resolved.target)
          }

          return new LinkGraph({
            notes: Arr.filter(
              Arr.fromIterable(keys).map(noteLinks),
              (entry) => entry.outgoing.length > 0 || entry.incoming.length > 0,
            ),
            unresolved,
          })
        })

        const recall = Effect.fn("MemoryService.recall")(function* (path: string) {
          const fullPath = join(options.rootDir, path)
          const note = yield* readNote(fullPath)

          const recalledTimes =
            typeof note.frontmatter.recalledTimes === "number"
              ? note.frontmatter.recalledTimes + 1
              : 1

          const next = new MemoryNote({
            path: note.path,
            body: note.body,
            frontmatter: {
              ...note.frontmatter,
              recalledTimes,
              lastRecalledAt: new Date().toISOString(),
            },
          })

          const encoded = yield* encodeMarkdown(next)

          yield* dieOnFsError(fs.writeFileString(fullPath, encoded))

          return next
        })

        const patch = Effect.fn("MemoryService.patch")(function* (
          path: string,
          frontmatterPatch: Frontmatter | undefined,
          body: string | undefined,
        ) {
          const fullPath = join(options.rootDir, path)
          const note = yield* readNote(fullPath)

          const nextFrontmatter = frontmatterPatch
            ? { ...note.frontmatter, ...frontmatterPatch, updatedAt: new Date().toISOString() }
            : note.frontmatter

          const type = typeof nextFrontmatter.type === "string" ? nextFrontmatter.type : undefined
          const template = type !== undefined ? templates.get(type) : undefined

          if (!template)
            return yield* new MemoryError({
              reason: "UnknownTemplate",
              message: `${path}: unknown template type ${String(nextFrontmatter.type)}`,
            })
          yield* validateFrontmatter(template, nextFrontmatter).pipe(
            Effect.mapError(
              (error) =>
                new MemoryError({
                  reason: "ValidationFailed",
                  message: `${path}: ${error.message}`,
                }),
            ),
          )
          const nextBody = body !== undefined ? body : note.body

          const next = new MemoryNote({
            path: note.path,
            body: nextBody,
            frontmatter: nextFrontmatter,
          })

          const encoded = yield* encodeMarkdown(next)

          yield* dieOnFsError(fs.writeFileString(fullPath, encoded))

          return next
        })

        const create = Effect.fn("MemoryService.create")(function* (
          type: string,
          frontmatterInput: Frontmatter,
          body: string | undefined,
        ) {
          const template = templates.get(type)

          if (!template)
            return yield* new MemoryError({
              reason: "UnknownTemplate",
              message: `Unknown template type: ${type}`,
            })
          const now = new Date().toISOString()
          const frontmatter = { createdAt: now, updatedAt: now, ...frontmatterInput, type }

          const relativePath = yield* interpolate(template.path.pattern, frontmatter).pipe(
            Effect.mapError(
              (error) =>
                new MemoryError({
                  reason: "ValidationFailed",
                  message: `${template.path.pattern}: ${error.message}`,
                }),
            ),
          )

          if (relativePath.split("/").includes("..")) {
            return yield* new MemoryError({
              reason: "UnsafePath",
              message: `Path pattern produced unsafe path: ${relativePath}`,
            })
          }
          const fullPath = join(options.rootDir, relativePath)
          const exists = yield* dieOnFsError(fs.exists(fullPath))

          if (exists)
            return yield* new MemoryError({
              reason: "NoteAlreadyExists",
              message: `Note already exists: ${relativePath}`,
            })
          yield* validateFrontmatter(template, frontmatter).pipe(
            Effect.mapError(
              (error) =>
                new MemoryError({
                  reason: "ValidationFailed",
                  message: `${relativePath}: ${error.message}`,
                }),
            ),
          )

          const noteBody =
            body !== undefined
              ? body
              : yield* interpolate(template.body, frontmatter).pipe(
                  Effect.mapError(
                    (error) =>
                      new MemoryError({
                        reason: "ValidationFailed",
                        message: `${relativePath}: ${error.message}`,
                      }),
                  ),
                )

          const note = new MemoryNote({ path: relativePath, frontmatter, body: noteBody })
          const encoded = yield* encodeMarkdown(note)

          yield* dieOnFsError(fs.makeDirectory(dirname(fullPath), { recursive: true }))
          yield* dieOnFsError(fs.writeFileString(fullPath, encoded))

          return note
        })

        return { templates, list, find, latest, query, values, links, recall, patch, create }
      }),
    ).pipe(Layer.provide(SearchEngine.layer))
}
