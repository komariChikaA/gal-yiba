import { describe, expect, it } from "vitest";
import { compareField, compareGuess, compareTitle } from "./comparison.js";
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
    isOtome: false,
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

  it("uses a five-year window for a nearby formal release year", () => {
    expect(
      compareField(
        "releaseYear",
        visualNovel({ releaseYear: 2015 }),
        visualNovel({ releaseYear: 2020 }),
      ),
    ).toMatchObject({ status: "partial", direction: "higher" });
    expect(
      compareField(
        "releaseYear",
        visualNovel({ releaseYear: 2014 }),
        visualNovel({ releaseYear: 2020 }),
      ),
    ).toMatchObject({ status: "miss", direction: "higher" });
  });

  it("uses one rating point as the yellow boundary", () => {
    expect(
      compareField(
        "vndbRating",
        visualNovel({ vndbRating: 7 }),
        visualNovel({ vndbRating: 8 }),
      ).status,
    ).toBe("partial");
    expect(
      compareField(
        "bangumiRating",
        visualNovel({ bangumiRating: 6.7 }),
        visualNovel({ bangumiRating: 7.8 }),
      ).status,
    ).toBe("miss");
  });

  it("compares source-specific vote-count tiers", () => {
    expect(
      compareField(
        "vndbVoteCount",
        visualNovel({ vndbVoteCount: 600 }),
        visualNovel({ vndbVoteCount: 900 }),
      ),
    ).toMatchObject({ status: "exact", basis: "tier" });
    expect(
      compareField(
        "vndbVoteCount",
        visualNovel({ vndbVoteCount: 900 }),
        visualNovel({ vndbVoteCount: 1_100 }),
      ),
    ).toMatchObject({
      status: "partial",
      basis: "tier",
      direction: "higher",
    });
    expect(
      compareField(
        "bangumiVoteCount",
        visualNovel({ bangumiVoteCount: 250 }),
        visualNovel({ bangumiVoteCount: 3_500 }),
      ).status,
    ).toBe("miss");
  });

  it("adds quantity hints to overlapping company, writer and hair sets", () => {
    expect(
      compareField(
        "developer",
        visualNovel({ developer: ["Studio A", "Studio B"] }),
        visualNovel({ developer: ["Studio A"] }),
      ),
    ).toMatchObject({ status: "partial", hint: "fewer" });
    expect(
      compareField(
        "scenarioWriter",
        visualNovel({ scenarioWriter: ["A"] }),
        visualNovel({ scenarioWriter: ["A", "B"] }),
      ),
    ).toMatchObject({ status: "partial", hint: "more" });
    expect(
      compareField(
        "heroineHairColor",
        visualNovel({ heroineHairColor: ["brown", "blue"] }),
        visualNovel({ heroineHairColor: ["brown"] }),
      ),
    ).toMatchObject({ status: "partial", hint: "fewer" });
  });

  it("marks curated parent or child companies without a quantity sign", () => {
    expect(
      compareField(
        "developer",
        visualNovel({
          developer: ["Key"],
          developerFamilyIds: ["visual-arts"],
        }),
        visualNovel({
          developer: ["VISUAL ARTS Co.,Ltd."],
          developerFamilyIds: ["visual-arts"],
        }),
      ),
    ).toMatchObject({ status: "partial", hint: "same_family" });
  });

  it("only adds a plus to platforms when the answer has extra platforms", () => {
    const answerHasNoExtraPlatform = compareField(
      "platforms",
      visualNovel({ platforms: ["PC", "Nintendo Switch"] }),
      visualNovel({ platforms: ["PC"] }),
    );
    expect(answerHasNoExtraPlatform.status).toBe("partial");
    expect(answerHasNoExtraPlatform.hint).toBeUndefined();
    expect(
      compareField(
        "platforms",
        visualNovel({ platforms: ["PC"] }),
        visualNovel({ platforms: ["PC", "Nintendo Switch"] }),
      ),
    ).toMatchObject({ status: "partial", hint: "more" });
  });

  it("uses yellow for announced but unaired adaptations and never for age", () => {
    expect(
      compareField(
        "animeAdaptation",
        visualNovel({ animeAdaptation: "announced" }),
        visualNovel({ animeAdaptation: "has_adaptation" }),
      ).status,
    ).toBe("partial");
    expect(
      compareField(
        "animeAdaptation",
        visualNovel({ animeAdaptation: "announced" }),
        visualNovel({ animeAdaptation: "announced" }),
      ).status,
    ).toBe("partial");
    expect(
      compareField(
        "ageRating",
        visualNovel({ ageRating: "all_ages" }),
        visualNovel({ ageRating: "restricted" }),
      ).status,
    ).toBe("miss");
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

describe("compareTitle", () => {
  it("marks related VNDB entries as the same series", () => {
    expect(
      compareTitle(
        visualNovel({ id: "a", seriesIds: ["vndb:v1", "vndb:v2"] }),
        visualNovel({ id: "b", seriesIds: ["vndb:v2", "vndb:v3"] }),
      ),
    ).toBe("partial");
    expect(
      compareTitle(visualNovel({ id: "a" }), visualNovel({ id: "a" })),
    ).toBe("exact");
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
