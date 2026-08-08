import { describe, expect, it } from "vitest";
import {
  comparisonSymbol,
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
    expect(formatComparisonMarker({ hint: "more" })).toBe("+");
    expect(formatComparisonMarker({ hint: "fewer" })).toBe("−");
    expect(formatComparisonMarker({})).toBe("");
  });

  it("leaves curated company relationships as plain yellow", () => {
    expect(formatComparisonMarker({ hint: "same_family" })).toBe("");
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

describe("comparisonSymbol", () => {
  it("prefers the quantity sign over the status fallback", () => {
    expect(
      comparisonSymbol({ status: "partial", hint: "more" }),
    ).toBe("+");
    expect(
      comparisonSymbol({ status: "miss", hint: "fewer" }),
    ).toBe("−");
  });

  it("shows the direction arrow before the status fallback", () => {
    expect(
      comparisonSymbol({ status: "partial", direction: "higher" }),
    ).toBe("↑");
    expect(
      comparisonSymbol({ status: "miss", direction: "lower" }),
    ).toBe("↓");
  });

  it("falls back to a per-status symbol", () => {
    const statuses = ["exact", "partial", "miss", "unknown"] as const;
    expect(statuses.map((status) => comparisonSymbol({ status }))).toEqual([
      "✓",
      "≈",
      "×",
      "?",
    ]);
  });
});
