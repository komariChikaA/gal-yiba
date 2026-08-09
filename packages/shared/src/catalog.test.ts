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
        "vnd",
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
    expect(tags.map((tag) => tag.name)).toEqual(["喜剧", "校园", "剧情"]);
  });

  it("unifies source aliases and omits technical, adult and overly detailed tags", () => {
    const tags = selectImportantTags(
      [
        { name: "Sci-Fi", spoilerLevel: 0, score: 2.8, category: "cont" },
        { name: "科幻", spoilerLevel: 0, score: 12, category: "cont" },
        { name: "School", spoilerLevel: 0, score: 2.5, category: "cont" },
        {
          name: "Big Breast Sizes Heroine",
          spoilerLevel: 0,
          score: 3,
          category: "cont",
        },
        { name: "Sexual Content", spoilerLevel: 0, score: 3, category: "ero" },
        { name: "ADV", spoilerLevel: 0, score: 3, category: "tech" },
      ],
      [],
      0,
    );
    expect(tags.map((tag) => tag.name)).toEqual(["科幻", "校园"]);
  });

  it("keeps the VNDB otome classification as a representative audience tag", () => {
    const tags = selectImportantTags(
      [
        {
          id: "g542",
          name: "Otome Game",
          spoilerLevel: 0,
          score: 2.7,
          category: "tech",
        },
        { name: "ADV", spoilerLevel: 0, score: 3, category: "tech" },
      ],
      [],
      0,
    );
    expect(tags.map((tag) => tag.name)).toEqual(["乙女"]);
  });
});
