import type { FameTier } from "@gal-yiba/shared";

export interface MatchmakingEntry {
  socketId: string;
  nickname: string;
  fameTier: FameTier;
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
      (candidate) => candidate.fameTier === entry.fameTier,
    );
    const index = sameTier.findIndex(
      (candidate) => candidate.socketId === socketId,
    );
    return index < 0 ? null : index + 1;
  }

  entries(): MatchmakingEntry[] {
    return [...this.waiting.values()];
  }

  stats(): { total: number; byFameTier: Record<FameTier, number> } {
    const byFameTier: Record<FameTier, number> = {
      novice: 0,
      standard: 0,
      veteran: 0,
      experienced: 0,
      master: 0,
    };
    for (const entry of this.waiting.values()) byFameTier[entry.fameTier] += 1;
    return { total: this.waiting.size, byFameTier };
  }
}
