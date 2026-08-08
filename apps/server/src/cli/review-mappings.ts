import "dotenv/config";
import {
  CatalogRepository,
  createDatabasePool,
  migrateDatabase,
} from "../db/index.js";
import { CatalogSyncService } from "../services/catalog-sync.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
}

const command = process.argv[2];
if (!command || !["list", "rebuild", "approve", "reject"].includes(command)) {
  throw new Error(
    "Usage: review-mappings.ts <list|rebuild|approve|reject> [--source=bangumi] [--source-id=123] [--limit=100]",
  );
}

const pool = createDatabasePool();
try {
  await migrateDatabase(pool);
  const repository = new CatalogRepository(pool);
  if (command === "list") {
    const limit = Number(argument("limit") ?? 100);
    const suggestions = await repository.listMappingSuggestions(limit);
    console.log(
      JSON.stringify({ count: suggestions.length, suggestions }, null, 2),
    );
  } else if (command === "rebuild") {
    const limit = Number(argument("limit") ?? 5_000);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20_000)
      throw new Error("INVALID_LIMIT");
    const summary = await new CatalogSyncService(
      pool,
    ).rebuildBangumiSuggestions(limit);
    console.log(JSON.stringify(summary));
  } else {
    const source = argument("source");
    const sourceId = argument("source-id");
    if ((source !== "vndb" && source !== "bangumi") || !sourceId) {
      throw new Error("SOURCE_AND_SOURCE_ID_REQUIRED");
    }
    const decision = command === "approve" ? "verified" : "rejected";
    await repository.reviewMappingSuggestion(source, sourceId, decision);
    console.log(JSON.stringify({ source, sourceId, decision }));
  }
} finally {
  await pool.end();
}
