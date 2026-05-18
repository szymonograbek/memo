import { Schema } from "effect"

export interface FieldSpec {
  readonly type: "string" | "number" | "int" | "boolean" | "date" | "datetime" | "enum" | "array"
  readonly values?: readonly string[] | undefined
  readonly items?: FieldSpec | undefined
  readonly min?: number | undefined
}

export const FieldSpec: Schema.Schema<FieldSpec> = Schema.suspend(() => Schema.Struct({
  type: Schema.Literal("string", "number", "int", "boolean", "date", "datetime", "enum", "array"),
  values: Schema.optional(Schema.Array(Schema.String)),
  items: Schema.optional(FieldSpec),
  min: Schema.optional(Schema.Number),
}))

export class TemplateDefinition extends Schema.Class<TemplateDefinition>("TemplateDefinition")({
  type: Schema.String,
  description: Schema.optional(Schema.String),
  path: Schema.Struct({ pattern: Schema.String }),
  frontmatter: Schema.Struct({
    required: Schema.Record({ key: Schema.String, value: FieldSpec }),
    optional: Schema.optional(Schema.Record({ key: Schema.String, value: FieldSpec })),
  }),
  search: Schema.optional(Schema.Struct({
    fields: Schema.Array(Schema.String),
    title: Schema.optional(Schema.String),
  })),
  body: Schema.String,
}) {}

export type FrontmatterValue = string | number | boolean | null | readonly FrontmatterValue[] | { readonly [key: string]: FrontmatterValue }
export type Frontmatter = Readonly<Record<string, FrontmatterValue>>

export class MemoryNote extends Schema.Class<MemoryNote>("MemoryNote")({
  path: Schema.String,
  frontmatter: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  body: Schema.String,
}) {}

export class MarkdownDocument extends Schema.Class<MarkdownDocument>("MarkdownDocument")({
  frontmatter: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  body: Schema.String,
}) {}

export class SearchResult extends Schema.Class<SearchResult>("SearchResult")({
  path: Schema.String,
  score: Schema.Number,
  frontmatter: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
}) {}

export class NoteLink extends Schema.Class<NoteLink>("NoteLink")({
  raw: Schema.String,
  target: Schema.String,
}) {}

export class IncomingLink extends Schema.Class<IncomingLink>("IncomingLink")({
  from: Schema.String,
  raw: Schema.String,
}) {}

export class UnresolvedLink extends Schema.Class<UnresolvedLink>("UnresolvedLink")({
  from: Schema.String,
  raw: Schema.String,
  ambiguous: Schema.NullOr(Schema.Array(Schema.String)),
}) {}

export class NoteLinks extends Schema.Class<NoteLinks>("NoteLinks")({
  path: Schema.String,
  outgoing: Schema.Array(NoteLink),
  incoming: Schema.Array(IncomingLink),
}) {}

export class LinkGraph extends Schema.Class<LinkGraph>("LinkGraph")({
  notes: Schema.Array(NoteLinks),
  unresolved: Schema.Array(UnresolvedLink),
}) {}

export const isLinkGraph = Schema.is(LinkGraph)
