import "dotenv/config";
import {
  BangumiClient,
  scoreSourceMatch,
  type SourceVisualNovel,
} from "@gal-yiba/data";
import { CatalogRepository, createDatabasePool, migrateDatabase } from "../db/index.js";

function argument(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((item) => item.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

const userAgent = process.env.BANGUMI_USER_AGENT;
if (!userAgent) throw new Error("BANGUMI_USER_AGENT_REQUIRED");

const pool = createDatabasePool();
try {
  await migrateDatabase(pool);
  const repository = new CatalogRepository(pool);
  const client = new BangumiClient({
    userAgent,
    ...(process.env.BANGUMI_ACCESS_TOKEN
      ? { accessToken: process.env.BANGUMI_ACCESS_TOKEN }
      : {}),
  });

  const limit = Number(argument("limit", "100"));
  const offset = Number(argument("offset", "0"));
  const verifyThreshold = Number(argument("verify-threshold", "85"));
  const delayMs = Number(argument("delay-ms", "250"));

  let processed = 0;
  let linked = 0;
  let suggested = 0;
  let skipped = 0;
    let best: {
      candidate: SourceVisualNovel;
      confidence: number;
      decision: string;
      evidence: object;
    } | null = null;
  const batch = await repository.listCanonicalsMissingBangumi(limit, offset);
  for (const item of batch) {
    processed += 1;
    const terms = [
      item.displayTitle,
      item.vndbRecord.title,
      ...(item.vndbRecord.alternativeTitles ?? []),
    ]
      .map((term) => term?.trim())
      .filter((term): term is string => Boolean(term))
      .filter((term, index, all) => all.indexOf(term) === index);

    let best: {
      candidate: ReturnType<typeof client.normalizeRaw>;
      confidence: number;
      decision: string;
      evidence: object;
    } | null = null;

    for (const term of terms.slice(0, 2)) {
      try {
        const raw = await client.searchRaw(term, 10);
        await delay(delayMs);
        for (const subject of raw) {
          const candidate = client.normalizeRaw(subject);
          const score = scoreSourceMatch(candidate, item.vndbRecord);
          if (!best || score.confidence > best.confidence) {
            best = {
              candidate,
              confidence: score.confidence,
              decision: score.decision,
              evidence: score.evidence,
            };
          }
        }
        if (best && best.confidence >= verifyThreshold) break;
      } catch (error) {
        console.error(
          `search failed for "${term}":`,
          error instanceof Error ? error.message : String(error),
        );
        await delay(5_000);
      }
    }

    if (!best) {
      skipped += 1;
    } else {
      const conflictId = await repository.findCanonicalIdBySource(
        "bangumi",
        best.candidate.sourceId,
      );
      if (conflictId && conflictId !== item.canonicalId) {
        skipped += 1;
      } else if (best.confidence >= verifyThreshold) {
        try {
          const detail = await client.subjectDetail(
            Number(best.candidate.sourceId),
          );
          await repository.attachBangumiVerified(
            item.canonicalId,
            detail,
            best.confidence,
            best.evidence,
          );
          linked += 1;
          console.log(
            `LINK ${item.displayTitle} -> ${detail.title} (${best.confidence})`,
          );
        } catch (error) {
          console.error(
            `detail/link failed for ${item.displayTitle}:`,
            error instanceof Error ? error.message : String(error),
          );
          skipped += 1;
        }
      } else if (best.decision !== "unlikely") {
        await repository.suggestLink(
          item.canonicalId,
          best.candidate,
          best.confidence,
          best.evidence,
        );
        suggested += 1;
        console.log(
          `SUGGEST ${item.displayTitle} -> ${best.candidate.title} (${best.confidence})`,
        );
      } else {
        skipped += 1;
      }
    }

    if (processed % 25 === 0) {
      console.log(
        `progress: ${processed}/${batch.length} linked=${linked} suggested=${suggested} skipped=${skipped}`,
      );
    }
    await delay(delayMs);
  }

  console.log(JSON.stringify({ processed, linked, suggested, skipped }));
} finally {
  await pool.end();
}
