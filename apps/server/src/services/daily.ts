import { randomUUID } from "node:crypto";
import {
  createGameSessionForAnswer,
  dailyAnswerForDate,
  dailyDateString,
  submitGuess,
  type GameRules,
  type GameSession,
  type GuessOutcome,
  type PublicGameSession,
  type VisualNovel,
} from "@gal-yiba/shared";

export interface DailyGameResult {
  playerToken: string;
  date: string;
  session: GameSession;
}

/**
 * Daily question games, keyed by an anonymous per-player token.
 *
 * The day's answer is locked on the first request (per date) so a catalog
 * sync in the middle of the day never changes the question. Sessions are
 * in-memory only: restarting the process discards unfinished daily games,
 * matching the current single-instance room behavior.
 */
export class DailyRegistry {
  private readonly games = new Map<string, GameSession>();
  private readonly dailyAnswers = new Map<string, VisualNovel>();

  getOrCreate(
    playerToken: string | null,
    catalog: VisualNovel[],
    rules: GameRules,
    now = new Date(),
  ): DailyGameResult {
    const date = dailyDateString(now);
    if (playerToken) {
      const existing = this.games.get(playerToken);
      if (existing && existing.startedAt.slice(0, 10) === date) {
        const settled = this.settleIfExpired(existing, now);
        if (settled) this.games.set(playerToken, settled);
        return { playerToken, date, session: settled ?? existing };
      }
    }
    const token = playerToken ?? randomUUID();
    let answer = this.dailyAnswers.get(date);
    if (!answer) {
      answer = dailyAnswerForDate(catalog, rules, date);
      this.dailyAnswers.set(date, answer);
    }
    const session = createGameSessionForAnswer(answer, rules, { now });
    this.games.set(token, session);
    this.prune(now);
    return { playerToken: token, date, session };
  }

  submitGuess(
    playerToken: string,
    visualNovelId: string,
    catalog: VisualNovel[],
    now = new Date(),
  ): GuessOutcome {
    const session = this.games.get(playerToken);
    if (!session) throw new Error("DAILY_SESSION_NOT_FOUND");
    const guessed = catalog.find(
      (visualNovel) => visualNovel.id === visualNovelId,
    );
    if (!guessed) throw new Error("GUESS_NOT_IN_CATALOG");
    const outcome = submitGuess(session, guessed, now);
    this.games.set(playerToken, outcome.game);
    return outcome;
  }


  private settleIfExpired(session: GameSession, now: Date): GameSession | null {
    if (session.status !== "active") return null;
    if (now.getTime() <= Date.parse(session.deadlineAt)) return null;
    return {
      ...session,
      status: "expired" as const,
      finishedAt: now.toISOString(),
    };
  }

  private prune(now: Date): void {
    const today = dailyDateString(now);
    for (const [token, session] of this.games) {
      if (session.startedAt.slice(0, 10) !== today) this.games.delete(token);
    }
    for (const date of this.dailyAnswers.keys()) {
      if (date !== today) this.dailyAnswers.delete(date);
    }
  }
}
