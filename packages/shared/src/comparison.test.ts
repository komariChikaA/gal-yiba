import { describe, expect, it } from "vitest";
import { compareField, compareGuess } from "./comparison.js";
import type { VisualNovel } from "./domain.js";

function visualNovel(overrides: Partial<VisualNovel> = {}): VisualNovel {
  return {
    id: "v1",
    title: "Example",
    aliases: [],
    developer: ["Studio A"],
    publisher: ["Publisher A"],
    scenarioWriter: ["Writer A"],
    heroineHairColor: ["black"],
    releaseYear: 2020,
    playtime: "medium",
    vndbRating: 8,
    bangumiRating: 7.8,
    vndbVoteCount: 3000,
    bangumiVoteCount: 1200,
    animeAdaptation: "none",
    ageRating: "all_ages",
    platforms: ["windows"],
    languages: ["ja", "zh-Hans"],
    tags: ["romance", "school"],
    provenance: {},
    ...overrides,
  };
}

describe("compareField", () => {
  it("reports set overlap without requiring exact equality", () => {
    const result = compareField(
      "tags",
      visualNovel({ tags: ["romance", "comedy"] }),
      visualNovel({ tags: ["romance", "school"] }),
    );
    expect(result).toEqual({
      key: "tags",
      status: "partial",
      overlap: ["romance"],
      guessValue: ["romance", "comedy"],
    });
  });

  it("compares multiple primary heroine hair colors as a set", () => {
    expect(
      compareField(
        "heroineHairColor",
        visualNovel({ heroineHairColor: ["brown", "blue"] }),
        visualNovel({ heroineHairColor: ["brown", "green"] }),
      ),
    ).toEqual({
      key: "heroineHairColor",
      status: "partial",
      overlap: ["brown"],
      guessValue: ["brown", "blue"],
    });
  });

  it("points toward a later release year", () => {
    expect(
      compareField(
        "releaseYear",
        visualNovel({ releaseYear: 2018 }),
        visualNovel(),
      ),
    ).toEqual({
      key: "releaseYear",
      status: "partial",
      direction: "higher",
      guessValue: 2018,
    });
  });

  it("does not turn missing source data into a false mismatch", () => {
    expect(
      compareField(
        "developer",
        visualNovel({ developer: null }),
        visualNovel(),
      ),
    ).toEqual({
      key: "developer",
      status: "unknown",
      guessValue: null,
    });
  });
});

describe("compareGuess", () => {
  it("only returns fields enabled by the room rules", () => {
    const results = compareGuess(visualNovel(), visualNovel(), [
      "developer",
      "tags",
    ]);
    expect(results.map((result) => result.key)).toEqual(["developer", "tags"]);
  });
});
