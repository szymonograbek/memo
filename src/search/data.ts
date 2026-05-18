import { Schema } from "effect"

import { Frontmatter } from "../memory/data.ts"

export class SearchResult extends Schema.Class<SearchResult>("SearchResult")({
  path: Schema.String,
  score: Schema.Number,
  frontmatter: Frontmatter,
}) {}
