import { Schema } from "effect"

import { Frontmatter } from "../memory/data.ts"

export class MarkdownDocument extends Schema.Class<MarkdownDocument>("MarkdownDocument")({
  frontmatter: Frontmatter,
  body: Schema.String,
}) {}
