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

function textScore(query: string, candidate: string): number {
  const normalized = normalizeTitle(candidate);
  if (!normalized) return 0;
  if (normalized === query) return 1_000;
  if (normalized.startsWith(query))
    return 850 - Math.min(100, normalized.length - query.length);
  const index = normalized.indexOf(query);
  if (index >= 0)
    return 700 - Math.min(150, index * 5 + normalized.length - query.length);
  if (query.length < 3) return 0;
  const similarity = diceSimilarity(query, normalized);
  return similarity >= 0.34 ? 350 + Math.round(similarity * 250) : 0;
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
      const useDeveloper =
        (developerMatch?.score ?? 0) > (titleMatch?.score ?? 0);
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
        right.score - left.score ||
        left.item.title.localeCompare(right.item.title),
    );
  const bestScore = ranked[0]?.score ?? 0;
  const minimumScore = bestScore >= 700 ? 700 : Math.max(450, bestScore - 60);
  return ranked
    .filter((result) => result.score >= minimumScore)
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map((result) => result.item);
}
