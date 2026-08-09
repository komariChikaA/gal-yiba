import type { FameTier } from "./domain.js";

export type RankedFameTier = Extract<
  FameTier,
  "novice" | "standard" | "veteran"
>;
export type RankedBestOf = 1 | 3;
export type RankedTier =
  | "beginner"
  | "ga_soldier"
  | "ga_elite"
  | "ga_master"
  | "ga_saint"
  | "celestial";

export interface RankDefinition {
  tier: RankedTier;
  name: string;
  level: number;
  minPt: number;
}

export interface PlayerRank extends RankDefinition {
  label: string;
  nextMinPt: number | null;
}

const lowerRanks: RankDefinition[] = [
  { tier: "beginner", name: "初心", level: 1, minPt: 0 },
  { tier: "beginner", name: "初心", level: 2, minPt: 100 },
  { tier: "beginner", name: "初心", level: 3, minPt: 250 },
  { tier: "ga_soldier", name: "旮士", level: 1, minPt: 450 },
  { tier: "ga_soldier", name: "旮士", level: 2, minPt: 700 },
  { tier: "ga_soldier", name: "旮士", level: 3, minPt: 1000 },
  { tier: "ga_elite", name: "旮杰", level: 1, minPt: 1350 },
  { tier: "ga_elite", name: "旮杰", level: 2, minPt: 1750 },
  { tier: "ga_elite", name: "旮杰", level: 3, minPt: 2200 },
  { tier: "ga_master", name: "旮豪", level: 1, minPt: 2700 },
  { tier: "ga_master", name: "旮豪", level: 2, minPt: 3250 },
  { tier: "ga_master", name: "旮豪", level: 3, minPt: 3850 },
  { tier: "ga_saint", name: "旮圣", level: 1, minPt: 4500 },
  { tier: "ga_saint", name: "旮圣", level: 2, minPt: 5200 },
  { tier: "ga_saint", name: "旮圣", level: 3, minPt: 5950 },
];

export const rankDefinitions: readonly RankDefinition[] = [
  ...lowerRanks,
  ...Array.from({ length: 20 }, (_, index): RankDefinition => ({
    tier: "celestial",
    name: "魂天",
    level: index + 1,
    minPt: 6750 + index * 800,
  })),
];

export function rankFromPt(ptInput: number): PlayerRank {
  const pt = Math.max(0, Math.floor(ptInput));
  let index = 0;
  for (let candidate = 1; candidate < rankDefinitions.length; candidate += 1) {
    if (rankDefinitions[candidate]!.minPt > pt) break;
    index = candidate;
  }
  const definition = rankDefinitions[index]!;
  return {
    ...definition,
    label:
      definition.tier === "celestial"
        ? `${definition.name} Lv${definition.level}`
        : `${definition.name}★${definition.level}`,
    nextMinPt: rankDefinitions[index + 1]?.minPt ?? null,
  };
}

export const rankedPtBalance = {
  novice: {
    breakEvenWinRate: 0.25,
    1: { win: 20, loss: 6 },
    3: { win: 30, loss: 9 },
  },
  standard: {
    breakEvenWinRate: 0.3,
    1: { win: 28, loss: 12 },
    3: { win: 42, loss: 18 },
  },
  veteran: {
    breakEvenWinRate: 0.4,
    1: { win: 36, loss: 24 },
    3: { win: 54, loss: 36 },
  },
} as const;

/**
 * 同 PT 对局中，萌新达到 25% 即可净增长；入门/标准严格对应 30%/40%。
 * 段位差最多修正 25%：爆冷胜利的奖惩更高，强者正常获胜的奖惩更低。
 */
export function calculateRankedPtDeltas(input: {
  fameTier: RankedFameTier;
  bestOf: RankedBestOf;
  winnerPt: number;
  loserPt: number;
}): { winnerDelta: number; loserDelta: number; upsetMultiplier: number } {
  const base = rankedPtBalance[input.fameTier][input.bestOf];
  const upsetMultiplier = Math.min(
    1.25,
    Math.max(0.75, 1 + (input.loserPt - input.winnerPt) / 4000),
  );
  return {
    winnerDelta: Math.max(1, Math.round(base.win * upsetMultiplier)),
    loserDelta: -Math.max(1, Math.round(base.loss * upsetMultiplier)),
    upsetMultiplier,
  };
}
