import { compareGuess, compareTitle } from "./comparison.js";
import { selectImportantTags } from "./catalog.js";
import type {
  ComparisonResult,
  FameTier,
  GameRules,
  VisualNovel,
} from "./domain.js";

export const fameTierThresholds = {
  novice: { vndbVoteCount: 1000, bangumiVoteCount: 3000 },
  standard: { vndbVoteCount: 250, bangumiVoteCount: 300 },
} as const;

export function fameTierForVisualNovel(visualNovel: VisualNovel): FameTier {
  const vndbVotes = visualNovel.vndbVoteCount ?? 0;
  const bangumiVotes = visualNovel.bangumiVoteCount ?? 0;
  if (
    vndbVotes >= fameTierThresholds.novice.vndbVoteCount ||
    bangumiVotes >= fameTierThresholds.novice.bangumiVoteCount
  ) {
    return "novice";
  }
  if (
    vndbVotes >= fameTierThresholds.standard.vndbVoteCount ||
    bangumiVotes >= fameTierThresholds.standard.bangumiVoteCount
  ) {
    return "standard";
  }
  return "veteran";
}

export interface GuessRecord {
  guessNumber: number;
  visualNovelId: string;
  title: string;
  titleStatus: "exact" | "partial" | "miss";
  comparison: ComparisonResult[];
  isCorrect: boolean;
  guessedAt: string;
}

export interface GameSession {
  id: string;
  status: "active" | "won" | "lost" | "expired";
  rules: GameRules;
  answer: VisualNovel;
  guesses: GuessRecord[];
  startedAt: string;
  deadlineAt: string;
  finishedAt: string | null;
}

export interface PublicGameSession {
  id: string;
  status: GameSession["status"];
  rules: GameRules;
  guesses: GuessRecord[];
  startedAt: string;
  deadlineAt: string;
  finishedAt: string | null;
  attemptsLeft: number;
  answer?: Pick<VisualNovel, "id" | "title">;
}

export type GuessOutcome =
  | { ok: true; game: GameSession; guess: GuessRecord }
  | {
      ok: false;
      error:
        | "GAME_FINISHED"
        | "GAME_EXPIRED"
        | "DUPLICATE_GUESS"
        | "GUESS_NOT_IN_POOL";
      game: GameSession;
    };

function normalizedSet(values: string[] | null): Set<string> {
  return new Set(
    (values ?? []).map((value) =>
      value.normalize("NFKC").trim().toLocaleLowerCase(),
    ),
  );
}

function createSessionId(): string {
  const runtime = globalThis as typeof globalThis & {
    crypto?: { randomUUID?: () => string };
  };
  return (
    runtime.crypto?.randomUUID?.() ??
    `game-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function visualNovelForRules(
  visualNovel: VisualNovel,
  rules: GameRules,
): VisualNovel {
  const importantTags = selectImportantTags(
    visualNovel.tagDetails,
    visualNovel.tags,
    rules.pool.maxTagSpoilerLevel,
  );
  return {
    ...structuredClone(visualNovel),
    tags: importantTags.map((tag) => tag.name),
    tagDetails: importantTags,
  };
}

export type VisualNovelRegion = "japan" | "china" | "west";

/** 区域判定：含日语 → 日系；全部语言为中文 → 国旮；否则 → 欧美。 */
export function visualNovelRegion(
  visualNovel: VisualNovel,
): VisualNovelRegion {
  const languages = (visualNovel.languages ?? []).map((language) =>
    language.toLowerCase(),
  );
  if (languages.length === 0) return "japan";
  if (languages.some((language) => language === "ja" || language === "jp")) {
    return "japan";
  }
  const allChinese = languages.every(
    (language) => language === "zh" || language.startsWith("zh-"),
  );
  return allChinese ? "china" : "west";
}

export function filterAnswerPool(
  catalog: VisualNovel[],
  rules: GameRules,
): VisualNovel[] {
  const included = normalizedSet(rules.pool.includeTags);
  const excluded = normalizedSet(rules.pool.excludeTags);

  return catalog
    .filter((visualNovel) => {
      const region = visualNovelRegion(visualNovel);
      if (region === "china" && !rules.pool.includeChina) return false;
      if (region === "west" && !rules.pool.includeWest) return false;
      return (
        fameTierForVisualNovel(visualNovel) === rules.pool.fameTier &&
        (!rules.pool.allAgesOnly || visualNovel.ageRating === "all_ages")
      );
    })
    .map((visualNovel) => visualNovelForRules(visualNovel, rules))
    .filter((visualNovel) => {
      const tags = normalizedSet(visualNovel.tags);
      if ([...excluded].some((tag) => tags.has(tag))) return false;
      if (included.size === 0) return true;
      return rules.pool.tagMode === "all"
        ? [...included].every((tag) => tags.has(tag))
        : [...included].some((tag) => tags.has(tag));
    });
}

export function createGameSession(
  catalog: VisualNovel[],
  rules: GameRules,
  options: { now?: Date; random?: () => number; id?: string } = {},
): GameSession {
  const pool = filterAnswerPool(catalog, rules);
  if (pool.length === 0) throw new Error("EMPTY_ANSWER_POOL");
  const random = options.random ?? Math.random;
  const index = Math.min(
    pool.length - 1,
    Math.max(0, Math.floor(random() * pool.length)),
  );
  const answerOptions: { now?: Date; id?: string } = {};
  if (options.now !== undefined) answerOptions.now = options.now;
  if (options.id !== undefined) answerOptions.id = options.id;
  return createGameSessionForAnswer(pool[index] as VisualNovel, rules, answerOptions);
}

export function createGameSessionForAnswer(
  answer: VisualNovel,
  rules: GameRules,
  options: { now?: Date; id?: string } = {},
): GameSession {
  const startedAt = options.now ?? new Date();
  return {
    id: options.id ?? createSessionId(),
    status: "active",
    rules: structuredClone(rules),
    answer: structuredClone(answer),
    guesses: [],
    startedAt: startedAt.toISOString(),
    deadlineAt: new Date(
      startedAt.getTime() + rules.roundTimeSeconds * 1000,
    ).toISOString(),
    finishedAt: null,
  };
}

export function dailyDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function dailySeedIndex(dateString: string, poolSize: number): number {
  let hash = 2166136261;
  for (let index = 0; index < dateString.length; index += 1) {
    hash ^= dateString.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % poolSize;
}

export function dailyAnswerForDate(
  catalog: VisualNovel[],
  rules: GameRules,
  dateString: string,
): VisualNovel {
  const pool = filterAnswerPool(catalog, rules);
  if (pool.length === 0) throw new Error("EMPTY_ANSWER_POOL");
  return pool[dailySeedIndex(dateString, pool.length)] as VisualNovel;
}

export function createDailyGameSession(
  catalog: VisualNovel[],
  rules: GameRules,
  dateString: string,
  options: { now?: Date; id?: string } = {},
): GameSession {
  const answer = dailyAnswerForDate(catalog, rules, dateString);
  return createGameSessionForAnswer(answer, rules, options);
}

export function submitGuess(
  session: GameSession,
  guessedVisualNovel: VisualNovel,
  now = new Date(),
): GuessOutcome {
  if (session.status !== "active")
    return { ok: false, error: "GAME_FINISHED", game: session };
  if (now.getTime() > Date.parse(session.deadlineAt)) {
    const expired = {
      ...session,
      status: "expired" as const,
      finishedAt: now.toISOString(),
    };
    return { ok: false, error: "GAME_EXPIRED", game: expired };
  }
  if (
    session.guesses.some(
      (guess) => guess.visualNovelId === guessedVisualNovel.id,
    )
  ) {
    return { ok: false, error: "DUPLICATE_GUESS", game: session };
  }

  const preparedGuess = visualNovelForRules(guessedVisualNovel, session.rules);
  const isCorrect = preparedGuess.id === session.answer.id;
  const guess: GuessRecord = {
    guessNumber: session.guesses.length + 1,
    visualNovelId: preparedGuess.id,
    title: preparedGuess.title,
    titleStatus: compareTitle(preparedGuess, session.answer),
    comparison: compareGuess(
      preparedGuess,
      session.answer,
      session.rules.comparisonKeys,
    ),
    isCorrect,
    guessedAt: now.toISOString(),
  };
  const guesses = [...session.guesses, guess];
  const exhausted = guesses.length >= session.rules.maxGuesses;
  const finished = isCorrect || exhausted;
  const game: GameSession = {
    ...session,
    guesses,
    status: isCorrect ? "won" : exhausted ? "lost" : "active",
    finishedAt: finished ? now.toISOString() : null,
  };
  return { ok: true, game, guess };
}
export function publicGameSession(
  session: GameSession,
  options: { hideAnswer?: boolean } = {},
): PublicGameSession {
  const revealAnswer =
    session.status !== "active" && !(options.hideAnswer ?? false);
  return {
    id: session.id,
    status: session.status,
    rules: structuredClone(session.rules),
    guesses: structuredClone(session.guesses),
    startedAt: session.startedAt,
    deadlineAt: session.deadlineAt,
    finishedAt: session.finishedAt,
    attemptsLeft: Math.max(
      0,
      session.rules.maxGuesses - session.guesses.length,
    ),
    ...(revealAnswer
      ? { answer: { id: session.answer.id, title: session.answer.title } }
      : {}),
  };
}
