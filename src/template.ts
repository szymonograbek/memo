import { FileSystem } from "@effect/platform"
import { Effect, Schema } from "effect"
import { parse } from "yaml"
import { join } from "node:path"
import { TemplateDefinition } from "./models/model.ts"
import type { FieldSpec } from "./models/model.ts"

export class TemplateError extends Schema.TaggedError<TemplateError>()("TemplateError", {
  message: Schema.String,
}) {}

const DateLike = Schema.Union(Schema.String, Schema.DateFromSelf)

const fieldSchema = (field: FieldSpec): Schema.Schema.AnyNoContext => {
  switch (field.type) {
    case "string":
      return Schema.String
    case "date":
    case "datetime":
      return DateLike
    case "number":
      return Schema.Number
    case "int":
      if (field.min === undefined) return Schema.Int
      const min = field.min
      return Schema.Int.pipe(Schema.filter((value) => value >= min))
    case "boolean":
      return Schema.Boolean
    case "enum":
      return Schema.String.pipe(Schema.filter((value) => field.values?.includes(value) === true))
    case "array":
      return Schema.Array(fieldSchema(field.items ?? { type: "string" }))
  }
}

const decodeField = (template: TemplateDefinition, key: string, field: FieldSpec, value: unknown) =>
  Schema.decodeUnknown(fieldSchema(field))(value).pipe(
    Effect.asVoid,
    Effect.mapError((error) => new TemplateError({ message: `${template.type}.${key}: ${error.message}` })),
  )

export const interpolate = (pattern: string, values: Readonly<Record<string, unknown>>): Effect.Effect<string, TemplateError> =>
  Effect.gen(function* () {
    const missing: string[] = []
    const result = pattern.replace(/\{([a-zA-Z_][\w-]*)\}/g, (_, key: string) => {
      const value = values[key]
      if (value === undefined || value === null) {
        missing.push(key)
        return ""
      }
      return String(value)
    })
    if (missing.length > 0) return yield* new TemplateError({ message: `Missing placeholder(s): ${missing.join(", ")}` })
    return result
  })

export const validateFrontmatter = (template: TemplateDefinition, data: Readonly<Record<string, unknown>>): Effect.Effect<void, TemplateError> =>
  Effect.gen(function* () {
    for (const [key, field] of Object.entries(template.frontmatter.required)) {
      yield* decodeField(template, key, field, data[key])
    }
    for (const [key, field] of Object.entries(template.frontmatter.optional ?? {})) {
      if (data[key] !== undefined) yield* decodeField(template, key, field, data[key])
    }
  })

const loadTemplateFile = (fs: FileSystem.FileSystem, path: string) =>
  fs.readFileString(path, "utf8").pipe(
    Effect.mapError((error) => new TemplateError({ message: `Failed to read ${path}: ${String(error)}` })),
    Effect.flatMap((content) => Effect.try({
      try: () => parse(content),
      catch: (error) => new TemplateError({ message: `Failed to parse ${path}: ${String(error)}` }),
    })),
    Effect.flatMap((raw) => Schema.decodeUnknown(TemplateDefinition)(raw).pipe(
      Effect.mapError((error) => new TemplateError({ message: `${path}: ${error.message}` })),
    )),
  )

export const loadTemplates = (dirs: readonly string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const templates = new Map<string, TemplateDefinition>()
    for (const dir of dirs) {
      const names = yield* fs.readDirectory(dir).pipe(
        Effect.mapError((error) => new TemplateError({ message: `Failed to list ${dir}: ${String(error)}` })),
      )
      for (const name of names.filter((entry) => entry.endsWith(".memory-template.yaml"))) {
        const template = yield* loadTemplateFile(fs, join(dir, name))
        templates.set(template.type, template)
      }
    }
    return templates
  })
