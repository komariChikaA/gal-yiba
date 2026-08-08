import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PagedResult, SourceVisualNovel } from "@gal-yiba/data";
import { migrateDatabase } from "../db/migrate.js";
import { CatalogSyncService } from "./catalog-sync.js";

let pool: Pool;
let service: CatalogSyncService;

function record(
  source: SourceVisualNovel["source"] = "vndb",
): SourceVisualNovel {
  return {
    source,
    sourceId: source === "vndb" ? "v1" : "1",
    title: "测试作品",
    alternativeTitles: [],
    releaseDate: "2020-01-01",
    developers: ["测试会社"],
    scenarioWriters: [],
    playtime: 3,
    platforms: ["PC"],
    languages: ["ja"],
    rating: 8,
    voteCount: 100,
    popularity: 10,
    tags: [],
    raw: {},
    fetchedAt: "2026-08-08T00:00:00.000Z",
  };
}

beforeEach(async () => {
  const memoryDatabase = newDb({ noAstCoverageCheck: true });
  const adapter = memoryDatabase.adapters.createPg();
  pool = new adapter.Pool() as Pool;
  await migrateDatabase(pool);
  service = new CatalogSyncService(pool);
});

afterEach(async () => {
  await pool.end();
});

describe("CatalogSyncService", () => {
  it("persists records and a successful resumable run", async () => {
    const page: PagedResult<SourceVisualNovel> = {
      items: [record()],
      hasMore: true,
      nextCursor: "2",
    };
    const summary = await service.syncPage("vndb", "1", async () => page);
    expect(summary).toMatchObject({
      recordsSeen: 1,
      recordsWritten: 1,
      nextCursor: "2",
    });
    const run = await pool.query<{ status: string; records_seen: number }>(
      "SELECT status, records_seen FROM sync_runs WHERE id = $1",
      [summary.runId],
    );
    expect(run.rows[0]).toEqual({ status: "succeeded", records_seen: 1 });
    const canonical = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM canonical_visual_novels",
    );
    expect(canonical.rows[0]?.count).toBe("1");
  });

  it("records failures without swallowing the original error", async () => {
    await expect(
      service.syncPage("bangumi", null, async () => {
        throw new Error("UPSTREAM_UNAVAILABLE");
      }),
    ).rejects.toThrow("UPSTREAM_UNAVAILABLE");
    const run = await pool.query<{ status: string; error_code: string }>(
      "SELECT status, error_code FROM sync_runs",
    );
    expect(run.rows[0]).toEqual({
      status: "failed",
      error_code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("rejects a loader returning records from the wrong source", async () => {
    await expect(
      service.syncPage("vndb", null, async () => ({
        items: [record("bangumi")],
        hasMore: false,
        nextCursor: null,
      })),
    ).rejects.toThrow("SYNC_SOURCE_MISMATCH");
  });

  it("stores a unique Bangumi match as a review suggestion, not a verified link", async () => {
    await service.syncPage("vndb", "1", async () => ({
      items: [record("vndb")],
      hasMore: false,
      nextCursor: null,
    }));
    await service.syncPage("bangumi", "0", async () => ({
      items: [record("bangumi")],
      hasMore: false,
      nextCursor: null,
    }));
    const link = await pool.query<{ link_status: string; confidence: number }>(
      "SELECT link_status, confidence FROM source_links WHERE source = 'bangumi'",
    );
    expect(link.rows[0]).toEqual({ link_status: "suggested", confidence: 100 });
  });
});
