import { describe, expect, it } from "vitest";
import {
  formatComparisonAriaLabel,
  formatComparisonMarker,
  formatComparisonValue,
  formatCountdown,
  formatGuessStars,
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

describe("formatGuessStars", () => {
  it("renders used guesses as filled stars without exceeding the limit", () => {
    expect(formatGuessStars(3, 8)).toBe("★★★☆☆☆☆☆");
    expect(formatGuessStars(12, 8)).toBe("★★★★★★★★");
  });
});

describe("formatCountdown", () => {
  it("formats remaining seconds and clamps expired values", () => {
    expect(formatCountdown(300)).toBe("05:00");
    expect(formatCountdown(29.2)).toBe("00:30");
    expect(formatCountdown(-1)).toBe("00:00");
  });
});

describe("formatComparisonMarker", () => {
  it("only shows quantity signs", () => {
    expect(
      formatComparisonMarker({
        key: "scenarioWriter",
        status: "partial",
        hint: "more",
        guessValue: ["A", "B"],
      }),
    ).toBe("+");
    expect(
      formatComparisonMarker({
        key: "vndbVoteCount",
        status: "partial",
        basis: "tier",
        guessValue: 900,
      }),
    ).toBe("");
  });

  it("leaves curated company relationships as plain yellow", () => {
    expect(
      formatComparisonMarker({
        key: "developer",
        status: "partial",
        hint: "same_family",
        guessValue: ["Key"],
      }),
    ).toBe("");
  });

  it("keeps a non-visible accessibility description", () => {
    expect(
      formatComparisonAriaLabel({
        key: "releaseYear",
        status: "partial",
        direction: "higher",
        guessValue: 2016,
      }),
    ).toBe("接近，答案更高");
  });
});
