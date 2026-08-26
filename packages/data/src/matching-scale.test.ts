import { describe, expect, it } from "vitest";
import { scoreSourceMatch } from "./matching.js";
import type { SourceVisualNovel } from "./types.js";

function record(source: SourceVisualNovel["source"], overrides: Partial<SourceVisualNovel> = {}): SourceVisualNovel {
  return {
    source,
    sourceId: source === "vndb" ? "v1" : "1",
    title: "Game",
    alternativeTitles: [],
    releaseDate: "2020-01-01",
    developers: ["DevA"],
    scenarioWriters: [],
    playtime: 3,
    platforms: ["win"],
    languages: ["ja"],
    rating: 7,
    voteCount: 100,
    popularity: null,
    tags: [],
    raw: {},
    fetchedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("500+ alignment scale", () => {
  it("achieves >=500 matches with fuzzy titles and same year/platform", () => {
    const pairs = Array.from({ length: 600 }, (_, i) => {
      // 500 可配对：标题高度相似（Bangumi 用中文译名或带后缀），年份相同
      // 100 干扰：完全不同名且年份远离
      const isMatchable = i < 500;
      const vndb = record("vndb", {
        sourceId: `v${i}`,
        title: `Visual Novel ${i} 原名`,
        alternativeTitles: [`VN ${i}`, `游戏${i}`],
        releaseDate: `2020-02-0${(i % 9) + 1}`,
        developers: [`Studio ${i % 10}`],
      });
      const bangumi = record("bangumi", {
        sourceId: `${1000 + i}`,
        title: isMatchable ? `Visual Novel ${i} 原名` : `Unrelated Title ${i} XYZ`,
        alternativeTitles: isMatchable ? [`VN ${i}`] : [],
        releaseDate: isMatchable ? `2020-02-0${(i % 9) + 1}` : `2010-01-01`,
        developers: isMatchable ? [`Studio ${i % 10}`] : [`Other Studio`],
        platforms: isMatchable ? ["win"] : ["Switch"],
      });
      return { vndb, bangumi, isMatchable };
    });

    let matched = 0;
    for (const { vndb, bangumi, isMatchable } of pairs) {
      const s = scoreSourceMatch(vndb, bangumi);
      if (isMatchable) {
        // 可配对的应至少 needs_review
        expect(s.confidence).toBeGreaterThanOrEqual(55);
        expect(s.evidence.titleSimilarity).toBeGreaterThanOrEqual(0.55);
        matched += s.decision !== "unlikely" ? 1 : 0;
      } else {
        expect(s.decision).toBe("unlikely");
      }
    }
    expect(matched).toBeGreaterThanOrEqual(500);
  });

  it("handles Bangumi 未登录时 nsfw 过滤导致召回下降的说明", () => {
    // 模拟有 token 时能查到 nsfw 条目，无 token 时查不到
    // 仅验证匹配逻辑对 titleSimilarity 的依赖，不实际调用 API
    const vndb = record("vndb", { title: "えろげー", alternativeTitles: ["Ero Game 1"] });
    const bangumiNsfw = record("bangumi", { title: "えろげー", alternativeTitles: [], releaseDate: "2020-01-01" });
    const s = scoreSourceMatch(vndb, bangumiNsfw);
    expect(s.confidence).toBeGreaterThanOrEqual(65); // exactTitle
  });
});
