import type { SourceVisualNovel } from "./types.js";
import type { WebSearchProvider, WebSearchResult } from "./web-search.js";
import {
  classifyOtomeFromText,
  classifyRegionFromLanguages,
  classifyRegionFromText,
  type EnrichedRegion,
} from "@gal-yiba/shared";

export interface EnrichmentEvidence {
  otome?: {
    isOtome: boolean;
    confidence: number;
    evidence: string[];
    snippet: string;
  };
  region?: {
    region: EnrichedRegion;
    confidence: number;
    evidence: string[];
    snippet: string;
    baseLanguages: string[];
  };
  searchQueries: string[];
  searchResults: WebSearchResult[];
}

export interface EnrichmentResult {
  isOtome: boolean | null; // null 表示未判定，保持原值
  region: EnrichedRegion | null;
  confidence: {
    otome: number;
    region: number;
  };
  evidence: EnrichmentEvidence;
}

/**
 * 目录富化器：通过网络检索强制分类 乙游 / 国产 / 欧美
 * 设计为可注入 WebSearchProvider，失败时静默回退，不抛异常阻断主流程
 */
export class CatalogEnricher {
  constructor(private readonly search: WebSearchProvider | null) {}

  async enrich(
    record: SourceVisualNovel,
  ): Promise<EnrichmentResult> {
    const queries = buildQueries(record);
    let results: WebSearchResult[] = [];
    if (this.search) {
      for (const q of queries) {
        try {
          const r = await this.search.search(q, { limit: 5 });
          results.push(...r);
          if (results.length >= 8) break;
        } catch {
          // 单 query 失败不影响整体，回退到已获结果
        }
      }
    }

    const aggregatedText = results
      .map((r) => `${r.title} ${r.snippet}`)
      .join(" \n ");

    // 若无网络结果则保持 null，外层维持原值
    if (!aggregatedText.trim()) {
      return {
        isOtome: null,
        region: null,
        confidence: { otome: 0, region: 0 },
        evidence: { searchQueries: queries, searchResults: results },
      };
    }

    const otome = classifyOtomeFromText(aggregatedText);
    const regionText = classifyRegionFromText(aggregatedText);
    const baseRegion = classifyRegionFromLanguages(record.languages ?? []);

    // 决策：仅在网络置信度足够时覆盖
    let finalIsOtome: boolean | null = null;
    if (otome.confidence >= 60) finalIsOtome = otome.isOtome;
    // 若本地已是 otome (g542) 则不被网络否定覆盖：外层应保留 true
    if (record.isOtome === true) finalIsOtome = true;

    let finalRegion: EnrichedRegion | null = null;
    // 语言缺失或为 unknown 时优先信网络；否则需高置信才覆盖
    const languageIsMissing = (record.languages ?? []).length === 0;
    if (regionText.region !== "unknown") {
      if (languageIsMissing && regionText.confidence >= 60) finalRegion = regionText.region;
      else if (!languageIsMissing && regionText.confidence >= 75) finalRegion = regionText.region;
      // 特例：纯中文语言但网络判定为 japan 时不覆盖国产
      if (baseRegion === "china" && regionText.region === "japan") finalRegion = null;
    }

    return {
      isOtome: finalIsOtome,
      region: finalRegion,
      confidence: { otome: otome.confidence, region: regionText.confidence },
      evidence: {
        otome: {
          isOtome: otome.isOtome,
          confidence: otome.confidence,
          evidence: otome.evidence,
          snippet: aggregatedText.slice(0, 800),
        },
        region: {
          region: regionText.region,
          confidence: regionText.confidence,
          evidence: regionText.evidence,
          snippet: aggregatedText.slice(0, 800),
          baseLanguages: record.languages ?? [],
        },
        searchQueries: queries,
        searchResults: results,
      },
    };
  }
}

function buildQueries(record: SourceVisualNovel): string[] {
  const titles = [record.title, ...record.alternativeTitles].filter(Boolean).slice(0, 2);
  const primary = titles[0] ?? record.title;
  const dev = record.developers?.[0];
  const queries: string[] = [];
  // 乙女分类专用查询
  queries.push(`${primary} 乙女 游戏`);
  queries.push(`${primary} otome game`);
  if (dev) queries.push(`${primary} ${dev} 国产 欧美`);
  queries.push(`${primary} visual novel 中国 制作`);
  return [...new Set(queries)].slice(0, 4);
}

export function applyEnrichmentToRecord(
  record: SourceVisualNovel,
  enrichment: EnrichmentResult,
): SourceVisualNovel {
  if (enrichment.isOtome == null && enrichment.region == null) return record;
  const enriched: SourceVisualNovel = { ...record };
  if (enrichment.isOtome != null) enriched.isOtome = enrichment.isOtome;
  // 产地不直接改 languages，而是写入 evidence 供上层 visualNovelRegion 覆盖；
  // 为兼容旧逻辑，若 region 非空则同步改 languages 以便 game.ts 能识别：
  if (enrichment.region === "china") enriched.languages = ["zh"];
  else if (enrichment.region === "west") enriched.languages = ["en"];
  else if (enrichment.region === "japan") enriched.languages = ["ja"];
  return enriched;
}
