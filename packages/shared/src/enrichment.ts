/**
 * 纯函数分类器：不做网络请求，仅基于文本证据判断 otome / 产地。
 * 网络层（packages/data 的 CatalogEnricher）负责拉取 snippet，再喂给这些函数。
 */

export type EnrichedRegion = "japan" | "china" | "west" | "unknown";

const otomeKeywords = [
  "乙女",
  "乙女ゲーム",
  "乙女ゲー",
  "乙女向",
  "乙女游戏",
  "乙女遊戲",
  "女性向",
  "女性向け",
  "otome",
  "otome game",
  "for women",
  "female protagonist romance male",
  "攻略対象が男性",
];

const chinaKeywords = [
  "国产",
  "国ｇａｌ",
  "国gal",
  "中国制作",
  "中国厂商",
  "中国产",
  "made in china",
  "chinese visual novel",
  "chinese game",
  "中文原创",
  "汉化原创",
];

const westKeywords = [
  "欧美",
  "西方",
  "欧美gal",
  "western visual novel",
  "english visual novel",
  "western game",
  "欧米",
  "海外",
  "non-japanese",
  "non-chinese",
];

function containsKeyword(text: string, keyword: string): boolean {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  return normalized.includes(keyword.normalize("NFKC").toLocaleLowerCase());
}

export function classifyOtomeFromText(text: string): {
  isOtome: boolean;
  confidence: number;
  evidence: string[];
} {
  const hits: string[] = [];
  for (const kw of otomeKeywords) {
    if (containsKeyword(text, kw)) hits.push(kw);
  }
  // 多证据才高置信
  const confidence = hits.length === 0 ? 0 : hits.length === 1 ? 60 : hits.length >= 2 ? 85 : 95;
  return { isOtome: hits.length > 0, confidence, evidence: hits };
}

export function classifyRegionFromText(text: string): {
  region: EnrichedRegion;
  confidence: number;
  evidence: string[];
} {
  const hasOtome = false; // reserved
  void hasOtome;
  const chinaHits: string[] = [];
  const westHits: string[] = [];
  for (const kw of chinaKeywords) if (containsKeyword(text, kw)) chinaHits.push(kw);
  for (const kw of westKeywords) if (containsKeyword(text, kw)) westHits.push(kw);

  if (chinaHits.length > 0 && westHits.length === 0) {
    return {
      region: "china",
      confidence: chinaHits.length >= 2 ? 85 : 65,
      evidence: chinaHits,
    };
  }
  if (westHits.length > 0 && chinaHits.length === 0) {
    return {
      region: "west",
      confidence: westHits.length >= 2 ? 85 : 65,
      evidence: westHits,
    };
  }
  if (chinaHits.length > 0 && westHits.length > 0) {
    // 冲突时取更多命中方
    return chinaHits.length >= westHits.length
      ? { region: "china", confidence: 55, evidence: chinaHits }
      : { region: "west", confidence: 55, evidence: westHits };
  }
  return { region: "unknown", confidence: 0, evidence: [] };
}

export interface LanguageRegionInput {
  languages: string[];
}

/** 基于 languages 的本地判定（与 game.ts:visualNovelRegion 保持一致，作为网络前的基线） */
export function classifyRegionFromLanguages(
  languages: string[],
): EnrichedRegion {
  const langs = languages.map((l) => l.toLowerCase());
  if (langs.length === 0) return "japan";
  if (langs.some((l) => l === "ja" || l === "jp")) return "japan";
  const allChinese = langs.every((l) => l === "zh" || l.startsWith("zh-"));
  return allChinese ? "china" : "west";
}
