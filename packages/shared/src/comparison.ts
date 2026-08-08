import type {
  ComparisonDirection,
  ComparisonHint,
  ComparisonKey,
  ComparisonResult,
  Playtime,
  VisualNovel,
} from "./domain.js";

const orderedPlaytime: Playtime[] = [
  "very_short",
  "short",
  "medium",
  "long",
  "very_long",
];
const numericKeys = new Set<ComparisonKey>([
  "releaseYear",
  "vndbRating",
  "bangumiRating",
  "vndbVoteCount",
  "bangumiVoteCount",
]);
const setKeys = new Set<ComparisonKey>([
  "publisher",
  "scenarioWriter",
  "heroineHairColor",
  "platforms",
  "languages",
  "tags",
]);

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export const voteTierThresholds = {
  vndbVoteCount: [50, 250, 500, 1_000, 2_500, 4_000],
  bangumiVoteCount: [300, 1_000, 3_000, 6_000],
} as const satisfies Record<
  "vndbVoteCount" | "bangumiVoteCount",
  readonly number[]
>;

function normalizedValues(values: string[]): Set<string> {
  return new Set(values.map(normalize).filter(Boolean));
}

function quantityHint(
  guessSize: number,
  answerSize: number,
): ComparisonHint | undefined {
  return answerSize > guessSize
    ? "more"
    : answerSize < guessSize
      ? "fewer"
      : undefined;
}

function compareSets(
  key: ComparisonKey,
  guess: string[],
  answer: string[],
  hintMode: "count" | "more_only" | "none" = "count",
): ComparisonResult {
  const answerByNormalized = new Map(
    answer.map((value) => [normalize(value), value]),
  );
  const overlap = guess
    .filter((value) => answerByNormalized.has(normalize(value)))
    .map((value) => answerByNormalized.get(normalize(value)) as string);
  const guessValues = normalizedValues(guess);
  const answerValues = normalizedValues(answer);
  const exact =
    guessValues.size === answerValues.size &&
    overlap.length === answerValues.size;
  const hint =
    overlap.length === 0 || exact || hintMode === "none"
      ? undefined
      : hintMode === "more_only"
        ? answerValues.size > guessValues.size
          ? "more"
          : undefined
        : quantityHint(guessValues.size, answerValues.size);

  return {
    key,
    status: exact ? "exact" : overlap.length > 0 ? "partial" : "miss",
    ...(hint ? { hint } : {}),
    overlap,
    guessValue: guess,
  };
}

function compareDeveloper(
  guess: VisualNovel,
  answer: VisualNovel,
): ComparisonResult {
  const guessValues = guess.developer ?? [];
  const answerValues = answer.developer ?? [];
  const direct = compareSets("developer", guessValues, answerValues, "count");
  if (direct.status !== "miss") return direct;

  const guessFamilies = normalizedValues(guess.developerFamilyIds ?? []);
  const answerFamilies = normalizedValues(answer.developerFamilyIds ?? []);
  const sameFamily = [...guessFamilies].some((family) =>
    answerFamilies.has(family),
  );
  return sameFamily
    ? {
        key: "developer",
        status: "partial",
        hint: "same_family",
        overlap: [],
        guessValue: guessValues,
      }
    : direct;
}

function direction(guess: number, answer: number): ComparisonDirection {
  return answer > guess ? "higher" : "lower";
}

function compareNumeric(
  key: ComparisonKey,
  guess: number,
  answer: number,
): ComparisonResult {
  if (key === "vndbVoteCount" || key === "bangumiVoteCount") {
    const thresholds = voteTierThresholds[key];
    const tier = (value: number) =>
      thresholds.reduce(
        (result, threshold) => result + Number(value >= threshold),
        0,
      );
    const guessTier = tier(guess);
    const answerTier = tier(answer);
    const status =
      guessTier === answerTier
        ? "exact"
        : Math.abs(answerTier - guessTier) === 1
          ? "partial"
          : "miss";
    return {
      key,
      status,
      ...(status === "exact"
        ? {}
        : { direction: direction(guessTier, answerTier) }),
      basis: "tier",
      guessValue: guess,
    };
  }
  if (guess === answer) return { key, status: "exact", guessValue: guess };
  const tolerance =
    key === "releaseYear"
      ? 5
      : key === "vndbRating" || key === "bangumiRating"
        ? 1
        : 0;
  return {
    key,
    status: Math.abs(answer - guess) <= tolerance ? "partial" : "miss",
    direction: direction(guess, answer),
    guessValue: guess,
  };
}

function compareAnimeAdaptation(
  guess: VisualNovel["animeAdaptation"],
  answer: VisualNovel["animeAdaptation"],
): ComparisonResult {
  if (guess === "announced")
    return {
      key: "animeAdaptation",
      status: "partial",
      guessValue: guess,
    };
  if (guess === answer)
    return { key: "animeAdaptation", status: "exact", guessValue: guess };
  return {
    key: "animeAdaptation",
    status: "miss",
    guessValue: guess,
  };
}

export function compareTitle(
  guess: VisualNovel,
  answer: VisualNovel,
): "exact" | "partial" | "miss" {
  if (guess.id === answer.id) return "exact";
  const answerSeries = normalizedValues(answer.seriesIds ?? []);
  return (guess.seriesIds ?? []).some((id) => answerSeries.has(normalize(id)))
    ? "partial"
    : "miss";
}

export function compareField(
  key: ComparisonKey,
  guess: VisualNovel,
  answer: VisualNovel,
): ComparisonResult {
  const guessedValue = guess[key];
  const answerValue = answer[key];

  if (guessedValue == null || answerValue == null)
    return {
      key,
      status: "unknown",
      guessValue: (guessedValue as string | number | string[] | null) ?? null,
    };

  if (key === "developer") return compareDeveloper(guess, answer);

  if (setKeys.has(key)) {
    const hintMode =
      key === "tags" ? "none" : key === "platforms" ? "more_only" : "count";
    return compareSets(
      key,
      guessedValue as string[],
      answerValue as string[],
      hintMode,
    );
  }

  if (numericKeys.has(key)) {
    return compareNumeric(key, guessedValue as number, answerValue as number);
  }

  if (key === "playtime") {
    const guessedIndex = orderedPlaytime.indexOf(guessedValue as Playtime);
    const answerIndex = orderedPlaytime.indexOf(answerValue as Playtime);
    if (guessedIndex === answerIndex)
      return { key, status: "exact", guessValue: guessedValue as string };
    return {
      key,
      status: Math.abs(answerIndex - guessedIndex) === 1 ? "partial" : "miss",
      direction: direction(guessedIndex, answerIndex),
      guessValue: guessedValue as string,
    };
  }

  if (key === "animeAdaptation") {
    return compareAnimeAdaptation(
      guessedValue as VisualNovel["animeAdaptation"],
      answerValue as VisualNovel["animeAdaptation"],
    );
  }

  return {
    key,
    status: guessedValue === answerValue ? "exact" : "miss",
    guessValue: guessedValue as string,
  };
}

export function compareGuess(
  guess: VisualNovel,
  answer: VisualNovel,
  enabledKeys: ComparisonKey[],
): ComparisonResult[] {
  return enabledKeys.map((key) => compareField(key, guess, answer));
}
