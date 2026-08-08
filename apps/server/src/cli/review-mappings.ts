import "dotenv/config";
import {
  CatalogRepository,
  createDatabasePool,
  migrateDatabase,
} from "../db/index.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
}

const command = process.argv[2];
if (!command || !["list", "approve", "reject"].includes(command)) {
  throw new Error(
    "Usage: review-mappings.ts <list|approve|reject> [--source=bangumi] [--source-id=123]",
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
