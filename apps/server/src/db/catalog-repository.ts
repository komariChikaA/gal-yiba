import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { SourceVisualNovel } from "@gal-yiba/data";
import { normalizeTitle } from "@gal-yiba/data";
import {
  normalizeComparisonPlatforms,
  selectImportantTags,
  type Playtime,
  type Provenance,
  type VisualNovel,
  type VisualNovelTag,
} from "@gal-yiba/shared";

const curatedVndbProducerFamily = new Map([
  ["p24", "visual-arts"],
  ["p993", "visual-arts"],
  ["p98", "yuzusoft"],
  ["p12215", "yuzusoft"],
]);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sourceRecordHash(record: SourceVisualNovel): string {
  const { fetchedAt: _fetchedAt, ...hashable } = record;
  return createHash("sha256").update(stableJson(hashable)).digest("hex");
}

export function sourceRecordTitleKeys(record: SourceVisualNovel): string[] {
  return [
    ...new Set(
      [record.title, ...record.alternativeTitles]
        .map(normalizeTitle)
        .filter(Boolean),
    ),
  ];
}

export interface MappingSuggestion {
  canonicalId: string;
  canonicalTitle: string;
  source: SourceVisualNovel["source"];
  sourceId: string;
  sourceTitle: string;
  confidence: number;
  evidence: Record<string, unknown>;
}

export class CatalogRepository {
  constructor(private readonly database: Pool) {}

  async upsertSourceRecord(
    record: SourceVisualNovel,
  ): Promise<"inserted" | "updated" | "unchanged"> {
    const contentHash = sourceRecordHash(record);
    const existing = await this.database.query<{ content_hash: string }>(
      "SELECT content_hash FROM source_records WHERE source = $1 AND source_id = $2",
      [record.source, record.sourceId],
    );
    if (existing.rows[0]?.content_hash === contentHash) return "unchanged";

    await this.database.query(
      `INSERT INTO source_records
        (source, source_id, title, normalized_title, title_keys, title_keys_version, release_date, normalized, raw, content_hash, fetched_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7::jsonb, $8::jsonb, $9, $10)
       ON CONFLICT (source, source_id) DO UPDATE SET
         title = EXCLUDED.title,
         normalized_title = EXCLUDED.normalized_title,
         title_keys = EXCLUDED.title_keys,
         title_keys_version = EXCLUDED.title_keys_version,
         release_date = EXCLUDED.release_date,
         normalized = EXCLUDED.normalized,
         raw = EXCLUDED.raw,
         content_hash = EXCLUDED.content_hash,
         fetched_at = EXCLUDED.fetched_at,
         updated_at = now()`,
      [
        record.source,
        record.sourceId,
        record.title,
        normalizeTitle(record.title),
        sourceRecordTitleKeys(record),
        record.releaseDate,
        JSON.stringify(record),
        JSON.stringify(record.raw),
        contentHash,
        record.fetchedAt,
      ],
    );
    return existing.rowCount === 0 ? "inserted" : "updated";
  }

  async createCanonicalFromSource(record: SourceVisualNovel): Promise<string> {
    const canonicalId = randomUUID();
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO canonical_visual_novels(id, display_title) VALUES ($1, $2)",
        [canonicalId, record.title],
      );
      await client.query(
        `INSERT INTO source_links
          (canonical_id, source, source_id, confidence, link_status, evidence)
         VALUES ($1, $2, $3, 100, 'verified', $4::jsonb)`,
        [
          canonicalId,
          record.source,
          record.sourceId,
          JSON.stringify({ origin: "canonical_seed" }),
        ],
      );
      await client.query("COMMIT");
      return canonicalId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findCanonicalIdBySource(
    source: SourceVisualNovel["source"],
    sourceId: string,
  ): Promise<string | null> {
    const result = await this.database.query<{ canonical_id: string }>(
      "SELECT canonical_id FROM source_links WHERE source = $1 AND source_id = $2 AND link_status <> 'rejected'",
      [source, sourceId],
    );
    return result.rows[0]?.canonical_id ?? null;
  }

  async findCrossSourceCandidates(
    record: SourceVisualNovel,
  ): Promise<SourceVisualNovel[]> {
    const keys = sourceRecordTitleKeys(record);
    if (keys.length === 0) return [];
    const result = await this.database.query<{ normalized: SourceVisualNovel }>(
      `SELECT normalized FROM source_records
       WHERE source <> $1 AND title_keys && $2::text[]
       LIMIT 100`,
      [record.source, keys],
    );
    return result.rows.map((row) => row.normalized);
  }

  async listSourceRecordsForMapping(
    source: SourceVisualNovel["source"],
    limit = 5_000,
  ): Promise<SourceVisualNovel[]> {
    const result = await this.database.query<{
      normalized: SourceVisualNovel;
    }>(
      `SELECT sr.normalized
       FROM source_records sr
       LEFT JOIN source_links sl
         ON sl.source = sr.source AND sl.source_id = sr.source_id
       WHERE sr.source = $1
         AND (sl.source_id IS NULL OR sl.link_status = 'suggested')
       ORDER BY sr.updated_at ASC, sr.source_id ASC
       LIMIT $2`,
      [source, Math.max(1, Math.min(20_000, limit))],
    );
    return result.rows.map((row) => row.normalized);
  }

  async listSourceIds(
    source: SourceVisualNovel["source"],
    linkedOnly = false,
  ): Promise<string[]> {
    const result = await this.database.query<{ source_id: string }>(
      linkedOnly
        ? `SELECT sr.source_id
           FROM source_records sr
           WHERE sr.source = $1
             AND EXISTS (
               SELECT 1 FROM source_links sl
               WHERE sl.source = sr.source
                 AND sl.source_id = sr.source_id
                 AND sl.link_status = 'verified'
             )
           ORDER BY sr.source_id ASC`
        : `SELECT source_id
           FROM source_records
           WHERE source = $1
           ORDER BY source_id ASC`,
      [source],
    );
    return result.rows.map((row) => row.source_id);
  }

  async suggestLink(
    canonicalId: string,
    record: SourceVisualNovel,
    confidence: number,
    evidence: object,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO source_links
        (canonical_id, source, source_id, confidence, link_status, evidence)
       VALUES ($1, $2, $3, $4, 'suggested', $5::jsonb)
       ON CONFLICT (source, source_id) DO UPDATE SET
         canonical_id = EXCLUDED.canonical_id,
         confidence = EXCLUDED.confidence,
         link_status = 'suggested',
         evidence = EXCLUDED.evidence`,
      [
        canonicalId,
        record.source,
        record.sourceId,
        confidence,
        JSON.stringify(evidence),
      ],
    );
  }

  async listMappingSuggestions(limit = 100): Promise<MappingSuggestion[]> {
    const result = await this.database.query<{
      canonical_id: string;
      canonical_title: string;
      source: SourceVisualNovel["source"];
      source_id: string;
      source_title: string;
      confidence: number;
      evidence: Record<string, unknown>;
    }>(
      `SELECT
        sl.canonical_id,
        c.display_title AS canonical_title,
        sl.source,
        sl.source_id,
        sr.title AS source_title,
        sl.confidence,
        sl.evidence
       FROM source_links sl
       JOIN canonical_visual_novels c ON c.id = sl.canonical_id
       JOIN source_records sr ON sr.source = sl.source AND sr.source_id = sl.source_id
       WHERE sl.link_status = 'suggested'
       ORDER BY sl.confidence DESC, c.display_title ASC
       LIMIT $1`,
      [Math.max(1, Math.min(1_000, limit))],
    );
    return result.rows.map((row) => ({
      canonicalId: row.canonical_id,
      canonicalTitle: row.canonical_title,
      source: row.source,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      confidence: row.confidence,
      evidence: row.evidence,
    }));
  }

  async reviewMappingSuggestion(
    source: SourceVisualNovel["source"],
    sourceId: string,
    decision: "verified" | "rejected",
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE source_links SET link_status = $3, reviewed_at = now()
       WHERE source = $1 AND source_id = $2 AND link_status = 'suggested'`,
      [source, sourceId, decision],
    );
    if (result.rowCount !== 1) throw new Error("MAPPING_SUGGESTION_NOT_FOUND");
  }

  async listVisualNovels(limit = 5_000): Promise<VisualNovel[]> {
    const result = await this.database.query<{
      canonical_id: string;
      display_title: string;
      source: SourceVisualNovel["source"];
      source_id: string;
      normalized: SourceVisualNovel;
    }>(
      `SELECT
        c.id AS canonical_id,
        c.display_title,
        sr.source,
        sr.source_id,
        sr.normalized
       FROM canonical_visual_novels c
       JOIN source_links sl ON sl.canonical_id = c.id AND sl.link_status = 'verified'
       JOIN source_records sr ON sr.source = sl.source AND sr.source_id = sl.source_id
       WHERE c.enabled = true AND c.review_status <> 'rejected'
       ORDER BY c.created_at ASC, CASE WHEN sr.source = 'vndb' THEN 0 ELSE 1 END
       LIMIT $1`,
      [Math.max(1, Math.min(20_000, limit))],
    );

    const grouped = new Map<
      string,
      {
        displayTitle: string;
        records: Array<{ record: SourceVisualNovel; sourceId: string }>;
      }
    >();
    for (const row of result.rows) {
      const group = grouped.get(row.canonical_id) ?? {
        displayTitle: row.display_title,
        records: [],
      };
      group.records.push({ record: row.normalized, sourceId: row.source_id });
      grouped.set(row.canonical_id, group);
    }

    return [...grouped].map(([id, group]) =>
      this.toVisualNovel(id, group.displayTitle, group.records),
    );
  }

  private toVisualNovel(
    id: string,
    displayTitle: string,
    linked: Array<{ record: SourceVisualNovel; sourceId: string }>,
  ): VisualNovel {
    const records = linked.map((item) => item.record);
    const primary =
      records.find((record) => record.source === "vndb") ?? records[0];
    if (!primary) throw new Error("CANONICAL_WITHOUT_SOURCE");
    const vndbRecord = records.find((record) => record.source === "vndb");
    const bangumiRecord = records.find((record) => record.source === "bangumi");
    const releaseYearMatch = primary.releaseDate?.match(/^(\d{4})/);
    const playtimeMap: Record<number, Playtime> = {
      1: "very_short",
      2: "short",
      3: "medium",
      4: "long",
      5: "very_long",
    };
    const provenance = (
      sourceId: string,
      record: SourceVisualNovel,
    ): Provenance => ({
      source: record.source,
      sourceId,
      syncedAt: record.fetchedAt,
    });
    const provenanceFor = linked.map(({ record, sourceId }) =>
      provenance(sourceId, record),
    );
    const provenanceForSource = (source: SourceVisualNovel["source"]) =>
      linked
        .filter(({ record }) => record.source === source)
        .map(({ record, sourceId }) => provenance(sourceId, record));
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
    const nullableUnique = (values: string[]): string[] | null => {
      const items = unique(values);
      return items.length > 0 ? items : null;
    };
    const tagSource = vndbRecord ?? bangumiRecord ?? primary;
    const tagDetailsByName = new Map<string, VisualNovelTag>();
    for (const tag of tagSource.tags) {
      const key = normalizeTitle(tag.name);
      if (!key) continue;
      const existing = tagDetailsByName.get(key);
      if (existing && (existing.score ?? 0) > (tag.score ?? 0)) continue;
      const detail: VisualNovelTag = {
        name: tag.name,
        spoilerLevel: tag.spoilerLevel ?? 0,
      };
      if (tag.score != null) detail.score = tag.score;
      if (tag.category) detail.category = tag.category;
      tagDetailsByName.set(key, detail);
    }
    const tagDetails = [...tagDetailsByName.values()].sort(
      (left, right) =>
        (right.score ?? 0) - (left.score ?? 0) ||
        left.name.localeCompare(right.name),
    );
    const defaultTags = selectImportantTags(tagDetails, [], 0);
    const sourceAgeRating =
      vndbRecord?.ageRating ?? bangumiRecord?.ageRating ?? "unknown";
    const sourceAnimeAdaptation =
      bangumiRecord?.animeAdaptation === "announced"
        ? "announced"
        : vndbRecord?.animeAdaptation === "has_adaptation" ||
            bangumiRecord?.animeAdaptation === "has_adaptation"
          ? "has_adaptation"
          : vndbRecord?.animeAdaptation === "none" ||
              bangumiRecord?.animeAdaptation === "none"
            ? "none"
            : "unknown";
    const animeAdaptationSource =
      bangumiRecord?.animeAdaptation === "announced"
        ? "bangumi"
        : vndbRecord?.animeAdaptation === "has_adaptation"
          ? "vndb"
          : bangumiRecord?.animeAdaptation === "has_adaptation"
            ? "bangumi"
            : vndbRecord?.animeAdaptation === "none"
              ? "vndb"
              : bangumiRecord?.animeAdaptation === "none"
                ? "bangumi"
                : null;
    const developerFamilyIds = unique(
      records.flatMap((record) => [
        ...(record.developerFamilyIds ?? []),
        ...(record.source === "vndb"
          ? (record.developerIds ?? [])
              .map((producerId) => curatedVndbProducerFamily.get(producerId))
              .filter((familyId): familyId is string => familyId != null)
          : []),
      ]),
    );
    const seriesIds = unique(
      records.flatMap((record) =>
        (record.seriesIds ?? []).map(
          (sourceSeriesId) => `${record.source}:${sourceSeriesId}`,
        ),
      ),
    );

    return {
      id,
      title: displayTitle,
      aliases: unique(
        records.flatMap((record) => [
          record.title,
          ...record.alternativeTitles,
        ]),
      ).filter((title) => title !== displayTitle),
      developer: nullableUnique(records.flatMap((record) => record.developers)),
      publisher: nullableUnique(
        records.flatMap((record) => record.publishers ?? []),
      ),
      scenarioWriter: nullableUnique(
        records.flatMap((record) => record.scenarioWriters),
      ),
      heroineHairColor: vndbRecord?.heroineHairColors?.length
        ? vndbRecord.heroineHairColors
        : null,
      releaseYear: releaseYearMatch ? Number(releaseYearMatch[1]) : null,
      playtime:
        primary.playtime == null
          ? null
          : (playtimeMap[primary.playtime] ?? null),
      vndbRating: vndbRecord?.rating ?? null,
      bangumiRating: bangumiRecord?.rating ?? null,
      vndbVoteCount: vndbRecord?.voteCount ?? null,
      bangumiVoteCount: bangumiRecord?.voteCount ?? null,
      animeAdaptation:
        sourceAnimeAdaptation === "none" ||
        sourceAnimeAdaptation === "announced" ||
        sourceAnimeAdaptation === "has_adaptation"
          ? sourceAnimeAdaptation
          : null,
      ageRating:
        sourceAgeRating === "all_ages" || sourceAgeRating === "restricted"
          ? sourceAgeRating
          : null,
      platforms: normalizeComparisonPlatforms(
        records.flatMap((record) => record.platforms),
      ),
      languages: unique(records.flatMap((record) => record.languages)),
      tags: defaultTags.map((tag) => tag.name),
      tagDetails,
      seriesIds: seriesIds.length > 0 ? seriesIds : null,
      developerFamilyIds:
        developerFamilyIds.length > 0 ? developerFamilyIds : null,
      provenance: {
        title: provenanceFor,
        developer: provenanceFor,
        publisher: provenanceFor,
        scenarioWriter: provenanceFor,
        releaseYear: provenanceFor,
        playtime: provenanceFor,
        heroineHairColor: vndbRecord?.heroineHairColors?.length
          ? provenanceForSource("vndb")
          : [],
        vndbRating: provenanceForSource("vndb"),
        bangumiRating: provenanceForSource("bangumi"),
        vndbVoteCount: provenanceForSource("vndb"),
        bangumiVoteCount: provenanceForSource("bangumi"),
        animeAdaptation:
          sourceAnimeAdaptation === "unknown" || animeAdaptationSource == null
            ? []
            : provenanceForSource(animeAdaptationSource),
        ageRating:
          sourceAgeRating === "unknown"
            ? []
            : provenanceForSource(vndbRecord ? "vndb" : "bangumi"),
        platforms: provenanceFor,
        languages: provenanceFor,
        tags: provenanceForSource(tagSource.source),
      },
    };
  }
}
