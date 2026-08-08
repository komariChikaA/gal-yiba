import { describe, expect, it } from "vitest";
import {
  formatComparisonValue,
  formatComparisonVerdict,
} from "./comparison-format.js";

describe("formatComparisonValue", () => {
  it("shows the guessed release year", () => {
    expect(
      formatComparisonValue({
        key: "releaseYear",
        status: "miss",
        guessValue: 2016,
      }),
    ).toBe("2016");
  });

  it("keeps multi-value criteria visible", () => {
    expect(
      formatComparisonValue({
        key: "platforms",
        status: "partial",
        guessValue: ["PC", "Nintendo Switch"],
      }),
    ).toBe("PC · Nintendo Switch");
  });

  it("labels missing data clearly", () => {
    expect(
      formatComparisonValue({
        key: "bangumiRating",
        status: "unknown",
        guessValue: null,
      }),
    ).toBe("数据未知");
  });
});

describe("formatComparisonVerdict", () => {
  it("shows quantity signs and vote-tier language", () => {
    expect(
      formatComparisonVerdict({
        key: "scenarioWriter",
        status: "partial",
        hint: "more",
        guessValue: ["A", "B"],
      }),
    ).toBe("部分 +");
    expect(
      formatComparisonVerdict({
        key: "vndbVoteCount",
        status: "partial",
        basis: "tier",
        guessValue: 900,
      }),
    ).toBe("相邻档");
  });

  it("labels curated company relationships without a sign", () => {
    expect(
      formatComparisonVerdict({
        key: "developer",
        status: "partial",
        hint: "same_family",
        guessValue: ["Key"],
      }),
    ).toBe("关联会社");
  });
});
