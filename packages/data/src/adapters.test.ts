import { describe, expect, it, vi } from "vitest";
import { BangumiClient } from "./bangumi.js";
import { VndbClient } from "./vndb.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("VndbClient", () => {
  it("normalizes VNDB's 10–100 rating scale to 1–10", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          more: false,
          results: [
            {
              id: "v17",
              title: "Ever17",
              alttitle: null,
              titles: [{ title: "Ever17", lang: "ja", main: true }],
              released: "2002-08-29",
              developers: [{ id: "p1", name: "KID" }],
              staff: [{ id: "s1", name: "Writer", role: "scenario" }],
              length: 4,
              languages: ["ja"],
              platforms: ["win"],
              rating: 82,
              votecount: 3000,
              popularity: 12.5,
              tags: [
                {
                  id: "g7",
                  name: "Science Fiction",
                  rating: 2.8,
                  spoiler: 0,
                  category: "cont",
                },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          more: false,
          results: [
            {
              minage: 18,
              has_ero: true,
              official: true,
              vns: [{ id: "v17" }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          more: false,
          results: [{ id: "v17" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          more: false,
          results: [
            {
              id: "c1",
              name: "Primary Heroine",
              sex: ["f", "f"],
              vns: [{ id: "v17", role: "primary", spoiler: 0 }],
              traits: [
                {
                  id: "i6",
                  name: "Brown",
                  group_name: "Hair",
                  spoiler: 0,
                  lie: false,
                },
                {
                  id: "i7",
                  name: "Blue",
                  group_name: "Hair",
                  spoiler: 0,
                  lie: false,
                },
                {
                  id: "i10",
                  name: "Red",
                  group_name: "Hair",
                  spoiler: 1,
                  lie: false,
                },
              ],
            },
            {
              id: "c2",
              name: "Side Character",
              sex: ["f", "f"],
              vns: [{ id: "v17", role: "side", spoiler: 0 }],
              traits: [
                {
                  id: "i8",
                  name: "Pink",
                  group_name: "Hair",
                  spoiler: 0,
                  lie: false,
                },
              ],
            },
          ],
        }),
      );
    const page = await new VndbClient({ fetcher }).listVisualNovels();
    expect(page.items[0]?.rating).toBe(8.2);
    expect(page.items[0]?.sourceId).toBe("v17");
    expect(page.items[0]?.developers).toEqual(["KID"]);
    expect(page.items[0]?.ageRating).toBe("restricted");
    expect(page.items[0]?.animeAdaptation).toBe("has_adaptation");
    expect(page.items[0]?.heroineHairColors).toEqual(["blue", "brown"]);
    expect(page.items[0]?.tags[0]?.category).toBe("cont");
    expect(fetcher.mock.calls[1]?.[0]).toContain("/release");
    expect(fetcher.mock.calls[2]?.[0]).toContain("/vn");
    expect(fetcher.mock.calls[2]?.[1]?.body).toContain('"has_anime"');
    expect(fetcher.mock.calls[3]?.[0]).toContain("/character");
    expect(fetcher.mock.calls[3]?.[1]?.body).toContain('"primary"');
    expect(
      (page.items[0]?.raw as { heroineHairEvidence: unknown[] })
        .heroineHairEvidence,
    ).toHaveLength(1);
  });
});

describe("BangumiClient", () => {
  it("sends an identifiable User-Agent and only searches game subjects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        total: 1,
        limit: 20,
        offset: 0,
        data: [
          {
            id: 123,
            name: "サンプル",
            name_cn: "示例",
            date: "2020-01-01",
            platform: "PC",
            nsfw: false,
            rating: { score: 7.4, total: 100 },
            tags: [{ name: "Galgame", count: 80 }],
          },
        ],
      }),
    );
    const client = new BangumiClient({
      userAgent: "GalYiBa/0.1 (https://example.test)",
      fetcher,
    });
    const page = await client.searchGames("示例");
    const request = fetcher.mock.calls[0];
    expect(
      (request?.[1]?.headers as Record<string, string>)["user-agent"],
    ).toContain("GalYiBa");
    expect(request?.[1]?.body).toContain('"type":[4]');
    expect(page.items[0]?.title).toBe("示例");
    expect(page.items[0]?.ageRating).toBe("unknown");
  });
});
