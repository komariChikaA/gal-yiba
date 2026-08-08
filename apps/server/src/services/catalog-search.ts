import { normalizeTitle } from "@gal-yiba/data";
import type { VisualNovel } from "@gal-yiba/shared";

export interface CatalogSearchItem {
  id: string;
  title: string;
  aliases: string[];
  developers: string[];
  match: {
    type: "title" | "developer";
    value: string;
  };
}

interface IndexedCandidate {
  normalized: string;
  original: string;
}

interface IndexedEntry {
  id: string;
  title: string;
  aliases: string[];
  developers: string[];
  titles: IndexedCandidate[];
  developerNames: IndexedCandidate[];
}

let cachedIndex: { catalog: VisualNovel[]; entries: IndexedEntry[] } | null =
  null;

function toCandidates(values: string[]): IndexedCandidate[] {
  const seen = new Set<string>();
  const candidates: IndexedCandidate[] = [];
  for (const value of values) {
    const normalized = normalizeTitle(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push({ normalized, original: value });
  }
  return candidates;
}

/** 预归一化一次标题/别名/会社，避免每次击键重复正则处理。 */
function buildIndex(catalog: VisualNovel[]): IndexedEntry[] {
  return catalog.map((visualNovel) => ({
    id: visualNovel.id,
    title: visualNovel.title,
    aliases: visualNovel.aliases ?? [],
    developers: visualNovel.developer ?? [],
    titles: toCandidates([visualNovel.title, ...(visualNovel.aliases ?? [])]),
    developerNames: toCandidates(visualNovel.developer ?? []),
  }));
}

export function searchCatalog(
  catalog: VisualNovel[],
  queryInput: string,
  limit = 20,
): CatalogSearchItem[] {
  const query = normalizeTitle(queryInput);
  if (!query) return [];

  if (!cachedIndex || cachedIndex.catalog !== catalog) {
    cachedIndex = { catalog, entries: buildIndex(catalog) };
  }
  const entries = cachedIndex.entries;

  interface EntryScores {
    titleScore: number;
    titleValue: string;
    developerScore: number;
    developerValue: string;
  }

  const scores = new Map<IndexedEntry, EntryScores>();
  let fastBest = 0;

  const cheapScore = (
    entry: IndexedEntry,
    target: "title" | "developer",
  ): void => {
    const current = scores.get(entry) ?? {
      titleScore: 0,
      titleValue: "",
      developerScore: 0,
      developerValue: "",
    };
    const candidates =
      target === "title" ? entry.titles : entry.developerNames;
    let best = 0;
    let bestValue = "";
    for (const candidate of candidates) {
      const score = cheapTextScore(query, candidate.normalized);
      if (score > best) {
        best = score;
        bestValue = candidate.original;
      }
    }
    if (target === "title") {
      current.titleScore = best;
      current.titleValue = bestValue;
    } else {
      current.developerScore = best;
      current.developerValue = bestValue;
    }
    if (best > fastBest) fastBest = best;
    scores.set(entry, current);
  };

  const fuzzyFill = (
    entry: IndexedEntry,
    target: "title" | "developer",
  ): void => {
    const current = scores.get(entry);
    if (!current) return;
    const already = target === "title" ? current.titleScore : current.developerScore;
    if (already > 0) return;
    const candidates =
      target === "title" ? entry.titles : entry.developerNames;
    let best = 0;
    let bestValue = "";
    for (const candidate of candidates) {
      const score = fuzzyTextScore(query, candidate.normalized);
      if (score > best) {
        best = score;
        bestValue = candidate.original;
      }
    }
    if (target === "title") {
      current.titleScore = best;
      current.titleValue = bestValue;
    } else {
      current.developerScore = best;
      current.developerValue = bestValue;
    }
  };

  // 第一遍：精确 / 前缀 / 子串，无编辑距离，覆盖绝大多数输入。
  for (const entry of entries) {
    cheapScore(entry, "title");
    cheapScore(entry, "developer");
  }

  // 第二遍：仅当快路径没有像样的命中（<650）且查询足够长时才跑模糊匹配，
  // 用 bigram 预过滤跳过绝大多数无关联本的编辑距离计算。
  if (query.length >= 3 && fastBest < 650) {
    for (const entry of entries) {
      fuzzyFill(entry, "title");
      fuzzyFill(entry, "developer");
    }
  }

  const ranked = [...scores.entries()]
    .map(([entry, current]) => {
      const useTitle =
        current.titleScore > 0 &&
        (current.titleScore >= current.developerScore ||
          current.titleScore >= 800);
      const useDeveloper = !useTitle && current.developerScore > 0;
      const best = useDeveloper
        ? {
            score: current.developerScore,
            value: current.developerValue,
          }
        : { score: current.titleScore, value: current.titleValue };
      if (best.score <= 0) return null;
      return {
        score: best.score,
        item: {
          id: entry.id,
          title: entry.title,
          aliases: entry.aliases,
          developers: entry.developers,
          match: {
            type: (useDeveloper
              ? "developer"
              : "title") as "title" | "developer",
            value: best.value,
          },
        },
      };
    })
    .filter((result): result is NonNullable<typeof result> => result != null);

  const rankedSorted = ranked
    .sort(
      (left, right) =>
        Number(left.item.match.type === "developer") -
          Number(right.item.match.type === "developer") ||
        right.score - left.score ||
        left.item.title.localeCompare(right.item.title),
    );

  const keepRelevant = (matchType: "title" | "developer") => {
    const group = rankedSorted.filter(
      (result) => result.item.match.type === matchType,
    );
    const bestScore = group[0]?.score ?? 0;
    const minimumScore =
      bestScore >= 900 ? 720 : Math.max(650, bestScore - 100);
    return group.filter((result) => result.score >= minimumScore);
  };

  const ordered = [...keepRelevant("title"), ...keepRelevant("developer")];
  return ordered
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map((result) => result.item);
}

function cheapTextScore(query: string, candidate: string): number {
  if (candidate === query) return 1_000;
  if (candidate.startsWith(query))
    return 900 - Math.min(100, (candidate.length - query.length) * 3);
  const index = candidate.indexOf(query);
  if (index >= 0)
    return 800 - Math.min(140, index * 5 + candidate.length - query.length);
  return 0;
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  return new Set(
    Array.from({ length: value.length - 1 }, (_, index) =>
      value.slice(index, index + 2),
    ),
  );
}

function diceSimilarity(left: string, right: string): number {
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  if (leftPairs.size === 0 || rightPairs.size === 0) return 0;
  let overlap = 0;
  for (const pair of leftPairs) if (rightPairs.has(pair)) overlap += 1;
  return (2 * overlap) / (leftPairs.size + rightPairs.size);
}

function damerauLevenshteinDistance(left: string, right: string): number {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const rows = Array.from({ length: leftCharacters.length + 1 }, () =>
    Array<number>(rightCharacters.length + 1).fill(0),
  );

  for (let index = 0; index <= leftCharacters.length; index += 1)
    rows[index]![0] = index;
  for (let index = 0; index <= rightCharacters.length; index += 1)
    rows[0]![index] = index;

  for (let leftIndex = 1; leftIndex <= leftCharacters.length; leftIndex += 1) {
    for (
      let rightIndex = 1;
      rightIndex <= rightCharacters.length;
      rightIndex += 1
    ) {
      const cost =
        leftCharacters[leftIndex - 1] === rightCharacters[rightIndex - 1]
          ? 0
          : 1;
      const previous = Math.min(
        rows[leftIndex]![rightIndex - 1]! + 1,
        rows[leftIndex - 1]![rightIndex]! + 1,
        rows[leftIndex - 1]![rightIndex - 1]! + cost,
      );
      let value = previous;
      if (
        leftIndex > 1 &&
        rightIndex > 1 &&
        leftCharacters[leftIndex - 1] === rightCharacters[rightIndex - 2] &&
        leftCharacters[leftIndex - 2] === rightCharacters[rightIndex - 1]
      ) {
        value = Math.min(
          value,
          rows[leftIndex - 2]![rightIndex - 2]! + 1,
        );
      }
      rows[leftIndex]![rightIndex] = value;
    }
  }
  return rows[leftCharacters.length]![rightCharacters.length]!;
}

function editSimilarity(left: string, right: string): number {
  const length = Math.max(Array.from(left).length, Array.from(right).length);
  if (length === 0) return 1;
  return 1 - damerauLevenshteinDistance(left, right) / length;
}

function fuzzyTextScore(query: string, candidate: string): number {
  if (query.length < 3) return 0;
  const minimumSimilarity =
    query.length === 3 ? 0.65 : query.length === 4 ? 0.58 : 0.55;
  const dice = diceSimilarity(query, candidate);
  if (dice >= minimumSimilarity) return 500 + Math.round(dice * 300);
  // 无关联本的大概共现很低，直接用 bigram 预过滤跳过编辑距离。
  if (dice < 0.25) return 0;
  const edit = editSimilarity(query, candidate);
  const similarity = Math.max(dice, edit);
  return similarity >= minimumSimilarity
    ? 500 + Math.round(similarity * 300)
    : 0;
}
