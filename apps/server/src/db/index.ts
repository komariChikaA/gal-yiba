import pg from "pg";
import { migrateDatabase } from "./migrate.js";

const { Pool } = pg;

export function createDatabasePool(
  connectionString = process.env.DATABASE_URL,
): pg.Pool {
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");
  return new Pool({ connectionString, max: 10 });
}

export { CatalogRepository } from "./catalog-repository.js";
export { migrateDatabase };
