import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  scoreSourceMatch,
  type PagedResult,
  type SourceVisualNovel,
} from "@gal-yiba/data";
import { CatalogRepository } from "../db/catalog-repository.js";

export interface SyncSummary {
  runId: string;
  source: SourceVisualNovel["source"];
  cursor: string | null;
  nextCursor: string | null;
  recordsSeen: number;
  recordsWritten: number;
}

export class CatalogSyncService {
  private readonly repository: CatalogRepository;

  constructor(private readonly database: Pool) {
    this.repository = new CatalogRepository(database);
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
        if (source === "bangumi") {
          const candidates =
            await this.repository.findCrossSourceCandidates(record);
          const scored = candidates
            .map((candidate) => ({
              candidate,
              score: scoreSourceMatch(candidate, record),
            }))
            .filter((item) => item.score.decision !== "unlikely")
            .sort(
              (left, right) => right.score.confidence - left.score.confidence,
            );
          const best = scored[0];
          const second = scored[1];
          if (
            best &&
            (!second || best.score.confidence > second.score.confidence)
          ) {
            const canonicalId = await this.repository.findCanonicalIdBySource(
              best.candidate.source,
              best.candidate.sourceId,
            );
            if (canonicalId) {
              await this.repository.suggestLink(
                canonicalId,
                record,
                best.score.confidence,
                best.score.evidence,
              );
            }
          }
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
