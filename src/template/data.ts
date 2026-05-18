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
}).annotations({ identifier: "FieldSpec" }))

export class TemplateDefinition extends Schema.Class<TemplateDefinition>("TemplateDefinition")({
  type: Schema.String,
  description: Schema.optional(Schema.String),
  path: Schema.Struct({ pattern: Schema.String }).annotations({ identifier: "TemplatePath" }),
  frontmatter: Schema.Struct({
    required: Schema.Record({ key: Schema.String, value: FieldSpec }),
    optional: Schema.optional(Schema.Record({ key: Schema.String, value: FieldSpec })),
  }).annotations({ identifier: "TemplateFrontmatterSpec" }),
  search: Schema.optional(Schema.Struct({
    fields: Schema.Array(Schema.String),
    title: Schema.optional(Schema.String),
  }).annotations({ identifier: "TemplateSearchSpec" })),
  body: Schema.String,
}) {}
