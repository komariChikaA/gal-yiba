import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  scoreSourceMatch,
  scoreWithNetworkTitles,
  type PagedResult,
  type SourceVisualNovel,
  type WebSearchProvider,
} from "@gal-yiba/data";
import type { BangumiClient } from "@gal-yiba/data";
import { NetworkMappingAligner } from "@gal-yiba/data";
import { CatalogRepository } from "../db/catalog-repository.js";

export interface SyncSummary {
  runId: string;
  source: SourceVisualNovel["source"];
  cursor: string | null;
  nextCursor: string | null;
  recordsSeen: number;
  recordsWritten: number;
}

export interface MappingRebuildSummary {
  recordsSeen: number;
  suggestionsWritten: number;
}

export class CatalogSyncService {
  private readonly repository: CatalogRepository;

  constructor(private readonly database: Pool) {
    this.repository = new CatalogRepository(database);
  }

  private async suggestBangumiMapping(
    record: SourceVisualNovel,
    options: {
      networkTitles?: string[];
      webSearchEvidence?: unknown;
    } = {},
  ): Promise<boolean> {
    const candidates = await this.repository.findCrossSourceCandidates(record);
    const useNetwork = options.networkTitles && options.networkTitles.length > 0;
    const scored = candidates
      .map((candidate) => {
        if (useNetwork) {
          const boosted = scoreWithNetworkTitles(
            candidate,
            record,
            options.networkTitles!,
          );
          return {
            candidate,
            score: {
              confidence: boosted.confidence,
              decision: boosted.decision,
              evidence: {
                ...boosted.baseEvidence,
                networkTitles: options.networkTitles,
                networkBoosted: true,
                baseConfidence: boosted.baseConfidence,
                ...(options.webSearchEvidence
                  ? { search: options.webSearchEvidence }
                  : {}),
              },
            },
          };
        }
        return {
          candidate,
          score: scoreSourceMatch(candidate, record),
        };
      })
      .filter((item) => item.score.decision !== "unlikely")
      .sort((left, right) => right.score.confidence - left.score.confidence);
    const best = scored[0];
    const second = scored[1];
    if (!best || (second && best.score.confidence <= second.score.confidence))
      return false;
    const canonicalId = await this.repository.findCanonicalIdBySource(
      best.candidate.source,
      best.candidate.sourceId,
    );
    if (!canonicalId) return false;
    await this.repository.suggestLink(
      canonicalId,
      record,
      best.score.confidence,
      best.score.evidence,
    );
    return true;
  }

  async rebuildBangumiSuggestions(
    limit = 5_000,
    options: {
      withNetwork?: boolean;
      webSearch?: WebSearchProvider | null;
      bangumiClient?: BangumiClient | null;
    } = {},
  ): Promise<MappingRebuildSummary> {
    const records = await this.repository.listSourceRecordsForMapping(
      "bangumi",
      limit,
    );
    let suggestionsWritten = 0;
    const withNetwork = options.withNetwork && options.webSearch;
    for (const record of records) {
      // 尝试本地别名路径先行；若开启网络且本地未命中则尝试网络佐证提升
      const localOk = await this.suggestBangumiMapping(record);
      if (localOk) {
        suggestionsWritten += 1;
        continue;
      }
      if (withNetwork && options.bangumiClient) {
        // 将 bangumi 记录反向对齐到 VNDB 侧：找最匹配的 VNDB 候选
        const candidates = await this.repository.findCrossSourceCandidates(record);
        if (candidates.length === 0) continue;
        // 用网络标题提升二次打分（网络标题来自标题的外部搜索）
        let networkTitles: string[] = [];
        let searchEvidence: unknown = null;
        try {
          const queries = [
            `${record.title} bangumi`,
            `${record.alternativeTitles[0] ?? record.title} visual novel`,
          ];
          const results: import("@gal-yiba/data").WebSearchResult[] = [];
          for (const q of queries.slice(0, 2)) {
            try {
              const r = await options.webSearch!.search(q, { limit: 4 });
              results.push(...r);
            } catch {
              // ignore
            }
          }
          networkTitles = results.map((r) => r.title).filter(Boolean);
          searchEvidence = { queries, results: results.slice(0, 6) };
        } catch {
          // 回退
        }
        if (networkTitles.length > 0) {
          if (await this.suggestBangumiMapping(record, { networkTitles, webSearchEvidence: searchEvidence })) {
            suggestionsWritten += 1;
          }
        }
      }
    }
    return { recordsSeen: records.length, suggestionsWritten };
  }

  /**
   * 面向 VNDB 缺 Bangumi 的全量 backfill：网络搜索强制对齐
   * 与 cli/sync-bangumi-backfill.ts 复用同一 NetworkMappingAligner 逻辑
   */
  async backfillMissingBangumiWithNetwork(
    aligner: NetworkMappingAligner,
    limit = 100,
    offset = 0,
    verifyThreshold = 85,
  ): Promise<{ processed: number; linked: number; suggested: number; skipped: number }> {
    const batch = await this.repository.listCanonicalsMissingBangumi(limit, offset);
    let processed = 0;
    let linked = 0;
    let suggested = 0;
    let skipped = 0;
    for (const item of batch) {
      processed += 1;
      let result: import("@gal-yiba/data").NetworkAlignmentResult | null = null;
      try {
        result = await aligner.align(item.vndbRecord);
      } catch {
        result = null;
      }
      if (!result) {
        skipped += 1;
        continue;
      }
      const conflict = await this.repository.findCanonicalIdBySource(
        "bangumi",
        result.candidate.sourceId,
      );
      if (conflict && conflict !== item.canonicalId) {
        skipped += 1;
        continue;
      }
      if (result.confidence >= verifyThreshold) {
        try {
          // 需拉取详情补全动漫化等字段
          const detailed = result.candidate;
          await this.repository.attachBangumiVerified(
            item.canonicalId,
            detailed,
            result.confidence,
            result.evidence as unknown as object,
          );
          linked += 1;
        } catch {
          skipped += 1;
        }
      } else if (result.decision !== "unlikely") {
        await this.repository.upsertSourceRecord(result.candidate);
        await this.repository.suggestLink(
          item.canonicalId,
          result.candidate,
          result.confidence,
          result.evidence as unknown as object,
        );
        suggested += 1;
      } else {
        skipped += 1;
      }
    }
    return { processed, linked, suggested, skipped };
  }

  async syncPage(
    source: SourceVisualNovel["source"],
    cursor: string | null,
    load: () => Promise<PagedResult<SourceVisualNovel>>,
  ): Promise<SyncSummary> {
    const runId = randomUUID();
    await this.database.query(
      "INSERT INTO sync_runs(id, source, status, cursor) VALUES ($1, $2, 'running', $3)",
      [runId, source, cursor],
    );

    try {
      const page = await load();
      if (page.items.some((item) => item.source !== source)) {
        throw new Error("SYNC_SOURCE_MISMATCH");
      }
      let recordsWritten = 0;
      for (const record of page.items) {
        const outcome = await this.repository.upsertSourceRecord(record);
        if (outcome !== "unchanged") recordsWritten += 1;
        if (
          source === "vndb" &&
          (await this.repository.findCanonicalIdBySource(
            record.source,
            record.sourceId,
          )) == null
        ) {
          await this.repository.createCanonicalFromSource(record);
        }
        if (
          source === "bangumi" &&
          (await this.repository.findCanonicalIdBySource(
            record.source,
            record.sourceId,
          )) == null
        ) {
          await this.suggestBangumiMapping(record);
        }
      }
      await this.database.query(
        `UPDATE sync_runs SET
          status = 'succeeded', records_seen = $2, records_written = $3, finished_at = now()
         WHERE id = $1`,
        [runId, page.items.length, recordsWritten],
      );
      return {
        runId,
        source,
        cursor,
        nextCursor: page.nextCursor,
        recordsSeen: page.items.length,
        recordsWritten,
      };
    } catch (error) {
      const errorCode =
        error instanceof Error ? error.message.slice(0, 200) : "SYNC_FAILED";
      await this.database.query(
        "UPDATE sync_runs SET status = 'failed', error_code = $2, finished_at = now() WHERE id = $1",
        [runId, errorCode],
      );
      throw error;
    }
  }
}
