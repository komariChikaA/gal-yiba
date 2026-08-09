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
              aliases: ["Ever 17 alias"],
              titles: [{ title: "Ever17", lang: "ja", main: true }],
              released: "2002-08-29",
              developers: [{ id: "p1", name: "KID" }],
              staff: [
                {
                  id: "s1",
                  name: "Maeda Jun",
                  original: "麻枝 准",
                  lang: "ja",
                  role: "scenario",
                },
              ],
              relations: [
                {
                  id: "v13",
                  relation: "ser",
                  relation_official: true,
                },
              ],
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
              released: "2001-01-01",
              minage: 0,
              has_ero: false,
              official: true,
              platforms: ["win"],
              vns: [{ id: "v17", rtype: "trial" }],
              producers: [],
            },
            {
              released: "2002-08-29",
              minage: 18,
              has_ero: true,
              official: true,
              platforms: ["win"],
              vns: [{ id: "v17", rtype: "complete" }],
              producers: [
                {
                  id: "p2",
                  name: "Publisher",
                  developer: false,
                  publisher: true,
                },
              ],
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
    expect(page.items[0]?.scenarioWriters).toEqual(["麻枝准"]);
    expect(page.items[0]?.alternativeTitles).toContain("Ever 17 alias");
    expect(page.items[0]?.releaseDate).toBe("2002-08-29");
    expect(page.items[0]?.publisherIds).toEqual(["p2"]);
    expect(page.items[0]?.publishers).toEqual(["Publisher"]);
    expect(page.items[0]?.ageRating).toBe("restricted");
    expect(page.items[0]?.animeAdaptation).toBe("has_adaptation");
    expect(page.items[0]?.heroineHairColors).toEqual(["blue", "brown"]);
    expect(page.items[0]?.seriesIds).toEqual(["v17", "v13"]);
    expect(page.items[0]?.tags[0]?.category).toBe("cont");
    expect(fetcher.mock.calls[1]?.[0]).toContain("/release");
    expect(fetcher.mock.calls[1]?.[1]?.body).toContain("rtype");
    expect(fetcher.mock.calls[2]?.[0]).toContain("/vn");
    expect(fetcher.mock.calls[2]?.[1]?.body).toContain('"has_anime"');
    expect(fetcher.mock.calls[3]?.[0]).toContain("/character");
    expect(fetcher.mock.calls[3]?.[1]?.body).toContain('"primary"');
    expect(fetcher.mock.calls[0]?.[1]?.body).toContain(
      "staff{id,name,original,lang,role}",
    );
    expect(
      (page.items[0]?.raw as { heroineHairEvidence: unknown[] })
        .heroineHairEvidence,
    ).toHaveLength(1);
  });

  it("resolves an exact producer and lists all of its visual novels", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          more: false,
          results: [
            {
              id: "p98",
              name: "Yuzusoft",
              original: "ゆずソフト",
              aliases: ["柚子社"],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          more: false,
          results: [
            {
              id: "v19073",
              title: "Senren * Banka",
              alttitle: "千恋＊万花",
              aliases: ["千恋万花"],
              titles: [],
              released: "2016-07-29",
              developers: [{ id: "p98", name: "Yuzusoft" }],
              staff: [],
              length: 4,
              languages: ["ja", "zh-Hans"],
              platforms: ["win"],
              rating: 79,
              votecount: 9000,
              popularity: 20,
              tags: [],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ more: false, results: [] }))
      .mockResolvedValueOnce(jsonResponse({ more: false, results: [] }))
      .mockResolvedValueOnce(jsonResponse({ more: false, results: [] }));

    const page = await new VndbClient({ fetcher }).listVisualNovelsByDeveloper(
      "柚子社",
    );
    expect(page.items.map((item) => item.sourceId)).toEqual(["v19073"]);
    expect(page.items[0]?.alternativeTitles).toContain("千恋万花");
    expect(fetcher.mock.calls[0]?.[0]).toContain("/producer");
    expect(fetcher.mock.calls[0]?.[1]?.body).toContain('"search","=","柚子社"');
    expect(fetcher.mock.calls[1]?.[1]?.body).toContain(
      '"developer","=",["id","=","p98"]',
    );
  });

  it("refreshes an explicit set of VNDB ids without broadening the catalog", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          more: false,
          results: [
            {
              id: "v19073",
              title: "Senren * Banka",
              alttitle: "千恋＊万花",
              aliases: [],
              titles: [],
              released: "2016-07-29",
              developers: [{ id: "p98", name: "Yuzusoft" }],
              staff: [],
              relations: [],
              length: 3,
              languages: ["ja"],
              platforms: ["win"],
              rating: 78,
              votecount: 1_000,
              popularity: 20,
              tags: [],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ more: false, results: [] }))
      .mockResolvedValueOnce(jsonResponse({ more: false, results: [] }))
      .mockResolvedValueOnce(jsonResponse({ more: false, results: [] }));

    const page = await new VndbClient({ fetcher }).getVisualNovelsByIds([
      "v19073",
      "invalid",
      "v19073",
    ]);
    expect(page.items.map((item) => item.sourceId)).toEqual(["v19073"]);
    expect(fetcher.mock.calls[0]?.[1]?.body).toContain(
      '"filters":["id","=","v19073"]',
    );
  });

  it("uses non-erotic 15+ evidence when console and PC ratings differ", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          more: false,
          results: [
            {
              id: "v15",
              title: "Rated Example",
              alttitle: null,
              aliases: [],
              titles: [],
              released: "2019-01-01",
              developers: [],
              staff: [],
              relations: [],
              length: 2,
              languages: ["ja"],
              platforms: ["win", "ps4"],
              rating: 70,
              votecount: 100,
              popularity: null,
              tags: [],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          more: false,
          results: [
            {
              released: "2018-01-01",
              minage: 0,
              has_ero: false,
              official: true,
              platforms: ["win"],
              vns: [{ id: "v15", rtype: "trial" }],
              producers: [],
            },
            {
              released: "2019-01-01",
              minage: 15,
              has_ero: false,
              official: true,
              platforms: ["win"],
              vns: [{ id: "v15", rtype: "complete" }],
              producers: [],
            },
            {
              released: "2020-01-01",
              minage: 18,
              has_ero: false,
              official: true,
              platforms: ["ps4"],
              vns: [{ id: "v15", rtype: "complete" }],
              producers: [],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ more: false, results: [] }))
      .mockResolvedValueOnce(jsonResponse({ more: false, results: [] }));

    const page = await new VndbClient({ fetcher }).listVisualNovels();
    expect(page.items[0]?.releaseDate).toBe("2019-01-01");
    expect(page.items[0]?.ageRating).toBe("all_ages");
  });
});

describe("BangumiClient", () => {
  it("sends an identifiable User-Agent and only searches game subjects", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
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
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 456,
            type: 2,
            name: "Anime",
            name_cn: "动画",
            relation: "动画化",
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 456,
          name: "Anime",
          name_cn: "动画",
          date: "2099-01-01",
          platform: "TV",
          tags: [],
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
    expect(page.items[0]?.animeAdaptation).toBe("announced");
    expect(fetcher.mock.calls[1]?.[0]).toContain("/subjects/123/subjects");
  });

  it("refreshes Bangumi subjects by verified source id", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 123,
          name: "Sample",
          name_cn: "示例",
          date: "2020-01-01",
          platform: "PC",
          nsfw: false,
          rating: { score: 7.4, total: 100 },
          tags: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]));
    const client = new BangumiClient({
      userAgent: "GalYiBa/0.1 (https://example.test)",
      fetcher,
    });

    const page = await client.getGamesByIds(["123", "bad", "123"]);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.sourceId).toBe("123");
    expect(fetcher.mock.calls[0]?.[0]).toContain("/v0/subjects/123");
    expect(fetcher.mock.calls[1]?.[0]).toContain("/subjects/123/subjects");
  });
});
