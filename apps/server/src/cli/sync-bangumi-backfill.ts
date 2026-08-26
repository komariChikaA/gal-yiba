import "dotenv/config";
import {
  BangumiClient,
  createWebSearchProviderFromEnv,
  NetworkMappingAligner,
  scoreSourceMatch,
  scoreWithNetworkTitles,
  type SourceVisualNovel,
} from "@gal-yiba/data";
import {
  CatalogRepository,
  createDatabasePool,
  migrateDatabase,
} from "../db/index.js";

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
  const verifyThreshold = Number(argument("verify-threshold", "70"));
  const delayMs = Number(argument("delay-ms", "220"));
  const withNetwork = process.argv.includes("--with-network") || process.env.WEB_SEARCH_ENABLED === "true";
  const webSearch = withNetwork ? createWebSearchProviderFromEnv() : null;
  const networkAligner = withNetwork
    ? new NetworkMappingAligner(webSearch, client)
    : null;
  if (!client.isAuthenticated) {
    console.warn(
      "[warn] BANGUMI_ACCESS_TOKEN 未配置：nsfw/限制级条目将被 Bangumi 过滤，召回率将显著低于 500 目标；请在 .env 配置 BANGUMI_ACCESS_TOKEN 后重跑  --verify-threshold=75",
    );
  } else {
    console.log("[info] Bangumi 已认证，将包含 nsfw 条目，适合 500+ 对齐");
  }

  let processed = 0;
  let linked = 0;
  let suggested = 0;
  let skipped = 0;
  const batch = await repository.listCanonicalsMissingBangumi(limit, offset);
  for (const item of batch) {
    processed += 1;
    const terms = [
      item.displayTitle,
      item.vndbRecord.title,
      ...(item.vndbRecord.alternativeTitles ?? []),
      // 额外加入 VNDB titles 的日文原名（若与 title 不同）已在 alternativeTitles 中
    ]
      .map((term) => term?.trim())
      .filter((term): term is string => Boolean(term) && term.length >= 2)
      .filter((term, index, all) => all.indexOf(term) === index)
      .slice(0, 6);

    let best: {
      candidate: SourceVisualNovel;
      confidence: number;
      decision: string;
      evidence: object;
    } | null = null;

    // 网络搜索强制对齐路径：先试网络，成功则直接用其 evidence/confidence
    if (networkAligner) {
      try {
        const networkResult = await networkAligner.align(item.vndbRecord);
        if (networkResult) {
          best = {
            candidate: networkResult.candidate,
            confidence: networkResult.confidence,
            decision: networkResult.decision,
            evidence: networkResult.evidence as unknown as object,
          };
        }
      } catch (error) {
        console.error(
          `network align failed for "${item.displayTitle}":`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // 本地 Bangumi 搜索路径（与网络结果取优）——扩大召回：每词 20 条 + 分页，最多 6 词
    for (const term of terms) {
      try {
        const raw = await client.searchRawPaged(term, 20, 2);
        await delay(delayMs);
        for (const subject of raw) {
          const candidate = client.normalizeRaw(subject);
          const score = scoreSourceMatch(candidate, item.vndbRecord);
          // 若开启网络，额外计算网络提升分数并取更高者
          let finalScore = score;
          let finalEvidence: object = score.evidence as unknown as object;
          if (webSearch && best?.evidence && (best.evidence as Record<string, unknown>).searchResults) {
            const networkTitles = ((best.evidence as Record<string, unknown>).networkTitles as string[]) ?? [];
            if (networkTitles.length > 0) {
              const boosted = scoreWithNetworkTitles(candidate, item.vndbRecord, networkTitles);
              if (boosted.confidence > score.confidence) {
                finalScore = { confidence: boosted.confidence, decision: boosted.decision, evidence: boosted.baseEvidence } as typeof score;
                finalEvidence = {
                  ...boosted.baseEvidence,
                  networkTitles,
                  networkBoosted: true,
                  baseConfidence: boosted.baseConfidence,
                };
              }
            }
          }
          if (!best || finalScore.confidence > best.confidence) {
            best = {
              candidate,
              confidence: finalScore.confidence,
              decision: finalScore.decision,
              evidence: finalEvidence,
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
        await repository.upsertSourceRecord(best.candidate);
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
