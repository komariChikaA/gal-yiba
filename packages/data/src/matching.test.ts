import { describe, expect, it } from "vitest";
import { normalizeTitle, scoreSourceMatch } from "./matching.js";
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
    platforms: ["PC"],
    languages: [],
    rating: 8,
    voteCount: 100,
    popularity: null,
    tags: [],
    raw: {},
    fetchedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeTitle", () => {
  it("normalizes width, punctuation, case and whitespace", () => {
    expect(normalizeTitle("Ｅｖｅｒ１７： The Out-of-Infinity ")).toBe(
      "ever17theoutofinfinity",
    );
  });
});

describe("scoreSourceMatch", () => {
  it("marks matching cross-source title, year and platform as strong", () => {
    const result = scoreSourceMatch(
      record("vndb"),
      record("bangumi", { title: "Ever17" }),
    );
    expect(result.decision).toBe("strong_candidate");
    expect(result.confidence).toBe(100);
  });

  it("treats a same-title entry from a distant year and different platform as unlikely", () => {
    const result = scoreSourceMatch(
      record("vndb"),
      record("bangumi", {
        title: "Ever17",
        releaseDate: "2030-01-01",
        platforms: ["Switch"],
      }),
    );
    expect(result.decision).toBe("unlikely");
    expect(result.confidence).toBeLessThan(85);
  });

  it("rejects comparing records from the same source", () => {
    expect(() => scoreSourceMatch(record("vndb"), record("vndb"))).toThrow(
      "CROSS_SOURCE_RECORDS_REQUIRED",
    );
  });
});
