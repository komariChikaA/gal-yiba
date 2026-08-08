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
      const substitutionCost =
        leftCharacters[leftIndex - 1] === rightCharacters[rightIndex - 1]
          ? 0
          : 1;
      rows[leftIndex]![rightIndex] = Math.min(
        rows[leftIndex - 1]![rightIndex]! + 1,
        rows[leftIndex]![rightIndex - 1]! + 1,
        rows[leftIndex - 1]![rightIndex - 1]! + substitutionCost,
      );

      if (
        leftIndex > 1 &&
        rightIndex > 1 &&
        leftCharacters[leftIndex - 1] === rightCharacters[rightIndex - 2] &&
        leftCharacters[leftIndex - 2] === rightCharacters[rightIndex - 1]
      ) {
        rows[leftIndex]![rightIndex] = Math.min(
          rows[leftIndex]![rightIndex]!,
          rows[leftIndex - 2]![rightIndex - 2]! + 1,
        );
      }
    }
  }

  return rows[leftCharacters.length]![rightCharacters.length]!;
}

function editSimilarity(left: string, right: string): number {
  const length = Math.max(Array.from(left).length, Array.from(right).length);
  if (length === 0) return 1;
  return 1 - damerauLevenshteinDistance(left, right) / length;
}

function textScore(query: string, candidate: string): number {
  const normalized = normalizeTitle(candidate);
  if (!normalized) return 0;
  if (normalized === query) return 1_000;
  if (normalized.startsWith(query))
    return 900 - Math.min(100, (normalized.length - query.length) * 3);
  const index = normalized.indexOf(query);
  if (index >= 0)
    return 800 - Math.min(140, index * 5 + normalized.length - query.length);
  if (query.length < 3) return 0;
  const similarity = Math.max(
    editSimilarity(query, normalized),
    diceSimilarity(query, normalized),
  );
  const minimumSimilarity =
    query.length === 3 ? 0.65 : query.length === 4 ? 0.58 : 0.48;
  return similarity >= minimumSimilarity
    ? 500 + Math.round(similarity * 300)
    : 0;
}

export function searchCatalog(
  catalog: VisualNovel[],
  queryInput: string,
  limit = 20,
): CatalogSearchItem[] {
  const query = normalizeTitle(queryInput);
  if (!query) return [];

  const ranked = catalog
    .map((visualNovel) => {
      const titleMatches = [visualNovel.title, ...visualNovel.aliases]
        .map((value) => ({ value, score: textScore(query, value) }))
        .sort((left, right) => right.score - left.score);
      const developerMatches = (visualNovel.developer ?? [])
        .map((value) => ({ value, score: textScore(query, value) }))
        .sort((left, right) => right.score - left.score);
      const titleMatch = titleMatches[0];
      const developerMatch = developerMatches[0];
      const titleScore = titleMatch?.score ?? 0;
      const developerScore = developerMatch?.score ?? 0;
      const useTitle =
        titleScore > 0 && (titleScore >= developerScore || titleScore >= 800);
      const useDeveloper = !useTitle && developerScore > 0;
      const best = useDeveloper ? developerMatch : titleMatch;
      if (!best || best.score <= 0) return null;
      return {
        score: best.score,
        item: {
          id: visualNovel.id,
          title: visualNovel.title,
          aliases: visualNovel.aliases,
          developers: visualNovel.developer ?? [],
          match: {
            type: useDeveloper ? ("developer" as const) : ("title" as const),
            value: best.value,
          },
        },
      };
    })
    .filter((result): result is NonNullable<typeof result> => result != null)
    .sort(
      (left, right) =>
        Number(left.item.match.type === "developer") -
          Number(right.item.match.type === "developer") ||
        right.score - left.score ||
        left.item.title.localeCompare(right.item.title),
    );
  const keepRelevant = (matchType: "title" | "developer") => {
    const group = ranked.filter(
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
