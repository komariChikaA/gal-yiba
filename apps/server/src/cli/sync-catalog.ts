import "dotenv/config";
import { BangumiClient, VndbClient } from "@gal-yiba/data";
import { createDatabasePool, migrateDatabase } from "../db/index.js";
import { CatalogSyncService } from "../services/catalog-sync.js";

function argument(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((item) => item.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

const source = process.argv[2];
if (source !== "vndb" && source !== "bangumi") {
  throw new Error(
    "Usage: sync-catalog.ts <vndb|bangumi> [--page=1] [--keyword=title]",
  );
}

const pool = createDatabasePool();
try {
  await migrateDatabase(pool);
  const sync = new CatalogSyncService(pool);

  if (source === "vndb") {
    const page = Number(argument("page", "1"));
    if (!Number.isInteger(page) || page < 1) throw new Error("INVALID_PAGE");
    const client = new VndbClient(
      process.env.VNDB_API_BASE ? { baseUrl: process.env.VNDB_API_BASE } : {},
    );
    const summary = await sync.syncPage("vndb", String(page), () =>
      client.listVisualNovels(page),
    );
    console.log(JSON.stringify(summary));
  } else {
    const keyword = argument("keyword");
    if (!keyword) throw new Error("BANGUMI_KEYWORD_REQUIRED");
    const offset = Number(argument("offset", "0"));
    const userAgent = process.env.BANGUMI_USER_AGENT;
    if (!userAgent) throw new Error("BANGUMI_USER_AGENT_REQUIRED");
    const client = new BangumiClient({
      userAgent,
      ...(process.env.BANGUMI_ACCESS_TOKEN
        ? { accessToken: process.env.BANGUMI_ACCESS_TOKEN }
        : {}),
      ...(process.env.BANGUMI_API_BASE
        ? { baseUrl: process.env.BANGUMI_API_BASE }
        : {}),
    });
    const summary = await sync.syncPage("bangumi", String(offset), () =>
      client.searchGames(keyword, offset),
    );
    console.log(JSON.stringify(summary));
  }
} finally {
  await pool.end();
}
