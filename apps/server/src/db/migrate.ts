import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

export interface Migration {
  version: number;
  filename: string;
}

export const migrations: Migration[] = [
  { version: 1, filename: "001_initial.sql" },
];

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
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
