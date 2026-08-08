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
  throw new Error(
    "Usage: refresh-catalog.ts <vndb|bangumi> [--offset=0] [--pause-ms=3000]",
  );
}

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((item) => item.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

const offsetInput = Number(argument("offset", "0"));
const pauseInput = Number(
  argument("pause-ms", source === "vndb" ? "3000" : "0"),
);
if (!Number.isInteger(offsetInput) || offsetInput < 0)
  throw new Error("INVALID_REFRESH_OFFSET");
if (!Number.isInteger(pauseInput) || pauseInput < 0 || pauseInput > 60_000)
  throw new Error("INVALID_REFRESH_PAUSE");

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  const startOffset = Math.min(offsetInput, sourceIds.length);
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

  for (
    let offset = startOffset;
    offset < sourceIds.length;
    offset += batchSize
  ) {
    if (offset > startOffset && pauseInput > 0) await pause(pauseInput);
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
