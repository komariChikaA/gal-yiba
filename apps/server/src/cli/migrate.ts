import "dotenv/config";
import { createDatabasePool, migrateDatabase } from "../db/index.js";

const pool = createDatabasePool();
try {
  await migrateDatabase(pool);
  console.log("Database migrations applied.");
} finally {
  await pool.end();
}
