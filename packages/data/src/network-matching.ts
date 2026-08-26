import { normalizeTitle, scoreSourceMatch, type MappingScore } from "./matching.js";
import type { SourceVisualNovel } from "./types.js";
import type { WebSearchProvider, WebSearchResult } from "./web-search.js";
import type { BangumiClient } from "./bangumi.js";

export interface NetworkAlignmentEvidence {
  base: MappingScore["evidence"];
  baseConfidence: number;
  baseDecision: MappingScore["decision"];
  networkTitles: string[];
  networkConfidence: number;
  networkDecision: MappingScore["decision"];
  finalConfidence: number;
  finalDecision: MappingScore["decision"];
  searchQueries: string[];
  searchResults: WebSearchResult[];
}

export interface NetworkAlignmentResult {
  candidate: SourceVisualNovel;
  confidence: number;
  decision: MappingScore["decision"];
  evidence: NetworkAlignmentEvidence;
}

/**
 * 网络搜索强制对齐器
 * 输入 VNDB 记录，输出经网络佐证的 Bangumi 候选
 * 可注入 WebSearchProvider 与 BangumiClient，便于测试 mock
 */
export class NetworkMappingAligner {
  constructor(
    private readonly search: WebSearchProvider | null,
    private readonly bangumi: BangumiClient | null,
  ) {}

  /** 对单个 VNDB 记录做网络对齐；无网络时返回 null 以回退本地逻辑 */
  async align(
    vndbRecord: SourceVisualNovel,
  ): Promise<NetworkAlignmentResult | null> {
    if (!this.search || !this.bangumi) return null;
    const queries = buildNetworkQueries(vndbRecord);
    const collected: WebSearchResult[] = [];
    for (const q of queries) {
      try {
        const results = await this.search.search(q, { limit: 6 });
        collected.push(...results);
      } catch {
        // 单次失败不阻断
      }
      if (collected.length >= 10) break;
    }
    if (collected.length === 0) return null;

    const networkTitles = extractNetworkTitles(collected);
    if (networkTitles.length === 0) return null;

    // 将网络标题喂给 Bangumi 搜索，取最相关候选（分页扩大）
    let best: NetworkAlignmentResult | null = null;
    for (const nt of networkTitles.slice(0, 6)) {
      try {
        const raw = await this.bangumi.searchRawPaged(nt, 20, 2);
        for (const subject of raw) {
          const candidate = this.bangumi.normalizeRaw(subject);
          const scored = scoreWithNetworkTitles(vndbRecord, candidate, networkTitles);
          if (!best || scored.confidence > best.confidence) {
            best = {
              candidate,
              confidence: scored.confidence,
              decision: scored.decision,
              evidence: {
                base: scored.baseEvidence,
                baseConfidence: scored.baseConfidence,
                baseDecision: scored.baseDecision,
                networkTitles,
                networkConfidence: scored.confidence,
                networkDecision: scored.decision,
                finalConfidence: scored.confidence,
                finalDecision: scored.decision,
                searchQueries: queries,
                searchResults: collected,
              },
            };
          }
        }
        // 轻微限速，避免 429
        await new Promise((r) => setTimeout(r, 120));
      } catch {
        // 忽略单 term 失败
      }
    }
    return best;
  }
}

function buildNetworkQueries(vndbRecord: SourceVisualNovel): string[] {
  const primary = vndbRecord.title;
  const alias = vndbRecord.alternativeTitles[0];
  const dev = vndbRecord.developers[0];
  const qs: string[] = [];
  qs.push(`${primary} bangumi 游戏`);
  if (alias && alias !== primary) qs.push(`${alias} bangumi`);
  if (dev) qs.push(`${primary} ${dev} bangumi`);
  qs.push(`${primary} site:bgm.tv`);
  return [...new Set(qs)].slice(0, 4);
}

function extractNetworkTitles(results: WebSearchResult[]): string[] {
  const titles = new Set<string>();
  for (const r of results) {
    const t = r.title.normalize("NFKC").trim();
    if (t) titles.add(t);
    // 尝试从 snippet 中提取 bgm.tv 链接标题
    const snippetTitles = r.snippet
      .split(/[\n\r]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 2);
    for (const s of snippetTitles) if (s.length < 80) titles.add(s);
  }
  return [...titles].slice(0, 10);
}

/**
 * 在原 scoreSourceMatch 基础上，若网络标题与任一方标题归一后重叠则提升置信度
 * 保持原有“年份/平台”逻辑，仅在网络佐证时给予 +20 奖励
 */
export function scoreWithNetworkTitles(
  left: SourceVisualNovel,
  right: SourceVisualNovel,
  networkTitles: string[],
): {
  confidence: number;
  decision: MappingScore["decision"];
  baseEvidence: MappingScore["evidence"];
  baseConfidence: number;
  baseDecision: MappingScore["decision"];
} {
  const base = scoreSourceMatch(left, right);
  if (networkTitles.length === 0) {
    return {
      confidence: base.confidence,
      decision: base.decision,
      baseEvidence: base.evidence,
      baseConfidence: base.confidence,
      baseDecision: base.decision,
    };
  }
  const leftKeys = new Set(
    [left.title, ...left.alternativeTitles].map(normalizeTitle).filter(Boolean),
  );
  const rightKeys = new Set(
    [right.title, ...right.alternativeTitles].map(normalizeTitle).filter(Boolean),
  );
  const networkKeys = new Set(networkTitles.map(normalizeTitle).filter(Boolean));

  const leftNetworkOverlap = [...leftKeys].some((k) => networkKeys.has(k));
  const rightNetworkOverlap = [...rightKeys].some((k) => networkKeys.has(k));
  const crossNetworkOverlap = leftNetworkOverlap && rightNetworkOverlap;

  let confidence = base.confidence;
  if (crossNetworkOverlap) confidence += 20;
  else if (rightNetworkOverlap || leftNetworkOverlap) confidence += 10;
  // 若网络标题与两侧均无重叠，但网络标题间彼此高度一致，仍给微弱提升
  else if (networkKeys.size >= 3) confidence += 5;

  confidence = Math.min(100, Math.max(0, confidence));
  const decision: MappingScore["decision"] =
    confidence >= 85 ? "strong_candidate" : confidence >= 55 ? "needs_review" : "unlikely";
  return {
    confidence,
    decision,
    baseEvidence: base.evidence,
    baseConfidence: base.confidence,
    baseDecision: base.decision,
  };
}
