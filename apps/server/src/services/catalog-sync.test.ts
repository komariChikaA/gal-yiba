import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PagedResult, SourceVisualNovel } from "@gal-yiba/data";
import { CatalogRepository } from "../db/catalog-repository.js";
import { migrateDatabase } from "../db/migrate.js";
import { CatalogSyncService } from "./catalog-sync.js";

let pool: Pool;
let service: CatalogSyncService;

function record(
  source: SourceVisualNovel["source"] = "vndb",
  overrides: Partial<SourceVisualNovel> = {},
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
    ...overrides,
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

  it("does not demote an existing verified Bangumi link during refresh", async () => {
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
    const repository = new CatalogRepository(pool);
    await repository.reviewMappingSuggestion("bangumi", "1", "verified");

    await service.syncPage("bangumi", "refresh", async () => ({
      items: [record("bangumi", { rating: 8.2 })],
      hasMore: false,
      nextCursor: null,
    }));

    const link = await pool.query<{ link_status: string }>(
      "SELECT link_status FROM source_links WHERE source = 'bangumi'",
    );
    expect(link.rows).toEqual([{ link_status: "verified" }]);
  });

  it("finds a cross-source candidate through a normalized alternative title", async () => {
    await service.syncPage("vndb", "1", async () => ({
      items: [
        record("vndb", {
          title: "Senren * Banka",
          alternativeTitles: ["千恋＊万花"],
          releaseDate: "2016-07-29",
        }),
      ],
      hasMore: false,
      nextCursor: null,
    }));
    await service.syncPage("bangumi", "0", async () => ({
      items: [
        record("bangumi", {
          title: "千恋万花",
          alternativeTitles: ["Senren＊Banka"],
          releaseDate: "2016-07-29",
        }),
      ],
      hasMore: false,
      nextCursor: null,
    }));
    const link = await pool.query<{
      link_status: string;
      confidence: number;
      evidence: { exactTitle: boolean; titleOverlap: string[] };
    }>(
      "SELECT link_status, confidence, evidence FROM source_links WHERE source = 'bangumi'",
    );
    expect(link.rows[0]).toMatchObject({
      link_status: "suggested",
      confidence: 100,
      evidence: {
        exactTitle: true,
        titleOverlap: ["senrenbanka", "千恋万花"],
      },
    });
  });

  it("rebuilds suggestions for existing unlinked Bangumi records", async () => {
    await service.syncPage("vndb", "1", async () => ({
      items: [record("vndb")],
      hasMore: false,
      nextCursor: null,
    }));
    await new CatalogRepository(pool).upsertSourceRecord(record("bangumi"));

    await expect(service.rebuildBangumiSuggestions()).resolves.toEqual({
      recordsSeen: 1,
      suggestionsWritten: 1,
    });
    const result = await pool.query<{ link_status: string }>(
      "SELECT link_status FROM source_links WHERE source = 'bangumi'",
    );
    expect(result.rows).toEqual([{ link_status: "suggested" }]);
  });
});
