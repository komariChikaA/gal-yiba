import type { RankedBestOf, RankedFameTier } from "@gal-yiba/shared";

export interface MatchmakingEntry {
  socketId: string;
  nickname: string;
  fameTier: RankedFameTier;
  bestOf: RankedBestOf;
  playerId?: string;
  featureCode?: string;
  joinedAt: number;
}

export type MatchmakingResult =
  | { status: "waiting"; position: number }
  | { status: "matched"; opponent: MatchmakingEntry };

/** 内存匹配池：只在同一知名度档位内，按进入时间先后进行 1v1 配对。 */
export class MatchmakingPool {
  private readonly waiting = new Map<string, MatchmakingEntry>();

  enqueue(entry: MatchmakingEntry): MatchmakingResult {
    this.waiting.delete(entry.socketId);
    const opponent = [...this.waiting.values()].find(
      (candidate) =>
        candidate.fameTier === entry.fameTier &&
        candidate.bestOf === entry.bestOf &&
        (!candidate.playerId ||
          !entry.playerId ||
          candidate.playerId !== entry.playerId),
    );
    if (opponent) {
      this.waiting.delete(opponent.socketId);
      return { status: "matched", opponent };
    }
    this.waiting.set(entry.socketId, entry);
    return { status: "waiting", position: this.position(entry.socketId) ?? 1 };
  }

  cancel(socketId: string): boolean {
    return this.waiting.delete(socketId);
  }

  position(socketId: string): number | null {
    const entry = this.waiting.get(socketId);
    if (!entry) return null;
    const sameTier = [...this.waiting.values()].filter(
      (candidate) =>
        candidate.fameTier === entry.fameTier &&
        candidate.bestOf === entry.bestOf,
    );
    const index = sameTier.findIndex(
      (candidate) => candidate.socketId === socketId,
    );
    return index < 0 ? null : index + 1;
  }

  entries(): MatchmakingEntry[] {
    return [...this.waiting.values()];
  }

  stats(): {
    total: number;
    byFameTier: Record<RankedFameTier, number>;
    byQueue: Record<string, number>;
  } {
    const byFameTier: Record<RankedFameTier, number> = {
      novice: 0,
      standard: 0,
      veteran: 0,
    };
    const byQueue: Record<string, number> = {};
    for (const entry of this.waiting.values()) {
      byFameTier[entry.fameTier] += 1;
      const queueKey = `${entry.fameTier}:bo${entry.bestOf}`;
      byQueue[queueKey] = (byQueue[queueKey] ?? 0) + 1;
    }
    return { total: this.waiting.size, byFameTier, byQueue };
  }
}
