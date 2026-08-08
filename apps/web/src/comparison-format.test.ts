import { describe, expect, it } from "vitest";
import { formatComparisonValue } from "./comparison-format.js";

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
