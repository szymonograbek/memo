import { Schema } from "effect"

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | Date
  | ReadonlyArray<FrontmatterValue>
  | { readonly [key: string]: FrontmatterValue }
export type Frontmatter = { readonly [key: string]: FrontmatterValue }

export const FrontmatterValue: Schema.Schema<FrontmatterValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.DateFromSelf,
    Schema.Array(FrontmatterValue),
    Schema.Record({ key: Schema.String, value: FrontmatterValue }),
  ).annotations({ identifier: "FrontmatterValue" }),
)

export const Frontmatter = Schema.Record({ key: Schema.String, value: FrontmatterValue })
  .annotations({ identifier: "Frontmatter" })

export class MemoryNote extends Schema.Class<MemoryNote>("MemoryNote")({
  path: Schema.String,
  frontmatter: Frontmatter,
  body: Schema.String,
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
