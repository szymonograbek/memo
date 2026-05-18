import { Effect, Layer } from "effect"

import { DimConfig } from "../embed/config.ts"
import { Database } from "./service.ts"

type Migration = {
  readonly id: number
  readonly name: string
  readonly sql: (ctx: { readonly dim: number }) => string
}

const migrations: ReadonlyArray<Migration> = [
  {
    id: 1,
    name: "init",
    sql: () => `
      CREATE TABLE notes (
        path         TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        mtime        INTEGER NOT NULL,
        title        TEXT,
        frontmatter  TEXT,
        body         TEXT NOT NULL,
        indexed_at   INTEGER NOT NULL
      );

      CREATE TABLE chunks (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        path    TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
        ord     INTEGER NOT NULL,
        heading TEXT,
        text    TEXT NOT NULL,
        UNIQUE(path, ord)
      );
      CREATE INDEX chunks_path ON chunks(path);

      CREATE TABLE links (
        src_path TEXT NOT NULL,
        target   TEXT NOT NULL,
        kind     TEXT NOT NULL CHECK (kind IN ('wikilink','tag'))
      );
      CREATE INDEX links_target ON links(target);

      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        text, heading, path,
        content='chunks', content_rowid='id',
        tokenize='porter unicode61'
      );

      CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, text, heading, path)
        VALUES (new.id, new.text, new.heading, new.path);
      END;
      CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text, heading, path)
        VALUES('delete', old.id, old.text, old.heading, old.path);
      END;

      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    id: 2,
    name: "vec_index",
    sql: ({ dim }) => `
      ALTER TABLE chunks ADD COLUMN embedding F32_BLOB(${dim});
      CREATE INDEX chunks_embedding_idx
        ON chunks (libsql_vector_idx(embedding, 'metric=cosine'));
      INSERT INTO meta(key, value) VALUES ('embedding_dim', '${dim}');
    `,
  },
]

export const MigratorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* Database
    const dim = yield* DimConfig

    yield* db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `)
    const applied = yield* db.all<{ id: number }>("SELECT id FROM schema_migrations")
    const seen = new Set(applied.map((r) => r.id))

    // libSQL's executeMultiple runs the script atomically; combining
    // the migration body with the bookkeeping INSERT keeps the whole
    // thing in one transaction without needing an outer BEGIN/COMMIT.
    yield* Effect.forEach(
      migrations.filter((m) => !seen.has(m.id)),
      (m) =>
        db.exec(
          `${m.sql({ dim })}
           INSERT INTO schema_migrations(id, name, applied_at)
           VALUES (${m.id}, '${m.name.replace(/'/g, "''")}', ${Date.now()});`,
        ),
      { discard: true },
    )
  }),
)
