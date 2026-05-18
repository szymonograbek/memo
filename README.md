# memo

Markdown-based memory system with YAML frontmatter, wikilinks, templates, and fuzzy search. Effect-based CLI running on Bun.

## Install

```sh
bun install
bun link
```

`memo` is now available globally.

## Configuration

Environment variables:

- `MEMORY_DIR` — root directory of memory notes (default: `memory-data`)
- `MEMORY_TEMPLATE_DIR` — directory of YAML template files (default: `templates`)

## Templates

Templates live in `MEMORY_TEMPLATE_DIR` and must be named `<name>.memory-template.yaml`. Each template defines one note `type`, the frontmatter fields it requires, and metadata used by the CLI.

### Shape

```yaml
type: book # unique note type id (required)
description: Reading notes # optional, human-readable
path:
  pattern: "books/{slug}.md" # required; intended path layout for new notes
frontmatter:
  required: # validated on `memo validate` / writes
    title: { type: string }
    started: { type: date }
  optional: # validated only when present
    rating: { type: int, min: 1 }
    tags:
      type: array
      items: { type: string }
search: # optional, informational
  fields: [title, tags]
  title: title
body: | # required; default body for new notes
  # {title}
```

Both `path.pattern` and `body` are interpolated with `{name}` placeholders
resolved from the frontmatter provided at creation time.

### Field types

Each entry under `frontmatter.required` / `frontmatter.optional` is a `FieldSpec`:

| `type`     | Notes                                                          |
| ---------- | -------------------------------------------------------------- |
| `string`   | Any string.                                                    |
| `number`   | Any number.                                                    |
| `int`      | Integer. With `min: N` requires `value >= N`.                  |
| `boolean`  | `true` / `false`.                                              |
| `date`     | YAML date or ISO date string.                                  |
| `datetime` | YAML datetime or ISO datetime string.                          |
| `enum`     | String constrained to `values: [...]`.                         |
| `array`    | List of `items: <FieldSpec>` (defaults to `{ type: string }`). |

### Validation

- `memo validate` loads every `*.memory-template.yaml` in `MEMORY_TEMPLATE_DIR` and checks each note's frontmatter against its `type`'s template.
- `required` fields must be present and well-typed; `optional` fields are checked only when set.
- Unknown frontmatter keys are allowed and preserved.

## Creating notes

```sh
memo create book --frontmatter '{"title":"Dune","slug":"dune"}'
```

- Looks up the template by `<type>`.
- Builds the file path by interpolating `path.pattern` with frontmatter values.
- Validates the frontmatter against `frontmatter.required` / `optional`.
- Refuses to overwrite an existing file.
- Auto-injects `createdAt`, `updatedAt`, and `type`.
- Body defaults to the interpolated `template.body`; override with `--body` or `--body-file` (those are used verbatim, no interpolation).

## Commands

```
memo validate
memo list [type]
memo latest [type] --limit 20 --offset 0
memo find "<text>" --type <type> --limit 10 --offset 0
memo query <field> <value> --type <type> --limit 10 --offset 0
memo values <field> [type]
memo links [note]
memo recall <path> [--save-body-to <file>]
memo patch <path> [--frontmatter '<json>'] [--body '<text>' | --body-file <file>]
memo create <type> --frontmatter '<json>' [--body '<text>' | --body-file <file>]
```
