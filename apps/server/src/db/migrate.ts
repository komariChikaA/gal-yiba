import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";
import { normalizeTitle, type SourceVisualNovel } from "@gal-yiba/data";

export interface Migration {
  version: number;
  filename: string;
}

export const migrations: Migration[] = [
  { version: 1, filename: "001_initial.sql" },
  { version: 2, filename: "002_source_title_keys.sql" },
];

function titleKeys(record: SourceVisualNovel): string[] {
  return [
    ...new Set(
      [record.title, ...record.alternativeTitles]
        .map(normalizeTitle)
        .filter(Boolean),
    ),
  ];
}

async function backfillSourceTitleKeys(client: PoolClient): Promise<void> {
  const pending = await client.query<{
    source: SourceVisualNovel["source"];
    source_id: string;
    normalized: SourceVisualNovel;
  }>(
    "SELECT source, source_id, normalized FROM source_records WHERE title_keys_version < 1",
  );
  for (const row of pending.rows) {
    await client.query(
      "UPDATE source_records SET title_keys = $3, title_keys_version = 1 WHERE source = $1 AND source_id = $2",
      [row.source, row.source_id, titleKeys(row.normalized)],
    );
  }
}

export async function migrateDatabase(
  pool: Pick<Pool, "connect">,
): Promise<void> {
  const client = (await pool.connect()) as PoolClient;
  const migrationDirectory = join(
    dirname(fileURLToPath(import.meta.url)),
    "migrations",
  );

  try {
    await client.query("BEGIN");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = await client.query<{ version: number }>(
      "SELECT version FROM schema_migrations",
    );
    const appliedVersions = new Set(applied.rows.map((row) => row.version));

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      const sql = await readFile(
        join(migrationDirectory, migration.filename),
        "utf8",
      );
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [
        migration.version,
      ]);
    }
    await backfillSourceTitleKeys(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
