import { Context, Effect, Layer, Schema } from "effect"
import { FileSystem } from "@effect/platform"
import { join, relative } from "node:path"
import { extractLinks, isAmbiguous, isResolved, isUnresolved, noteKey, resolveTarget } from "./links.ts"
import { decodeMarkdown, encodeMarkdown, MarkdownError } from "./markdown.ts"
import { IncomingLink, LinkGraph, MemoryNote, NoteLink, NoteLinks, SearchResult, TemplateDefinition, UnresolvedLink } from "./model.ts"
import { SearchEngine } from "./SearchEngine.ts"
import { loadTemplates, TemplateError, validateFrontmatter } from "./template.ts"

export class MemoryError extends Schema.TaggedError<MemoryError>()("MemoryError", {
  message: Schema.String,
}) {}

export interface MemoryOptions {
  readonly rootDir: string
  readonly templateDirs: readonly string[]
}

const mdFiles = (fs: FileSystem.FileSystem, dir: string): Effect.Effect<readonly string[], MemoryError> =>
  Effect.gen(function* () {
    const entries = yield* fs.readDirectory(dir).pipe(
      Effect.mapError((error) => new MemoryError({ message: `Failed to list ${dir}: ${String(error)}` })),
    )
    const nested = yield* Effect.all(entries.map((entry) => Effect.gen(function* () {
      const path = join(dir, entry)
      const info = yield* fs.stat(path).pipe(
        Effect.mapError((error) => new MemoryError({ message: `Failed to stat ${path}: ${String(error)}` })),
      )
      if (info.type === "Directory") return yield* mdFiles(fs, path)
      if (info.type === "File" && entry.endsWith(".md")) return [path]
      return []
    })))
    return nested.flat()
  })

export class MemoryService extends Context.Tag("@memory/MemoryService")<MemoryService, {
  readonly templates: ReadonlyMap<string, TemplateDefinition>
  readonly list: () => Effect.Effect<readonly MemoryNote[], MemoryError | MarkdownError | TemplateError>
  readonly find: (query: string, limit: number, offset: number, type?: string) => Effect.Effect<readonly SearchResult[], MemoryError | MarkdownError | TemplateError>
  readonly latest: (type: string | undefined, limit: number, offset: number) => Effect.Effect<readonly MemoryNote[], MemoryError | MarkdownError | TemplateError>
  readonly query: (field: string, value: string, limit: number, offset: number, type?: string) => Effect.Effect<readonly MemoryNote[], MemoryError | MarkdownError | TemplateError>
  readonly values: (field: string, type?: string) => Effect.Effect<readonly { readonly value: string; readonly count: number }[], MemoryError | MarkdownError | TemplateError>
  readonly links: (path?: string) => Effect.Effect<LinkGraph | NoteLinks, MemoryError | MarkdownError | TemplateError>
  readonly recall: (path: string) => Effect.Effect<MemoryNote, MemoryError | MarkdownError | TemplateError>
  readonly patch: (path: string, frontmatterPatch?: Readonly<Record<string, unknown>>, body?: string) => Effect.Effect<MemoryNote, MemoryError | MarkdownError | TemplateError>
}>() {
  static readonly layer = (options: MemoryOptions) => Layer.effect(
    MemoryService,
    Effect.gen(function* () {
      const search = yield* SearchEngine
      const fs = yield* FileSystem.FileSystem
      const templates = yield* loadTemplates(options.templateDirs)

      const readNote = (file: string) => Effect.gen(function* () {
        const raw = yield* fs.readFileString(file, "utf8").pipe(
          Effect.mapError((error) => new MemoryError({ message: `Failed to read ${file}: ${String(error)}` })),
        )
        return yield* decodeMarkdown(templates, relative(options.rootDir, file).replaceAll("\\", "/"), raw)
      })

      const list = Effect.fn("MemoryService.list")(function* () {
        const files = yield* mdFiles(fs, options.rootDir)
        return yield* Effect.all(files.map(readNote))
      })

      const find = Effect.fn("MemoryService.find")(function* (query: string, limit: number, offset: number, type?: string) {
        const notes = yield* list()
        const filtered = type === undefined ? notes : notes.filter((note) => note.frontmatter.type === type)
        return yield* search.search(filtered, query, limit, offset)
      })

      const noteTime = (note: MemoryNote) => {
        const value = note.frontmatter.updatedAt ?? note.frontmatter.updated ?? note.frontmatter.date ?? note.frontmatter.valid_from
        const time = Date.parse(String(value ?? ""))
        return Number.isNaN(time) ? 0 : time
      }

      const compactTimeSort = (left: MemoryNote, right: MemoryNote) => noteTime(right) - noteTime(left) || left.path.localeCompare(right.path)

      const latest = Effect.fn("MemoryService.latest")(function* (type: string | undefined, limit: number, offset: number) {
        const notes = yield* list()
        return notes
          .filter((note) => type === undefined || note.frontmatter.type === type)
          .sort(compactTimeSort)
          .slice(offset, offset + limit)
      })

      const query = Effect.fn("MemoryService.query")(function* (field: string, value: string, limit: number, offset: number, type?: string) {
        const notes = yield* list()
        const expected = value.toLowerCase()
        return notes
          .filter((note) => type === undefined || note.frontmatter.type === type)
          .filter((note) => {
            const actual = note.frontmatter[field]
            const items = Array.isArray(actual) ? actual : [actual]
            return items.some((item) => String(item).toLowerCase() === expected)
          })
          .sort(compactTimeSort)
          .slice(offset, offset + limit)
      })

      const values = Effect.fn("MemoryService.values")(function* (field: string, type?: string) {
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
        return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([value, count]) => ({ value, count }))
      })

      const links = Effect.fn("MemoryService.links")(function* (path?: string) {
        const notes = yield* list()
        const keys = new Set(notes.map(noteKey))
        const outgoing = new Map<string, NoteLink[]>()
        const incoming = new Map<string, IncomingLink[]>()
        const unresolved: UnresolvedLink[] = []

        for (const note of notes) {
          const from = noteKey(note)
          const out: NoteLink[] = []
          for (const raw of extractLinks(note.body)) {
            const resolved = resolveTarget(raw, keys)
            if (isResolved(resolved)) {
              out.push(new NoteLink({ raw, target: resolved.target }))
              const existing = incoming.get(resolved.target) ?? []
              incoming.set(resolved.target, [...existing, new IncomingLink({ from, raw })])
            } else {
              unresolved.push(new UnresolvedLink({
                from,
                raw,
                ambiguous: isAmbiguous(resolved) ? resolved.candidates : null,
              }))
            }
          }
          outgoing.set(from, out)
        }

        const noteLinks = (key: string) => new NoteLinks({
          path: key,
          outgoing: outgoing.get(key) ?? [],
          incoming: incoming.get(key) ?? [],
        })

        if (path !== undefined) {
          const resolved = resolveTarget(path, keys)
          if (isUnresolved(resolved)) return yield* new MemoryError({ message: `No note matches ${path}` })
          if (isAmbiguous(resolved)) return yield* new MemoryError({ message: `Ambiguous note ${path}: ${resolved.candidates.join(", ")}` })
          return noteLinks(resolved.target)
        }

        return new LinkGraph({
          notes: [...keys].map(noteLinks).filter((entry) => entry.outgoing.length > 0 || entry.incoming.length > 0),
          unresolved,
        })
      })

      const recall = Effect.fn("MemoryService.recall")(function* (path: string) {
        const fullPath = join(options.rootDir, path)
        const note = yield* readNote(fullPath)
        const recalledTimes = typeof note.frontmatter.recalledTimes === "number" ? note.frontmatter.recalledTimes + 1 : 1
        const next = new MemoryNote({ path: note.path, body: note.body, frontmatter: { ...note.frontmatter, recalledTimes, lastRecalledAt: new Date().toISOString() } })
        const encoded = yield* encodeMarkdown(next)
        yield* fs.writeFileString(fullPath, encoded).pipe(
          Effect.mapError((error) => new MemoryError({ message: `Failed to write ${fullPath}: ${String(error)}` })),
        )
        return next
      })

      const patch = Effect.fn("MemoryService.patch")(function* (path: string, frontmatterPatch?: Readonly<Record<string, unknown>>, body?: string) {
        const fullPath = join(options.rootDir, path)
        const note = yield* readNote(fullPath)
        const nextFrontmatter = frontmatterPatch ? { ...note.frontmatter, ...frontmatterPatch, updatedAt: new Date().toISOString() } : note.frontmatter
        const type = typeof nextFrontmatter.type === "string" ? nextFrontmatter.type : undefined
        const template = type !== undefined ? templates.get(type) : undefined
        if (!template) return yield* new MemoryError({ message: `${path}: unknown template type ${String(nextFrontmatter.type)}` })
        yield* validateFrontmatter(template, nextFrontmatter).pipe(
          Effect.mapError((error) => new MemoryError({ message: `${path}: ${error.message}` })),
        )
        const nextBody = body !== undefined ? body : note.body
        const next = new MemoryNote({ path: note.path, body: nextBody, frontmatter: nextFrontmatter })
        const encoded = yield* encodeMarkdown(next)
        yield* fs.writeFileString(fullPath, encoded).pipe(
          Effect.mapError((error) => new MemoryError({ message: `Failed to write ${fullPath}: ${String(error)}` })),
        )
        return next
      })

      return { templates, list, find, latest, query, values, links, recall, patch }
    }),
  ).pipe(Layer.provide(SearchEngine.layer))
}
