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
    expect(result.rows).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
    ]);
  });

  it("backfills normalized alias keys for records created before migration 2", async () => {
    const legacy = sourceRecord({
      title: "Senren * Banka",
      alternativeTitles: ["千恋＊万花"],
    });
    await pool.query(
      `INSERT INTO source_records
        (source, source_id, title, normalized_title, release_date, normalized, raw, content_hash, fetched_at, title_keys, title_keys_version)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, 0)`,
      [
        legacy.source,
        legacy.sourceId,
        legacy.title,
        "senrenbanka",
        legacy.releaseDate,
        JSON.stringify(legacy),
        JSON.stringify(legacy.raw),
        "legacy-hash",
        legacy.fetchedAt,
        [],
      ],
    );
    await migrateDatabase(pool);
    const result = await pool.query<{
      title_keys: string[];
      title_keys_version: number;
    }>(
      "SELECT title_keys, title_keys_version FROM source_records WHERE source = $1 AND source_id = $2",
      [legacy.source, legacy.sourceId],
    );
    expect(result.rows[0]).toEqual({
      title_keys: ["senrenbanka", "千恋万花"],
      title_keys_version: 1,
    });
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
      developers: ["Key"],
      developerIds: ["p24"],
      publishers: ["VISUAL ARTS Co.,Ltd."],
      publisherIds: ["p993"],
      seriesIds: ["v17", "v13"],
      platforms: ["win", "and", "ios", "web", "ps4", "ps5", "swi"],
      tags: [
        { id: "g19", name: "Mystery", spoilerLevel: 0, score: 2.8 },
        { id: "g147", name: "Drama", spoilerLevel: 0, score: 2.5 },
        { id: "g105", name: "Science Fiction", spoilerLevel: 0, score: 2.2 },
        { id: "g96", name: "Romance", spoilerLevel: 0, score: 1.9 },
        { id: "g9999", name: "True Ending Twist", spoilerLevel: 2, score: 3 },
      ],
    });
    await repository.upsertSourceRecord(vndb);
    const canonicalId = await repository.createCanonicalFromSource(vndb);
    const catalog = await repository.listVisualNovels();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: canonicalId,
      title: "Ever17",
      developer: ["Key"],
      developerFamilyIds: ["visual-arts"],
      publisher: ["VISUAL ARTS Co.,Ltd."],
      seriesIds: ["vndb:v17", "vndb:v13"],
      scenarioWriter: ["Writer"],
      heroineHairColor: ["brown", "blue"],
      releaseYear: 2002,
      playtime: "long",
      vndbRating: 8.2,
      bangumiRating: null,
      vndbVoteCount: 3000,
      bangumiVoteCount: null,
      ageRating: "all_ages",
      platforms: ["PC", "PlayStation", "Nintendo Switch"],
      tags: ["悬疑", "剧情", "科幻"],
      tagDetails: [
        { id: "g9999", name: "True Ending Twist", spoilerLevel: 2, score: 3 },
        { id: "g19", name: "Mystery", spoilerLevel: 0, score: 2.8 },
        { id: "g147", name: "Drama", spoilerLevel: 0, score: 2.5 },
        { id: "g105", name: "Science Fiction", spoilerLevel: 0, score: 2.2 },
        { id: "g96", name: "Romance", spoilerLevel: 0, score: 1.9 },
      ],
    });
  });

  it("lists canonicals still missing a verified Bangumi link", async () => {
    const vndbA = sourceRecord({ sourceId: "v1", title: "Alpha" });
    const vndbB = sourceRecord({ sourceId: "v2", title: "Beta" });
    await repository.upsertSourceRecord(vndbA);
    await repository.upsertSourceRecord(vndbB);
    const idA = await repository.createCanonicalFromSource(vndbA);
    const idB = await repository.createCanonicalFromSource(vndbB);
    // B 已有 verified bangumi 链接
    const bangumiB = sourceRecord({
      source: "bangumi",
      sourceId: "2",
      title: "Beta",
    });
    await repository.attachBangumiVerified(idB, bangumiB, 90, {
      exactTitle: true,
    });

    const missing = await repository.listCanonicalsMissingBangumi(10, 0);
    expect(missing.map((item) => item.canonicalId)).toEqual([idA]);
    expect(missing[0]?.vndbRecord.title).toBe("Alpha");
  });

  it("attaches verified Bangumi data that merges into the catalog", async () => {
    const vndb = sourceRecord();
    await repository.upsertSourceRecord(vndb);
    const canonicalId = await repository.createCanonicalFromSource(vndb);
    const bangumi = sourceRecord({
      source: "bangumi",
      sourceId: "123",
      title: "Ever17 时空轮回",
      alternativeTitles: ["Ever17"],
      rating: 8.4,
      voteCount: 1200,
      releaseDate: "2002-08-29",
    });
    await repository.attachBangumiVerified(canonicalId, bangumi, 95, {
      exactTitle: true,
      releaseYearDelta: 0,
    });

    const catalog = await repository.listVisualNovels();
    expect(catalog[0]).toMatchObject({
      bangumiRating: 8.4,
      bangumiVoteCount: 1200,
    });
    expect(catalog[0]?.aliases).toContain("Ever17 时空轮回");
    const missing = await repository.listCanonicalsMissingBangumi(10, 0);
    expect(missing).toEqual([]);
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
