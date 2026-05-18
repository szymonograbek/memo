# memo

Markdown-based memory system with YAML frontmatter, wikilinks, templates, fuzzy search, and semantic search.

## Install

```sh
npm install -g memo
```

`memo` is now available globally. For local development use `bun install` and `bun run dev`.

## JavaScript API

```ts
import Memory from "memo"

const memory = Memory.fromEnv()
const notes = await memory.find("Dune", { limit: 10 })
const note = await memory.recall(notes[0].path)
```

The API returns Promises and plain JavaScript objects; consumers do not need to use Effect.

## Configuration

Environment variables:

- `MEMORY_DIR` — root directory of memory notes (default: `memory-data`)
- `MEMORY_TEMPLATE_DIR` — directory of YAML template files (default: `templates`)
- `MEMORIES_DB` — libSQL database URL for the semantic index (default: `file:${MEMORY_DIR}/.index/notes.db`; use `:memory:` for tests)
- `EMBEDDING_PROVIDER` — embedding backend: `gemini` or `transformers` (default: `gemini`)
- `EMBEDDING_DIM` — embedding vector size (default: `768`; use `384` with the default Transformers model)
- `GEMINI_API_KEY` — required when `EMBEDDING_PROVIDER=gemini`
- `GEMINI_EMBEDDING_MODEL` — Gemini embedding model (default: `gemini-embedding-001`)
- `TRANSFORMERS_EMBEDDING_MODEL` — local Transformers model (default: `Xenova/all-MiniLM-L6-v2`)

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
- Dead wikilinks fail validation.

## Creating notes

```sh
memo create book --frontmatter '{"title":"Dune","slug":"dune","started":"2026-01-01"}'
```

- Looks up the template by `<type>`.
- Builds the file path by interpolating `path.pattern` with frontmatter values.
- Validates the frontmatter against `frontmatter.required` / `optional`.
- Refuses to overwrite an existing file.
- Auto-injects `createdAt`, `updatedAt`, and `type`.
- Body defaults to the interpolated `template.body`; override with `--body` or `--body-file` (those are used verbatim, no interpolation).

## Search

`memo find` performs local fuzzy search over paths, body text, and frontmatter. Use `--threshold <score>` to drop weak matches, and `--recall` to return and mark the matched notes as recalled.

`memo search` performs semantic search. It reindexes incrementally before each query, stores vectors in libSQL, and supports the same pagination/type filters. Use `--threshold <score>` to drop weak matches, and `--recall` to return and mark the matched notes as recalled.

## Commands

```sh
memo validate
memo list [type]
memo latest [type] --limit 20 --offset 0
memo find "<text>" --type <type> --limit 20 --offset 0 [--threshold <score>] [--recall]
memo search "<text>" --type <type> --limit 20 --offset 0 [--threshold <score>] [--recall]
memo values <field> [type]
memo links [note]
memo recall <path> [--save-body-to <file>]
memo patch <path> [--frontmatter '<json>'] [--body '<text>' | --body-file <file>]
memo create <type> --frontmatter '<json>' [--body '<text>' | --body-file <file>]
```

`memo recall` also updates `recalledTimes` and `lastRecalledAt` on the note.
