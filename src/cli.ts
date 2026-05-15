#!/usr/bin/env bun
import { Args, Command, Options } from "@effect/cli"
import { FileSystem } from "@effect/platform"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Console, Effect, Option, Schema } from "effect"
import { loadMemoryCliConfig } from "./config.ts"
import { MemoryError, MemoryService } from "./services/MemoryService.ts"
import { LinkGraph } from "./models/model.ts"

const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2))
const isLinkGraph = Schema.is(LinkGraph)

const withMemory = <A, E, R>(effect: Effect.Effect<A, E, R | MemoryService>) =>
  Effect.gen(function* () {
    const config = yield* loadMemoryCliConfig
    return yield* effect.pipe(Effect.provide(MemoryService.layer({ rootDir: config.rootDir, templateDirs: [config.templateDir] })))
  })

const validate = Command.make("validate", {}, () => withMemory(Effect.gen(function* () {
  const memory = yield* MemoryService
  const notes = yield* memory.list()
  const graph = yield* memory.links()
  const unresolved = isLinkGraph(graph) ? graph.unresolved : []
  if (unresolved.length > 0) {
    return yield* new MemoryError({ message: `Dead wikilinks: ${unresolved.map((link) => `${link.from} -> [[${link.raw}]]`).join(", ")}` })
  }
  yield* printJson({ ok: true, notes: notes.length, templates: [...memory.templates.keys()], deadWikilinks: 0 })
})))

const list = Command.make("list", { type: Args.text({ name: "type" }).pipe(Args.optional) }, ({ type }) => withMemory(Effect.gen(function* () {
  const memory = yield* MemoryService
  const notes = yield* memory.list()
  const typeValue = Option.getOrUndefined(type)
  const filtered = typeValue === undefined ? notes : notes.filter((note) => note.frontmatter.type === typeValue)
  yield* printJson(filtered.map((note) => ({ path: note.path, ...note.frontmatter })))
})))

const find = Command.make("find", {
  query: Args.text({ name: "query" }),
  limit: Options.integer("limit").pipe(Options.withDefault(20)),
  offset: Options.integer("offset").pipe(Options.withDefault(0)),
  type: Options.text("type").pipe(Options.optional),
}, ({ query, limit, offset, type }) => withMemory(Effect.gen(function* () {
  const memory = yield* MemoryService
  const results = yield* memory.find(query, limit, offset, Option.getOrUndefined(type))
  yield* printJson(results)
})))

const latest = Command.make("latest", {
  type: Args.text({ name: "type" }).pipe(Args.optional),
  limit: Options.integer("limit").pipe(Options.withDefault(20)),
  offset: Options.integer("offset").pipe(Options.withDefault(0)),
}, ({ type, limit, offset }) => withMemory(Effect.gen(function* () {
  const memory = yield* MemoryService
  const notes = yield* memory.latest(Option.getOrUndefined(type), limit, offset)
  yield* printJson(notes.map((note) => ({ path: note.path, ...note.frontmatter })))
})))

const query = Command.make("query", {
  field: Args.text({ name: "field" }),
  value: Args.text({ name: "value" }),
  limit: Options.integer("limit").pipe(Options.withDefault(20)),
  offset: Options.integer("offset").pipe(Options.withDefault(0)),
  type: Options.text("type").pipe(Options.optional),
}, ({ field, value, limit, offset, type }) => withMemory(Effect.gen(function* () {
  const memory = yield* MemoryService
  const notes = yield* memory.query(field, value, limit, offset, Option.getOrUndefined(type))
  yield* printJson(notes.map((note) => ({ path: note.path, ...note.frontmatter })))
})))

const values = Command.make("values", {
  field: Args.text({ name: "field" }),
  type: Args.text({ name: "type" }).pipe(Args.optional),
}, ({ field, type }) => withMemory(Effect.gen(function* () {
  const memory = yield* MemoryService
  const results = yield* memory.values(field, Option.getOrUndefined(type))
  yield* printJson(results)
})))

const links = Command.make("links", { path: Args.path({ name: "path" }).pipe(Args.optional) }, ({ path }) => withMemory(Effect.gen(function* () {
  const memory = yield* MemoryService
  const result = yield* memory.links(Option.getOrUndefined(path))
  yield* printJson(result)
})))

const recall = Command.make("recall", {
  path: Args.path({ name: "path" }),
  saveBodyTo: Options.file("save-body-to").pipe(Options.optional),
}, ({ path, saveBodyTo }) => withMemory(Effect.gen(function* () {
  const memory = yield* MemoryService
  const fs = yield* FileSystem.FileSystem
  const note = yield* memory.recall(path)
  yield* Option.match(saveBodyTo, {
    onNone: () => Effect.void,
    onSome: (file) => fs.writeFileString(file, note.body).pipe(
      Effect.mapError((e) => new MemoryError({ message: `Failed to write body to ${file}: ${String(e)}` })),
    ),
  })
  yield* printJson({ path: note.path, frontmatter: note.frontmatter, body: note.body })
})))

const patch = Command.make("patch", {
  path: Args.path({ name: "path" }),
  frontmatter: Options.text("frontmatter").pipe(Options.optional),
  body: Options.text("body").pipe(Options.optional),
  bodyFile: Options.file("body-file").pipe(Options.optional),
}, ({ path, frontmatter, body, bodyFile }) => withMemory(Effect.gen(function* () {
  const memory = yield* MemoryService
  const fs = yield* FileSystem.FileSystem
  const frontmatterPatch = Option.map(frontmatter, (json) => JSON.parse(json) as Record<string, unknown>)
  if (Option.isSome(body) && Option.isSome(bodyFile)) {
    return yield* new MemoryError({ message: "--body and --body-file are mutually exclusive" })
  }
  const bodyFromFile = yield* Option.match(bodyFile, {
    onNone: () => Effect.succeed(Option.none<string>()),
    onSome: (file) => fs.readFileString(file, "utf8").pipe(
      Effect.mapError((e) => new MemoryError({ message: `Failed to read body file: ${String(e)}` })),
      Effect.map(Option.some),
    ),
  })
  const bodyValue = Option.getOrUndefined(Option.orElse(body, () => bodyFromFile))
  if (Option.isNone(frontmatter) && bodyValue === undefined) {
    return yield* new MemoryError({ message: "At least one of --frontmatter, --body, or --body-file must be provided" })
  }
  const note = yield* memory.patch(path, Option.getOrUndefined(frontmatterPatch), bodyValue)
  yield* printJson({ path: note.path, frontmatter: note.frontmatter, body: note.body })
})))

const command = Command.make("memo").pipe(Command.withSubcommands([validate, list, latest, find, query, values, links, recall, patch]))

Command.run(command, {
  name: "memo",
  version: "0.1.0",
})(process.argv).pipe(
  Effect.provide(BunContext.layer),
  BunRuntime.runMain,
)
