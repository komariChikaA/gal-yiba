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
}

export interface MappingScore {
  confidence: number;
  decision: "strong_candidate" | "needs_review" | "unlikely";
  evidence: MappingEvidence;
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

  let confidence = exactTitle ? 65 : 0;
  if (releaseYearDelta === 0) confidence += 25;
  else if (releaseYearDelta === 1) confidence += 12;
  else if (releaseYearDelta != null && releaseYearDelta > 2) confidence -= 20;
  if (platformOverlap.length > 0) confidence += 10;
  if (!exactTitle && titleOverlap.length === 0)
    confidence = Math.min(confidence, 25);
  confidence = Math.min(100, Math.max(0, confidence));

  return {
    confidence,
    decision:
      confidence >= 85
        ? "strong_candidate"
        : confidence >= 55
          ? "needs_review"
          : "unlikely",
    evidence: { exactTitle, titleOverlap, releaseYearDelta, platformOverlap },
  };
}
