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
    isOtome: false,
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
  visualNovel("4", "Senren * Banka", ["Yuzusoft"], ["千恋＊万花"]),
  visualNovel("5", "A Hook Game", ["HOOKSOFT"]),
  visualNovel("6", "Key", ["VisualArt's"]),
  visualNovel("7", "Yosuga no Sora", ["Sphere"], ["Yosusora"]),
];

describe("searchCatalog", () => {
  it("matches normalized aliases and tolerates a title typo", () => {
    expect(searchCatalog(catalog, "时空 轮回")[0]?.id).toBe("1");
    expect(searchCatalog(catalog, "CLANAD")[0]?.id).toBe("3");
    expect(searchCatalog(catalog, "千恋花")[0]?.id).toBe("4");
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

  it("keeps exact developer and alias matches ahead of fuzzy noise", () => {
    const developerResults = searchCatalog(catalog, "Yuzusoft");
    expect(developerResults.map((item) => item.id)).toEqual(["4"]);
    expect(developerResults[0]?.match).toEqual({
      type: "developer",
      value: "Yuzusoft",
    });
    expect(searchCatalog(catalog, "千恋万花")[0]?.id).toBe("4");
  });

  it("fuzzy-matches developer names", () => {
    const results = searchCatalog(catalog, "Yuzusfot");
    expect(results.map((item) => item.id)).toEqual(["4"]);
    expect(results[0]?.match).toEqual({
      type: "developer",
      value: "Yuzusoft",
    });
  });

  it("places title matches before developer matches", () => {
    const results = searchCatalog(catalog, "Key");
    expect(results.map((item) => item.id)).toEqual(["6", "3"]);
    expect(results.map((item) => item.match.type)).toEqual([
      "title",
      "developer",
    ]);
  });
});

describe("searchCatalog language priority", () => {
  it("orders Chinese matches above Japanese at equal relevance", () => {
    const catalog = [
      visualNovel("ja", "Neko no Tsuki", ["Dev"], ["猫の月"]),
      visualNovel("zh", "Mao Ri Yue", ["Dev"], ["猫日月"]),
    ];
    // 两者都在 index 0 命中「猫」，长度同为 3，分数相同（798）→ 中文优先。
    const results = searchCatalog(catalog, "猫");
    expect(results.map((item) => item.id)).toEqual(["zh", "ja"]);
    expect(results[0]?.match.value).toBe("猫日月");
  });

  it("prefers the Chinese alias within one entry when scores tie", () => {
    const catalog = [visualNovel("1", "Neko", ["Dev"], ["猫の日", "猫日月"])];
    const results = searchCatalog(catalog, "猫");
    expect(results[0]?.match.value).toBe("猫日月");
  });
});
