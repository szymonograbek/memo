import { FetchHttpClient } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { ConfigError, Effect, Layer } from "effect"

import { EmbedderInfra, InfraLive } from "./app/layers.ts"
import { EmbedError } from "./embed/errors.ts"
import { MarkdownError } from "./markdown/errors.ts"
import { decodeFrontmatterJson } from "./markdown/service.ts"
import { isLinkGraph } from "./memory/data.ts"
import { MemoryError } from "./memory/errors.ts"
import { MemoryService } from "./memory/service.ts"
import { type SearchResult as InternalSearchResult } from "./search/data.ts"
import { SemanticSearchError } from "./semantic-search/errors.ts"
import { SemanticSearch } from "./semantic-search/service.ts"
import { TemplateError } from "./template/errors.ts"

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | Date
  | ReadonlyArray<FrontmatterValue>
  | { readonly [key: string]: FrontmatterValue }

export type Frontmatter = { readonly [key: string]: FrontmatterValue }

export interface MemoryNote {
  readonly path: string
  readonly frontmatter: Frontmatter
  readonly body: string
}

export interface SearchResult {
  readonly path: string
  readonly score: number
  readonly frontmatter: Frontmatter
}

export interface NoteLink {
  readonly raw: string
  readonly target: string
}

export interface IncomingLink {
  readonly from: string
  readonly raw: string
}

export interface UnresolvedLink {
  readonly from: string
  readonly raw: string
  readonly ambiguous: ReadonlyArray<string> | null
}

export interface NoteLinks {
  readonly path: string
  readonly outgoing: ReadonlyArray<NoteLink>
  readonly incoming: ReadonlyArray<IncomingLink>
}

export interface LinkGraph {
  readonly notes: ReadonlyArray<NoteLinks>
  readonly unresolved: ReadonlyArray<UnresolvedLink>
}

export interface ReindexStats {
  readonly indexed: number
  readonly unchanged: number
  readonly removed: number
}

export type MemoErrorCode =
  | "UnknownTemplate"
  | "NoteNotFound"
  | "AmbiguousNote"
  | "NoteAlreadyExists"
  | "UnsafePath"
  | "ValidationFailed"
  | "ConflictingArguments"
  | "InvalidJson"
  | "InvalidFrontmatter"
  | "EncodeFailed"
  | "MissingPlaceholder"
  | "InvalidTemplateFile"
  | "ReadFailed"
  | "ModelLoadFailed"
  | "EmbeddingFailed"
  | "ProviderRejected"
  | "IndexInconsistent"
  | "ConfigError"

export class MemoClientError {
  readonly name = "MemoClientError"

  constructor(
    readonly code: MemoErrorCode,
    readonly message: string,
  ) {}
}

export interface MemoryOptions {
  readonly rootDir: string
  readonly templateDirs: ReadonlyArray<string>
}

export interface SearchOptions {
  readonly limit?: number
  readonly offset?: number
  readonly type?: string
  readonly threshold?: number
  readonly recall?: boolean
}

export interface LatestOptions {
  readonly type?: string
  readonly limit?: number
  readonly offset?: number
}

export interface PatchInput {
  readonly frontmatter?: Frontmatter
  readonly body?: string
}

export interface CreateInput {
  readonly frontmatter: Frontmatter
  readonly body?: string
}

export interface ValidateResult {
  readonly ok: true
  readonly notes: number
  readonly templates: ReadonlyArray<string>
  readonly deadWikilinks: 0
}

export interface NoteSearchResult {
  readonly path: string
  readonly score: number
  readonly frontmatter: Frontmatter
  readonly body: string
}

type MemoryClientError = MemoryError | MarkdownError | TemplateError

type SemanticClientError =
  | MemoryClientError
  | EmbedError
  | SemanticSearchError
  | ConfigError.ConfigError

const toClientError = (reason: MemoErrorCode, message: string) =>
  new MemoClientError(reason, message)

const mapMemoryErrors = <A, R>(effect: Effect.Effect<A, MemoryClientError, R>) =>
  effect.pipe(
    Effect.catchTags({
      MemoryError: (error) => Effect.fail(toClientError(error.reason, error.message)),
      MarkdownError: (error) => Effect.fail(toClientError(error.reason, error.message)),
      TemplateError: (error) => Effect.fail(toClientError(error.reason, error.message)),
    }),
  )

const mapSemanticErrors = <A, R>(effect: Effect.Effect<A, SemanticClientError, R>) =>
  effect.pipe(
    Effect.catchTags({
      MemoryError: (error) => Effect.fail(toClientError(error.reason, error.message)),
      MarkdownError: (error) => Effect.fail(toClientError(error.reason, error.message)),
      TemplateError: (error) => Effect.fail(toClientError(error.reason, error.message)),
      EmbedError: (error) => Effect.fail(toClientError(error.reason, error.message)),
      SemanticSearchError: (error) => Effect.fail(toClientError(error.reason, error.message)),
      ConfigError: (error) => Effect.fail(toClientError("ConfigError", error.message)),
    }),
  )

const memoryLayer = (options: MemoryOptions) =>
  MemoryService.layer(options).pipe(Layer.provide(NodeContext.layer))

const semanticLayer = (options: MemoryOptions) =>
  SemanticSearch.layer.pipe(
    Layer.provideMerge(MemoryService.layer(options)),
    Layer.provideMerge(InfraLive),
    Layer.provideMerge(EmbedderInfra),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(NodeContext.layer),
  )

const defaultLimit = (value: number | undefined) => value ?? 20
const defaultOffset = (value: number | undefined) => value ?? 0

const recallSearchResults = Effect.fnUntraced(function* (
  results: ReadonlyArray<InternalSearchResult>,
  recall: boolean | undefined,
) {
  if (recall !== true) return results

  const memory = yield* MemoryService

  return yield* Effect.forEach(results, (result) =>
    memory.recall(result.path).pipe(
      Effect.map(
        (note): NoteSearchResult => ({
          path: note.path,
          score: result.score,
          frontmatter: note.frontmatter,
          body: note.body,
        }),
      ),
    ),
  )
})

export default class Memory {
  static fromEnv(): Memory {
    return new Memory({
      rootDir: process.env.MEMORY_DIR ?? "memory-data",
      templateDirs: [process.env.MEMORY_TEMPLATE_DIR ?? "templates"],
    })
  }

  constructor(private readonly options: MemoryOptions) {}

  validate(): Promise<ValidateResult> {
    return this.runMemory(
      Effect.gen(function* () {
        const memory = yield* MemoryService
        const notes = yield* memory.list()
        const graph = yield* memory.links(undefined)
        const unresolved = isLinkGraph(graph) ? graph.unresolved : []

        if (unresolved.length > 0) {
          return yield* new MemoryError({
            reason: "ValidationFailed",
            message: `Dead wikilinks: ${unresolved.map((link) => `${link.from} -> [[${link.raw}]]`).join(", ")}`,
          })
        }

        return {
          ok: true,
          notes: notes.length,
          templates: [...memory.templates.keys()],
          deadWikilinks: 0,
        }
      }),
    )
  }

  list(type?: string): Promise<ReadonlyArray<MemoryNote>> {
    return this.runMemory(
      Effect.gen(function* () {
        const memory = yield* MemoryService
        const notes = yield* memory.list()

        return type === undefined ? notes : notes.filter((note) => note.frontmatter.type === type)
      }),
    )
  }

  latest(options: LatestOptions = {}): Promise<ReadonlyArray<MemoryNote>> {
    return this.runMemory(
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.latest(
          options.type,
          defaultLimit(options.limit),
          defaultOffset(options.offset),
        )
      }),
    )
  }

  find(
    query: string,
    options: SearchOptions = {},
  ): Promise<ReadonlyArray<SearchResult> | ReadonlyArray<NoteSearchResult>> {
    return this.runMemory(
      Effect.gen(function* () {
        const memory = yield* MemoryService

        const results = yield* memory.find(
          query,
          defaultLimit(options.limit),
          defaultOffset(options.offset),
          options.type,
          options.threshold,
        )

        return yield* recallSearchResults(results, options.recall)
      }),
    )
  }

  search(
    query: string,
    options: SearchOptions = {},
  ): Promise<ReadonlyArray<SearchResult> | ReadonlyArray<NoteSearchResult>> {
    return this.runSemantic(
      Effect.gen(function* () {
        const semantic = yield* SemanticSearch

        yield* semantic.reindex()

        const results = yield* semantic.search(
          query,
          defaultLimit(options.limit),
          defaultOffset(options.offset),
          options.type,
          options.threshold,
        )

        return yield* recallSearchResults(results, options.recall)
      }),
    )
  }

  reindex(): Promise<ReindexStats> {
    return this.runSemantic(
      Effect.gen(function* () {
        const semantic = yield* SemanticSearch

        return yield* semantic.reindex()
      }),
    )
  }

  values(
    field: string,
    type?: string,
  ): Promise<ReadonlyArray<{ readonly value: string; readonly count: number }>> {
    return this.runMemory(
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.values(field, type)
      }),
    )
  }

  links(path?: string): Promise<LinkGraph | NoteLinks> {
    return this.runMemory(
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.links(path)
      }),
    )
  }

  recall(path: string): Promise<MemoryNote> {
    return this.runMemory(
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.recall(path)
      }),
    )
  }

  patch(path: string, input: PatchInput): Promise<MemoryNote> {
    return this.runMemory(
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.patch(path, input.frontmatter, input.body)
      }),
    )
  }

  create(type: string, input: CreateInput): Promise<MemoryNote> {
    return this.runMemory(
      Effect.gen(function* () {
        const memory = yield* MemoryService

        return yield* memory.create(type, input.frontmatter, input.body)
      }),
    )
  }

  createFromJson(type: string, frontmatter: string, body?: string): Promise<MemoryNote> {
    return this.runMemory(
      Effect.gen(function* () {
        const memory = yield* MemoryService
        const decoded = yield* decodeFrontmatterJson(frontmatter)

        return yield* memory.create(type, decoded, body)
      }),
    )
  }

  private runMemory<A>(effect: Effect.Effect<A, MemoryClientError, MemoryService>): Promise<A> {
    return Effect.runPromise(
      effect.pipe(Effect.provide(memoryLayer(this.options)), mapMemoryErrors),
    )
  }

  private runSemantic<A>(
    effect: Effect.Effect<A, SemanticClientError, MemoryService | SemanticSearch>,
  ): Promise<A> {
    return Effect.runPromise(
      effect.pipe(Effect.provide(semanticLayer(this.options)), mapSemanticErrors),
    )
  }
}
