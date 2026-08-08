import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { SourceVisualNovel } from "@gal-yiba/data";
import { CatalogRepository, sourceRecordHash } from "./catalog-repository.js";
import { migrateDatabase } from "./migrate.js";

let pool: Pool;
let repository: CatalogRepository;

function sourceRecord(
  overrides: Partial<SourceVisualNovel> = {},
): SourceVisualNovel {
  return {
    source: "vndb",
    sourceId: "v17",
    title: "Ever17",
    alternativeTitles: ["Ever17 -the out of infinity-"],
    releaseDate: "2002-08-29",
    developers: ["KID"],
    scenarioWriters: ["Writer"],
    playtime: 4,
    platforms: ["win"],
    languages: ["ja"],
    rating: 8.2,
    voteCount: 3000,
    popularity: 12.5,
    heroineHairColors: ["brown", "blue"],
    ageRating: "all_ages",
    tags: [{ id: "g7", name: "Science Fiction", spoilerLevel: 0 }],
    raw: { id: "v17" },
    fetchedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(async () => {
  const memoryDatabase = newDb({ noAstCoverageCheck: true });
  const adapter = memoryDatabase.adapters.createPg();
  pool = new adapter.Pool() as Pool;
  await migrateDatabase(pool);
  repository = new CatalogRepository(pool);
});

afterEach(async () => {
  await pool.end();
});

describe("database migrations", () => {
  it("is idempotent", async () => {
    await migrateDatabase(pool);
    const result = await pool.query<{ version: number }>(
      "SELECT version FROM schema_migrations",
    );
    expect(result.rows).toEqual([{ version: 1 }]);
  });
});

describe("CatalogRepository", () => {
  it("inserts, skips unchanged data, and updates changed source data", async () => {
    const record = sourceRecord();
    await expect(repository.upsertSourceRecord(record)).resolves.toBe(
      "inserted",
    );
    await expect(
      repository.upsertSourceRecord({
        ...record,
        fetchedAt: "2026-08-09T00:00:00.000Z",
      }),
    ).resolves.toBe("unchanged");
    await expect(
      repository.upsertSourceRecord({ ...record, rating: 8.3 }),
    ).resolves.toBe("updated");
  });

  it("creates a canonical record and verified source link atomically", async () => {
    const record = sourceRecord();
    await repository.upsertSourceRecord(record);
    const canonicalId = await repository.createCanonicalFromSource(record);
    expect(canonicalId).toMatch(/^[0-9a-f-]{36}$/);
    const link = await pool.query<{ link_status: string; confidence: number }>(
      "SELECT link_status, confidence FROM source_links WHERE canonical_id = $1",
      [canonicalId],
    );
    expect(link.rows[0]).toEqual({ link_status: "verified", confidence: 100 });
  });

  it("stores a cross-source link as a suggestion instead of silently verifying it", async () => {
    const vndb = sourceRecord();
    const bangumi = sourceRecord({
      source: "bangumi",
      sourceId: "123",
      rating: 7.7,
      voteCount: 800,
    });
    await repository.upsertSourceRecord(vndb);
    await repository.upsertSourceRecord(bangumi);
    const canonicalId = await repository.createCanonicalFromSource(vndb);
    await repository.suggestLink(canonicalId, bangumi, 90, {
      exactTitle: true,
    });
    const link = await pool.query<{ link_status: string; confidence: number }>(
      "SELECT link_status, confidence FROM source_links WHERE source = 'bangumi' AND source_id = '123'",
    );
    expect(link.rows[0]).toEqual({ link_status: "suggested", confidence: 90 });

    await expect(repository.listMappingSuggestions()).resolves.toMatchObject([
      {
        canonicalId,
        canonicalTitle: "Ever17",
        source: "bangumi",
        sourceId: "123",
        sourceTitle: "Ever17",
        confidence: 90,
        evidence: { exactTitle: true },
      },
    ]);
    await repository.reviewMappingSuggestion("bangumi", "123", "verified");
    await expect(repository.listMappingSuggestions()).resolves.toEqual([]);
    const catalog = await repository.listVisualNovels();
    expect(catalog[0]).toMatchObject({
      vndbRating: 8.2,
      bangumiRating: 7.7,
      vndbVoteCount: 3000,
      bangumiVoteCount: 800,
    });
  });

  it("rejects only an existing pending mapping suggestion", async () => {
    await expect(
      repository.reviewMappingSuggestion("bangumi", "missing", "rejected"),
    ).rejects.toThrow("MAPPING_SUGGESTION_NOT_FOUND");
  });

  it("builds a playable catalog only from verified links and preserves spoiler metadata", async () => {
    const vndb = sourceRecord({
      tags: [
        { id: "g1", name: "Mystery", spoilerLevel: 0 },
        { id: "g2", name: "True Ending Twist", spoilerLevel: 2 },
      ],
    });
    await repository.upsertSourceRecord(vndb);
    const canonicalId = await repository.createCanonicalFromSource(vndb);
    const catalog = await repository.listVisualNovels();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: canonicalId,
      title: "Ever17",
      developer: ["KID"],
      scenarioWriter: ["Writer"],
      heroineHairColor: ["brown", "blue"],
      releaseYear: 2002,
      playtime: "long",
      vndbRating: 8.2,
      bangumiRating: null,
      vndbVoteCount: 3000,
      bangumiVoteCount: null,
      ageRating: "all_ages",
      tags: ["Mystery", "True Ending Twist"],
      tagDetails: [
        { name: "Mystery", spoilerLevel: 0 },
        { name: "True Ending Twist", spoilerLevel: 2 },
      ],
    });
  });
});

describe("sourceRecordHash", () => {
  it("ignores fetch time but changes when normalized data changes", () => {
    const original = sourceRecord();
    expect(sourceRecordHash(original)).toBe(
      sourceRecordHash({ ...original, fetchedAt: "2027-01-01T00:00:00.000Z" }),
    );
    expect(sourceRecordHash(original)).not.toBe(
      sourceRecordHash({ ...original, rating: 9 }),
    );
  });
});
