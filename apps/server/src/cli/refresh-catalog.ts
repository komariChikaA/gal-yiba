import "dotenv/config";
import { BangumiClient, VndbClient } from "@gal-yiba/data";
import {
  CatalogRepository,
  createDatabasePool,
  migrateDatabase,
} from "../db/index.js";
import { CatalogSyncService } from "../services/catalog-sync.js";

const source = process.argv[2];
if (source !== "vndb" && source !== "bangumi") {
  throw new Error("Usage: refresh-catalog.ts <vndb|bangumi>");
}

const pool = createDatabasePool();
try {
  await migrateDatabase(pool);
  const repository = new CatalogRepository(pool);
  const sync = new CatalogSyncService(pool);
  const sourceIds = await repository.listSourceIds(
    source,
    source === "bangumi",
  );
  const batchSize = source === "vndb" ? 100 : 20;
  let recordsSeen = 0;
  let recordsWritten = 0;

  const vndb =
    source === "vndb"
      ? new VndbClient(
          process.env.VNDB_API_BASE
            ? { baseUrl: process.env.VNDB_API_BASE }
            : {},
        )
      : null;
  const bangumi =
    source === "bangumi"
      ? new BangumiClient({
          userAgent: process.env.BANGUMI_USER_AGENT ?? "",
          ...(process.env.BANGUMI_ACCESS_TOKEN
            ? { accessToken: process.env.BANGUMI_ACCESS_TOKEN }
            : {}),
          ...(process.env.BANGUMI_API_BASE
            ? { baseUrl: process.env.BANGUMI_API_BASE }
            : {}),
        })
      : null;

  for (let offset = 0; offset < sourceIds.length; offset += batchSize) {
    const ids = sourceIds.slice(offset, offset + batchSize);
    const summary = await sync.syncPage(
      source,
      `refresh:${offset + 1}-${offset + ids.length}/${sourceIds.length}`,
      () =>
        source === "vndb"
          ? vndb!.getVisualNovelsByIds(ids)
          : bangumi!.getGamesByIds(ids),
    );
    recordsSeen += summary.recordsSeen;
    recordsWritten += summary.recordsWritten;
    console.log(
      JSON.stringify({
        source,
        completed: offset + ids.length,
        total: sourceIds.length,
        recordsSeen,
        recordsWritten,
      }),
    );
  }
} finally {
  await pool.end();
}
