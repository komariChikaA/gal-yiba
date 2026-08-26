import type { SourceVisualNovel } from "./types.js";

const punctuation = /[\p{P}\p{S}\s]+/gu;

export function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(punctuation, "");
}

function titleKeys(record: SourceVisualNovel): Set<string> {
  return new Set(
    [record.title, ...record.alternativeTitles]
      .map(normalizeTitle)
      .filter(Boolean),
  );
}

function releaseYear(record: SourceVisualNovel): number | null {
  const match = record.releaseDate?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

export interface MappingEvidence {
  exactTitle: boolean;
  titleOverlap: string[];
  releaseYearDelta: number | null;
  platformOverlap: string[];
  /** 最大标题相似度（Dice/Edit 最高值，0-1） */
  titleSimilarity: number;
  /** 开发者是否有重叠 */
  developerOverlap: string[];
}

export interface MappingScore {
  confidence: number;
  decision: "strong_candidate" | "needs_review" | "unlikely";
  evidence: MappingEvidence;
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  return new Set(
    Array.from({ length: value.length - 1 }, (_, i) => value.slice(i, i + 2)),
  );
}
function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let overlap = 0;
  for (const g of left) if (right.has(g)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}
function damerauLevenshteinDistance(a: string, b: string): number {
  const al = Array.from(a), bl = Array.from(b);
  const rows: number[][] = Array.from({ length: al.length + 1 }, () => Array(bl.length + 1).fill(0));
  for (let i = 0; i <= al.length; i++) rows[i]![0] = i;
  for (let j = 0; j <= bl.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= al.length; i++) for (let j = 1; j <= bl.length; j++) {
    const cost = al[i-1] === bl[j-1] ? 0 : 1;
    let v = Math.min(rows[i]![j-1]! +1, rows[i-1]![j]! +1, rows[i-1]![j-1]! + cost);
    if (i>1 && j>1 && al[i-1]===bl[j-2] && al[i-2]===bl[j-1]) v = Math.min(v, rows[i-2]![j-2]! +1);
    rows[i]![j]=v;
  }
  return rows[al.length]![bl.length]!;
}
function editSimilarity(a: string, b: string): number {
  const len = Math.max(Array.from(a).length, Array.from(b).length);
  if (len===0) return 1;
  return 1 - damerauLevenshteinDistance(a,b)/len;
}
export function titleSimilarity(left: SourceVisualNovel, right: SourceVisualNovel): number {
  const leftKeys = [...titleKeys(left)];
  const rightKeys = [...titleKeys(right)];
  let best = 0;
  for (const l of leftKeys) for (const r of rightKeys) {
    const dice = diceSimilarity(l, r);
    const edit = editSimilarity(l, r);
    const s = Math.max(dice, edit);
    // 子串包含给予额外奖励（Bangumi 常用短名）
    const contains = l.includes(r) || r.includes(l);
    const boosted = contains ? Math.min(1, s + 0.12) : s;
    if (boosted > best) best = boosted;
  }
  return best;
}
function developerOverlap(left: SourceVisualNovel, right: SourceVisualNovel): string[] {
  if (left.developers.length===0 || right.developers.length===0) return [];
  const rn = new Set(right.developers.map(d=>d.normalize("NFKC").trim().toLocaleLowerCase()).filter(Boolean));
  return left.developers.filter(d=> rn.has(d.normalize("NFKC").trim().toLocaleLowerCase()));
}

export function scoreSourceMatch(
  left: SourceVisualNovel,
  right: SourceVisualNovel,
): MappingScore {
  if (left.source === right.source)
    throw new Error("CROSS_SOURCE_RECORDS_REQUIRED");

  const leftTitles = titleKeys(left);
  const rightTitles = titleKeys(right);
  const titleOverlap = [...leftTitles].filter((title) =>
    rightTitles.has(title),
  );
  const exactTitle = titleOverlap.length > 0;
  const sim = titleSimilarity(left, right);
  const leftYear = releaseYear(left);
  const rightYear = releaseYear(right);
  const releaseYearDelta =
    leftYear == null || rightYear == null
      ? null
      : Math.abs(leftYear - rightYear);
  const rightPlatforms = new Set(
    right.platforms.map((platform) => platform.toLocaleLowerCase()),
  );
  const platformOverlap = left.platforms.filter((platform) =>
    rightPlatforms.has(platform.toLocaleLowerCase()),
  );
  const devOverlap = developerOverlap(left, right);

  // 标题分档：精确 65，高度相似 55，中度 40，低度 25，极低 0（为 500 目标适度放宽）
  let titleScore = 0;
  if (exactTitle) titleScore = 65;
  else if (sim >= 0.88) titleScore = 55;
  else if (sim >= 0.72) titleScore = 40;
  else if (sim >= 0.55) titleScore = 25;

  let confidence = titleScore;
  if (releaseYearDelta === 0) confidence += 25;
  else if (releaseYearDelta === 1) confidence += 12;
  else if (releaseYearDelta != null && releaseYearDelta > 2) confidence -= 20;
  // 年份缺失不扣分，但也不加分，保持中立
  if (platformOverlap.length > 0) confidence += 10;
  if (devOverlap.length > 0) confidence += 8;
  // 同名高相似但开发商完全缺失时不惩罚；仅在标题弱相似且开发商互斥时轻微惩罚
  if (!exactTitle && sim < 0.55 && devOverlap.length===0 && left.developers.length>0 && right.developers.length>0) {
    // 检查是否开发商无重叠且标题也弱，可能是同名不同作，保持原分但不额外提升
  }

  // 旧逻辑的 25 封顶过于粗暴，改为相似度相关封顶：极低相似仍封顶 30，中低相似封顶 55
  if (!exactTitle && sim < 0.4) confidence = Math.min(confidence, 30);
  else if (!exactTitle && sim < 0.55) confidence = Math.min(confidence, 55);

  confidence = Math.min(100, Math.max(0, confidence));

  return {
    confidence,
    decision:
      confidence >= 85
        ? "strong_candidate"
        : confidence >= 55
          ? "needs_review"
          : "unlikely",
    evidence: { exactTitle, titleOverlap, releaseYearDelta, platformOverlap, titleSimilarity: sim, developerOverlap: devOverlap },
  };
}
