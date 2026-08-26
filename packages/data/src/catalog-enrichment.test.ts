import { describe, expect, it } from "vitest";
import { CatalogEnricher, applyEnrichmentToRecord } from "./catalog-enrichment.js";
import { MockWebSearchProvider } from "./web-search.js";
import type { SourceVisualNovel } from "./types.js";

function record(overrides: Partial<SourceVisualNovel> = {}): SourceVisualNovel {
  return {
    source: "vndb",
    sourceId: "v999",
    title: "Test Gal",
    alternativeTitles: [],
    releaseDate: "2020-01-01",
    developers: ["TestDev"],
    scenarioWriters: [],
    playtime: 3,
    platforms: ["win"],
    languages: [],
    rating: 7,
    voteCount: 200,
    popularity: null,
    tags: [],
    raw: {},
    fetchedAt: "2026-08-08T00:00:00.000Z",
    isOtome: false,
    ...overrides,
  };
}

describe("CatalogEnricher", () => {
  it("enriches empty languages to china when search evidence contains 国产", async () => {
    const fixture = new Map([
      ["test gal 乙女 游戏", [{ title: "Test Gal 乙女", url: "https://example.com", snippet: "乙女游戏 女性向" }]],
      ["test gal otome game", [{ title: "Test Gal", url: "https://example.com", snippet: "otome game" }]],
      ["test gal testdev 国产 欧美", [{ title: "Test Gal", url: "https://example.com", snippet: "国产 Galgame 中国制作" }]],
      ["test gal visual novel 中国 制作", [{ title: "Test Gal", url: "https://example.com", snippet: "国产 中文原创" }]],
    ]);
    const search = new MockWebSearchProvider(fixture);
    const enricher = new CatalogEnricher(search);
    const result = await enricher.enrich(record({ languages: [] }));
    expect(result.region).toBe("china");
    expect(result.confidence.region).toBeGreaterThanOrEqual(60);
  });

  it("does not overwrite true otome with false", async () => {
    const fixture = new Map([
      ["test gal 乙女 游戏", [{ title: "Test Gal", url: "https://example.com", snippet: "校园 恋爱" }]],
    ]);
    const search = new MockWebSearchProvider(fixture);
    const enricher = new CatalogEnricher(search);
    const result = await enricher.enrich(record({ isOtome: true, tags: [{ id: "g542", name: "Otome Game", spoilerLevel: 0 }] }));
    // 已是 otome 则保持 true（CatalogEnricher 强制保留）
    expect(result.isOtome).toBe(true);
  });

  it("returns null when no search provider", async () => {
    const enricher = new CatalogEnricher(null);
    const result = await enricher.enrich(record());
    expect(result.isOtome).toBeNull();
    expect(result.region).toBeNull();
  });

  it("applyEnrichmentToRecord modifies languages accordingly", () => {
    const base = record({ languages: [] });
    const enriched = applyEnrichmentToRecord(base, {
      isOtome: true,
      region: "china",
      confidence: { otome: 85, region: 85 },
      evidence: { searchQueries: [], searchResults: [] },
    });
    expect(enriched.isOtome).toBe(true);
    expect(enriched.languages).toEqual(["zh"]);
  });
});
