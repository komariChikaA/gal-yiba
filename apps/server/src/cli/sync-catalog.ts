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
    "Usage: sync-catalog.ts <vndb|bangumi> [--page=1] [--keyword=title] [--developer=name] [--sort=id|released|rating|votecount] [--reverse=true|false]",
  );
}

const pool = createDatabasePool();
try {
  await migrateDatabase(pool);
  const sync = new CatalogSyncService(pool);

  if (source === "vndb") {
    const page = Number(argument("page", "1"));
    if (!Number.isInteger(page) || page < 1) throw new Error("INVALID_PAGE");
    const keyword = argument("keyword")?.trim();
    const developer = argument("developer")?.trim();
    if (keyword && developer)
      throw new Error("VNDB_FILTERS_MUTUALLY_EXCLUSIVE");
    const sort = argument("sort", "id");
    if (!sort || !["id", "released", "rating", "votecount"].includes(sort))
      throw new Error("INVALID_VNDB_SORT");
    const reverseInput = argument("reverse", "false");
    if (reverseInput !== "true" && reverseInput !== "false")
      throw new Error("INVALID_REVERSE");
    const reverse = reverseInput === "true";
    const client = new VndbClient(
      process.env.VNDB_API_BASE ? { baseUrl: process.env.VNDB_API_BASE } : {},
    );
    const cursor = developer
      ? `developer:${developer}:${page}`
      : keyword
        ? `search:${keyword}:${page}`
        : `${sort}:${reverse ? "desc" : "asc"}:${page}`;
    const summary = await sync.syncPage("vndb", cursor, () => {
      if (developer) return client.listVisualNovelsByDeveloper(developer, page);
      if (keyword) return client.searchVisualNovels(keyword, page);
      return client.listVisualNovels(page, 100, {
        sort: sort as "id" | "released" | "rating" | "votecount",
        reverse,
      });
    });
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
