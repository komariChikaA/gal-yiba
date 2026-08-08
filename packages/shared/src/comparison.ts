import type {
  ComparisonDirection,
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
  "developer",
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

function compareSets(
  key: ComparisonKey,
  guess: string[],
  answer: string[],
): ComparisonResult {
  const answerByNormalized = new Map(
    answer.map((value) => [normalize(value), value]),
  );
  const overlap = guess
    .filter((value) => answerByNormalized.has(normalize(value)))
    .map((value) => answerByNormalized.get(normalize(value)) as string);
  const exact =
    new Set(guess.map(normalize)).size ===
      new Set(answer.map(normalize)).size &&
    overlap.length === new Set(answer.map(normalize)).size;

  return {
    key,
    status: exact ? "exact" : overlap.length > 0 ? "partial" : "miss",
    overlap,
    guessValue: guess,
  };
}

function direction(guess: number, answer: number): ComparisonDirection {
  return answer > guess ? "higher" : "lower";
}

function compareNumeric(
  key: ComparisonKey,
  guess: number,
  answer: number,
): ComparisonResult {
  if (guess === answer) return { key, status: "exact", guessValue: guess };
  const tolerance =
    key === "releaseYear"
      ? 2
      : key === "vndbRating" || key === "bangumiRating"
        ? 0.5
        : Math.max(50, Math.round(answer * 0.1));
  return {
    key,
    status: Math.abs(answer - guess) <= tolerance ? "partial" : "miss",
    direction: direction(guess, answer),
    guessValue: guess,
  };
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

  if (setKeys.has(key)) {
    return compareSets(key, guessedValue as string[], answerValue as string[]);
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
