import { requestJson, type FetchLike } from "./http.js";
import type { PagedResult, SourceVisualNovel } from "./types.js";

interface VndbTitle {
  title: string;
  lang: string;
  main: boolean;
}

interface VndbTag {
  id: string;
  name: string;
  rating: number;
  spoiler: number;
  category: "cont" | "ero" | "tech";
}

interface VndbVisualNovel {
  id: string;
  title: string;
  alttitle: string | null;
  titles: VndbTitle[];
  released: string | null;
  developers: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; name: string; role: string }>;
  length: number | null;
  languages: string[];
  platforms: string[];
  rating: number | null;
  votecount: number;
  popularity: number | null;
  tags: VndbTag[];
}

interface VndbResponse {
  results: VndbVisualNovel[];
  more: boolean;
}

interface VndbRelease {
  minage: number | null;
  has_ero: boolean;
  official: boolean;
  vns: Array<{ id: string }>;
}

interface VndbReleaseResponse {
  results: VndbRelease[];
  more: boolean;
}

interface VndbAnimeResponse {
  results: Array<{ id: string }>;
  more: boolean;
}

export interface VndbClientOptions {
  baseUrl?: string;
  fetcher?: FetchLike;
}

export class VndbClient {
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;

  constructor(options: VndbClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://api.vndb.org/kana";
    this.fetcher = options.fetcher ?? fetch;
  }

  async listVisualNovels(
    page = 1,
    pageSize = 100,
  ): Promise<PagedResult<SourceVisualNovel>> {
    const response = await requestJson<VndbResponse>(
      this.fetcher,
      `${this.baseUrl}/vn`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: ["id", ">=", "v1"],
          fields:
            "id,title,alttitle,titles{title,lang,main},released,developers{id,name},staff{id,name,role},length,languages,platforms,rating,votecount,popularity,tags{id,name,rating,spoiler,category}",
          sort: "id",
          results: Math.min(100, Math.max(1, pageSize)),
          page,
        }),
      },
    );

    const visualNovelIds = response.results.map((item) => item.id);
    const ageRatings = await this.loadAgeRatings(visualNovelIds);
    const animeAdaptations = await this.loadAnimeAdaptations(visualNovelIds);
    return {
      items: response.results.map((item) =>
        this.normalize(
          item,
          ageRatings.get(item.id) ?? "unknown",
          animeAdaptations.has(item.id) ? "has_adaptation" : "none",
        ),
      ),
      hasMore: response.more,
      nextCursor: response.more ? String(page + 1) : null,
    };
  }

  private async loadAnimeAdaptations(
    visualNovelIds: string[],
  ): Promise<Set<string>> {
    if (visualNovelIds.length === 0) return new Set();
    const idFilter =
      visualNovelIds.length === 1
        ? ["id", "=", visualNovelIds[0]]
        : ["or", ...visualNovelIds.map((id) => ["id", "=", id])];
    const response = await requestJson<VndbAnimeResponse>(
      this.fetcher,
      `${this.baseUrl}/vn`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: ["and", idFilter, ["has_anime", "=", 1]],
          fields: "id",
          results: 100,
        }),
      },
    );
    return new Set(response.results.map((item) => item.id));
  }

  private async loadAgeRatings(
    visualNovelIds: string[],
  ): Promise<Map<string, "all_ages" | "restricted" | "unknown">> {
    const states = new Map<
      string,
      { hasAllAgesRelease: boolean; restricted: boolean }
    >(
      visualNovelIds.map((id) => [
        id,
        { hasAllAgesRelease: false, restricted: false },
      ]),
    );
    if (visualNovelIds.length === 0) return new Map();
    const vnFilter =
      visualNovelIds.length === 1
        ? ["id", "=", visualNovelIds[0]]
        : ["or", ...visualNovelIds.map((id) => ["id", "=", id])];

    for (let page = 1; ; page += 1) {
      const response = await requestJson<VndbReleaseResponse>(
        this.fetcher,
        `${this.baseUrl}/release`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filters: ["vn", "=", vnFilter],
            fields: "minage,has_ero,official,vns{id}",
            results: 100,
            page,
          }),
        },
      );
      for (const release of response.results) {
        if (!release.official) continue;
        for (const vn of release.vns) {
          const state = states.get(vn.id);
          if (!state) continue;
          if (
            release.has_ero ||
            (release.minage != null && release.minage > 0)
          ) {
            state.restricted = true;
          } else if (release.minage === 0) {
            state.hasAllAgesRelease = true;
          }
        }
      }
      if (!response.more) break;
    }

    return new Map(
      [...states].map(([id, state]) => [
        id,
        state.restricted
          ? "restricted"
          : state.hasAllAgesRelease
            ? "all_ages"
            : "unknown",
      ]),
    );
  }

  private normalize(
    item: VndbVisualNovel,
    ageRating: "all_ages" | "restricted" | "unknown",
    animeAdaptation: "none" | "has_adaptation",
  ): SourceVisualNovel {
    const alternativeTitles = [
      item.alttitle,
      ...item.titles.map((title) => title.title),
    ]
      .filter((title): title is string =>
        Boolean(title && title !== item.title),
      )
      .filter((title, index, all) => all.indexOf(title) === index);

    return {
      source: "vndb",
      sourceId: item.id,
      title: item.title,
      alternativeTitles,
      releaseDate: item.released,
      developers: item.developers.map((developer) => developer.name),
      scenarioWriters: item.staff
        .filter((staff) => staff.role === "scenario")
        .map((staff) => staff.name),
      playtime:
        item.length != null && [1, 2, 3, 4, 5].includes(item.length)
          ? (item.length as 1 | 2 | 3 | 4 | 5)
          : null,
      platforms: item.platforms,
      languages: item.languages,
      rating: item.rating == null ? null : item.rating / 10,
      voteCount: item.votecount,
      popularity: item.popularity,
      animeAdaptation,
      ageRating,
      tags: item.tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        score: tag.rating,
        spoilerLevel: Math.min(2, Math.max(0, tag.spoiler)) as 0 | 1 | 2,
        category: tag.category,
      })),
      raw: item,
      fetchedAt: new Date().toISOString(),
    };
  }
}
