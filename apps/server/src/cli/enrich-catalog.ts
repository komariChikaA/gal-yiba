import "dotenv/config";
import { createDatabasePool, migrateDatabase } from "../db/index.js";
import { CatalogEnricher, applyEnrichmentToRecord, createWebSearchProviderFromEnv } from "@gal-yiba/data";
import { CatalogRepository } from "../db/catalog-repository.js";

function argument(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const pool = createDatabasePool();
try {
  await migrateDatabase(pool);
  const repository = new CatalogRepository(pool);
  const dryRun = process.argv.includes("--dry-run");
  const limit = Number(argument("limit", "100"));
  const offset = Number(argument("offset", "0"));
  const withNetwork = process.argv.includes("--with-network") || process.env.WEB_SEARCH_ENABLED === "true";
  const search = withNetwork ? createWebSearchProviderFromEnv() : null;
  if (withNetwork && !search) {
    console.warn("WEB_SEARCH_ENABLED but no provider configured (WEB_SEARCH_API_URL); falling back to dry heuristic");
  }
  const enricher = new CatalogEnricher(search);

  const source = (argument("source", "vndb") as "vndb" | "bangumi");
  const records = await repository.listSourceRecordsForEnrichment(source, limit, offset);

  let processed = 0;
  let enrichedOtome = 0;
  let enrichedRegion = 0;
  let skipped = 0;
  let wouldChange = 0;

  for (const record of records) {
    processed += 1;
    const result = await enricher.enrich(record);
    const hasOtomeChange = result.isOtome != null && result.isOtome !== record.isOtome;
    const hasRegionChange = result.region != null;
    if (!hasOtomeChange && !hasRegionChange) {
      skipped += 1;
      continue;
    }
    wouldChange += 1;
    if (result.isOtome != null) enrichedOtome += 1;
    if (result.region != null) enrichedRegion += 1;

    const enrichedRecord = applyEnrichmentToRecord(record, result);
    const evidence = {
      enrichment: result.evidence,
      enrichedAt: new Date().toISOString(),
      dryRun,
    };

    console.log(
      `${dryRun ? "[DRY]" : "[WRITE]"} ${record.source}:${record.sourceId} "${record.title}" -> isOtome=${String(enrichedRecord.isOtome)} region=${String(result.region)} conf=${JSON.stringify(result.confidence)} languages=${JSON.stringify(enrichedRecord.languages)}`,
    );

    if (!dryRun) {
      await repository.upsertSourceRecord(enrichedRecord);
      // 将富化证据写入 source_links 的 evidence 旁路：若已有 canonical 则追加
      const canonicalId = await repository.findCanonicalIdBySource(record.source, record.sourceId);
      if (canonicalId) {
        await repository.appendEnrichmentEvidence(canonicalId, record.source, record.sourceId, evidence);
      }
    }

    // 轻量限速
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log(JSON.stringify({ processed, wouldChange, enrichedOtome, enrichedRegion, skipped, dryRun }));
} finally {
  await pool.end();
}
