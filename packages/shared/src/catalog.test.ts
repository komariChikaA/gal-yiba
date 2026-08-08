import { describe, expect, it } from "vitest";
import {
  normalizeComparisonPlatforms,
  selectImportantTags,
} from "./catalog.js";

describe("normalizeComparisonPlatforms", () => {
  it("groups PC and console families while dropping mobile and web ports", () => {
    expect(
      normalizeComparisonPlatforms([
        "win",
        "lin",
        "and",
        "ios",
        "web",
        "ps4",
        "ps5",
        "swi",
        "xone",
      ]),
    ).toEqual(["PC", "PlayStation", "Nintendo Switch", "Xbox"]);
  });

  it("keeps mobile and web platforms when they are the only choices", () => {
    expect(normalizeComparisonPlatforms(["and", "ios", "web"])).toEqual([
      "Android",
      "iOS",
      "Web",
    ]);
  });
});

describe("selectImportantTags", () => {
  it("filters spoilers before selecting the three highest-scored tags", () => {
    const tags = selectImportantTags(
      [
        { name: "Romance", spoilerLevel: 0, score: 2.1 },
        { name: "Comedy", spoilerLevel: 0, score: 2.8 },
        { name: "School", spoilerLevel: 0, score: 2.5 },
        { name: "Drama", spoilerLevel: 0, score: 2.4 },
        { name: "True Ending", spoilerLevel: 2, score: 3 },
      ],
      [],
      0,
    );
    expect(tags.map((tag) => tag.name)).toEqual(["Comedy", "School", "Drama"]);
  });
});
