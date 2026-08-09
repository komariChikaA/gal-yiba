import { describe, expect, it } from "vitest";
import {
  calculateRankedPtDeltas,
  rankDefinitions,
  rankFromPt,
  rankedPtBalance,
} from "./ranking.js";

describe("rank system", () => {
  it("contains five three-star tiers followed by twenty celestial levels", () => {
    expect(rankDefinitions).toHaveLength(35);
    expect(rankFromPt(0).label).toBe("初心★1");
    expect(rankFromPt(449).label).toBe("初心★3");
    expect(rankFromPt(450).label).toBe("旮士★1");
    expect(rankFromPt(6750).label).toBe("魂天 Lv1");
    expect(rankFromPt(21_950).label).toBe("魂天 Lv20");
  });

  it("uses growing promotion gaps and never returns a negative rank", () => {
    const gaps = rankDefinitions
      .slice(1)
      .map((rank, index) => rank.minPt - rankDefinitions[index]!.minPt);
    expect(gaps[0]).toBe(100);
    expect(gaps.at(-1)).toBe(800);
    expect(rankFromPt(-999).label).toBe("初心★1");
  });

  it("keeps the requested same-rank win rates profitable", () => {
    for (const fameTier of ["novice", "standard", "veteran"] as const) {
      for (const bestOf of [1, 3] as const) {
        const balance = rankedPtBalance[fameTier];
        const delta = calculateRankedPtDeltas({
          fameTier,
          bestOf,
          winnerPt: 1000,
          loserPt: 1000,
        });
        const breakEven =
          -delta.loserDelta / (delta.winnerDelta - delta.loserDelta);
        expect(breakEven).toBeLessThanOrEqual(balance.breakEvenWinRate);
        if (fameTier !== "novice") {
          expect(breakEven).toBeCloseTo(balance.breakEvenWinRate, 5);
        }
      }
    }
  });

  it("raises both stakes for an upset and caps the rank-gap modifier", () => {
    expect(
      calculateRankedPtDeltas({
        fameTier: "veteran",
        bestOf: 3,
        winnerPt: 0,
        loserPt: 8000,
      }),
    ).toEqual({ winnerDelta: 68, loserDelta: -45, upsetMultiplier: 1.25 });
    expect(
      calculateRankedPtDeltas({
        fameTier: "veteran",
        bestOf: 3,
        winnerPt: 8000,
        loserPt: 0,
      }),
    ).toEqual({ winnerDelta: 41, loserDelta: -27, upsetMultiplier: 0.75 });
  });
});
