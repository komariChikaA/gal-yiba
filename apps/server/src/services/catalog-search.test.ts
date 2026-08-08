import { describe, expect, it } from "vitest";
import type { VisualNovel } from "@gal-yiba/shared";
import { searchCatalog } from "./catalog-search.js";

function visualNovel(
  id: string,
  title: string,
  developer: string[],
  aliases: string[] = [],
): VisualNovel {
  return {
    id,
    title,
    aliases,
    developer,
    publisher: null,
    scenarioWriter: null,
    heroineHairColor: null,
    releaseYear: 2002,
    playtime: "long",
    vndbRating: 8.2,
    bangumiRating: 8,
    vndbVoteCount: 3_000,
    bangumiVoteCount: 1_500,
    animeAdaptation: null,
    ageRating: null,
    platforms: ["windows"],
    languages: ["ja"],
    tags: ["Mystery"],
    provenance: {},
  };
}

const catalog = [
  visualNovel("1", "Ever17 -the out of infinity-", ["KID"], ["时空轮回"]),
  visualNovel("2", "Remember11", ["KID"]),
  visualNovel("3", "CLANNAD", ["Key"]),
];

describe("searchCatalog", () => {
  it("matches normalized aliases and tolerates a title typo", () => {
    expect(searchCatalog(catalog, "时空 轮回")[0]?.id).toBe("1");
    expect(searchCatalog(catalog, "CLANAD")[0]?.id).toBe("3");
  });

  it("returns every matching developer game with an explicit match reason", () => {
    const results = searchCatalog(catalog, "KID");
    expect(results.map((item) => item.id)).toEqual(["1", "2"]);
    expect(results.every((item) => item.match.type === "developer")).toBe(true);
    expect(results[0]?.match.value).toBe("KID");
  });

  it("does not return unrelated short-query noise", () => {
    expect(searchCatalog(catalog, "ZZ")).toEqual([]);
  });
});
