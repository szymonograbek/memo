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
```
