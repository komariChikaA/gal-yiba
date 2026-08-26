import { describe, expect, it } from "vitest";
import { scoreWithNetworkTitles } from "./network-matching.js";
import { scoreSourceMatch } from "./matching.js";
import type { SourceVisualNovel } from "./types.js";

function record(
  source: SourceVisualNovel["source"],
  overrides: Partial<SourceVisualNovel> = {},
): SourceVisualNovel {
  return {
    source,
    sourceId: source === "vndb" ? "v17" : "123",
    title: "Ever17 -the out of infinity-",
    alternativeTitles: ["Ever17"],
    releaseDate: "2002-08-29",
    developers: ["KID"],
    scenarioWriters: [],
    playtime: 4,
    platforms: ["win"],
    languages: ["ja"],
    rating: 8,
    voteCount: 100,
    popularity: null,
    tags: [],
    raw: {},
    fetchedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("scoreWithNetworkTitles", () => {
  it("boosts confidence when network titles overlap both sides", () => {
    // 故意让平台不重叠，使 base <100，便于观察网络提升
    const left = record("vndb", { platforms: ["win"] });
    const right = record("bangumi", { platforms: ["Switch"] });
    const base = scoreSourceMatch(left, right);
    expect(base.confidence).toBeLessThan(100);
    const boosted = scoreWithNetworkTitles(left, right, ["Ever17", "Ever17  -the out of infinity-"]);
    expect(boosted.confidence).toBeGreaterThan(base.confidence);
    expect(boosted.decision).toBe("strong_candidate");
  });
  it("does not boost when no networkTitles", () => {
    const base = scoreSourceMatch(record("vndb"), record("bangumi"));
    const boosted = scoreWithNetworkTitles(record("vndb"), record("bangumi"), []);
    expect(boosted.confidence).toBe(base.confidence);
  });
  it("still unlikely when year far and no boost enough", () => {
    const boosted = scoreWithNetworkTitles(
      record("vndb"),
      record("bangumi", { releaseDate: "2030-01-01", platforms: ["Switch"] }),
      ["Irrelevant Title"],
    );
    expect(boosted.decision).toBe("unlikely");
  });
});
