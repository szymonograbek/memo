import { Effect, Schema } from "effect"
import matter from "gray-matter"
import { randomUUID } from "node:crypto"
import { parse as parseYaml } from "yaml"
import { Frontmatter, MemoryNote } from "../memory/data.ts"
import { TemplateDefinition } from "../template/data.ts"
import { validateFrontmatter } from "../template/service.ts"
import { MarkdownDocument } from "./data.ts"
import { MarkdownError } from "./errors.ts"

const FrontmatterWithType = Schema.Struct({
  type: Schema.String,
}).annotations({ identifier: "FrontmatterWithType" })

const FrontmatterJson = Schema.parseJson(Frontmatter).annotations({
  identifier: "FrontmatterJson",
})

export const decodeFrontmatterJson = (input: string) =>
  Schema.decodeUnknown(FrontmatterJson)(input).pipe(
    Effect.mapError((error) => new MarkdownError({ reason: "InvalidJson", message: `Invalid frontmatter JSON: ${error.message}` })),
  )

type ParsedMatter = {
  readonly data: unknown
  readonly content: string
}

const parseYamlMatter = (raw: string): ParsedMatter => {
  const parsed = matter(raw, { engines: { yaml: (text) => parseYaml(text) } })
  return { data: parsed.data, content: parsed.content }
}

const parseMatter = (raw: string): ParsedMatter => parseYamlMatter(raw)

const decodeDocument = (path: string, raw: string) => {
  const parsed = parseMatter(raw)
  return Schema.decodeUnknown(MarkdownDocument)({
    frontmatter: parsed.data,
    body: parsed.content,
  }).pipe(
    Effect.mapError((error) => new MarkdownError({ reason: "InvalidFrontmatter", message: `${path}: ${error.message}` })),
  )
}

const decodeTypedFrontmatter = (path: string, frontmatter: unknown) =>
  Schema.decodeUnknown(FrontmatterWithType)(frontmatter).pipe(
    Effect.mapError((error) => new MarkdownError({ reason: "InvalidFrontmatter", message: `${path}: invalid frontmatter: ${error.message}` })),
  )

const asDateString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.length > 0) return value
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return undefined
}

export const normalizeFrontmatter = (frontmatter: Readonly<Record<string, unknown>>) => {
  const fallbackDate = asDateString(frontmatter.updatedAt)
    ?? asDateString(frontmatter.updated)
    ?? new Date().toISOString()

  return {
    ...frontmatter,
    id: typeof frontmatter.id === "string" ? frontmatter.id : randomUUID(),
    createdAt: asDateString(frontmatter.createdAt) ?? fallbackDate,
    updatedAt: asDateString(frontmatter.updatedAt) ?? asDateString(frontmatter.updated) ?? fallbackDate,
    recalledTimes: typeof frontmatter.recalledTimes === "number" ? frontmatter.recalledTimes : 0,
    lastRecalledAt: frontmatter.lastRecalledAt ?? null,
  }
}

const validateAgainstTemplate = (
  path: string,
  template: TemplateDefinition,
  frontmatter: Readonly<Record<string, unknown>>,
) => validateFrontmatter(template, frontmatter).pipe(
  Effect.mapError((error) => new MarkdownError({ reason: "InvalidFrontmatter", message: `${path}: ${error.message}` })),
)

const decodeNote = (path: string, frontmatter: Readonly<Record<string, unknown>>, body: string) =>
  Schema.decodeUnknown(MemoryNote)({ path, frontmatter, body: body.trimStart() }).pipe(
    Effect.mapError((error) => new MarkdownError({ reason: "InvalidFrontmatter", message: `${path}: ${error.message}` })),
  )

export const decodeMarkdown = Effect.fnUntraced(function* (
  templates: ReadonlyMap<string, TemplateDefinition>,
  path: string,
  raw: string,
) {
  const document = yield* decodeDocument(path, raw)
  const typed = yield* decodeTypedFrontmatter(path, document.frontmatter)
  const template = templates.get(typed.type)
  if (!template) {
    return yield* new MarkdownError({ reason: "UnknownTemplate", message: `${path}: unknown template type ${typed.type}` })
  }

  const normalized = normalizeFrontmatter(document.frontmatter)
  yield* validateAgainstTemplate(path, template, normalized)
  return yield* decodeNote(path, normalized, document.body)
})

export const encodeMarkdown = (note: MemoryNote) =>
  Schema.encode(MemoryNote)(note).pipe(
    Effect.mapError((error) => new MarkdownError({ reason: "EncodeFailed", message: `Failed to encode ${note.path}: ${error.message}` })),
    Effect.flatMap((encoded) => Effect.try({
      try: () => matter.stringify(encoded.body, encoded.frontmatter),
      catch: (error) => new MarkdownError({ reason: "EncodeFailed", message: `Failed to encode ${note.path}: ${String(error)}` }),
    })),
  )
