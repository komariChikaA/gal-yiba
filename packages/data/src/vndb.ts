import { requestJson, type FetchLike } from "./http.js";
import type {
  PagedResult,
  SourceHeroineHairColor,
  SourceVisualNovel,
} from "./types.js";

const hairColorByTraitId: Record<string, SourceHeroineHairColor> = {
  i4: "black",
  i5: "blond",
  i7: "blue",
  i6: "brown",
  i919: "cyan",
  i50: "green",
  i956: "grey",
  i894: "multicolored",
  i1305: "orange",
  i8: "pink",
  i10: "red",
  i926: "teal",
  i9: "violet",
  i11: "white",
};

const hairColorOrder = new Map(
  Object.values(hairColorByTraitId).map((color, index) => [color, index]),
);

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

interface VndbCharacter {
  id: string;
  name: string;
  sex: [string | null, string | null] | null;
  vns: Array<{ id: string; role: string; spoiler: number }>;
  traits: Array<{
    id: string;
    name: string;
    group_name: string;
    spoiler: number;
    lie: boolean;
  }>;
}

interface VndbCharacterResponse {
  results: VndbCharacter[];
  more: boolean;
}

interface HeroineHairEvidence {
  colors: SourceHeroineHairColor[];
  characters: Array<{
    id: string;
    name: string;
    colors: SourceHeroineHairColor[];
  }>;
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
    const heroineHair = await this.loadHeroineHairColors(visualNovelIds);
    return {
      items: response.results.map((item) =>
        this.normalize(
          item,
          ageRatings.get(item.id) ?? "unknown",
          animeAdaptations.has(item.id) ? "has_adaptation" : "none",
          heroineHair.get(item.id),
        ),
      ),
      hasMore: response.more,
      nextCursor: response.more ? String(page + 1) : null,
    };
  }

  private async loadHeroineHairColors(
    visualNovelIds: string[],
  ): Promise<Map<string, HeroineHairEvidence>> {
    const charactersByVisualNovel = new Map<
      string,
      Map<string, HeroineHairEvidence["characters"][number]>
    >();
    const colorTraitFilters = Object.keys(hairColorByTraitId).map((id) => [
      "trait",
      "=",
      [id, 0],
    ]);

    for (let offset = 0; offset < visualNovelIds.length; offset += 20) {
      const ids = visualNovelIds.slice(offset, offset + 20);
      const idSet = new Set(ids);
      const idFilter =
        ids.length === 1
          ? ["id", "=", ids[0]]
          : ["or", ...ids.map((id) => ["id", "=", id])];

      for (let page = 1; ; page += 1) {
        const response = await requestJson<VndbCharacterResponse>(
          this.fetcher,
          `${this.baseUrl}/character`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              filters: [
                "and",
                ["vn", "=", idFilter],
                ["sex", "=", "f"],
                ["role", "=", "primary"],
                ["or", ...colorTraitFilters],
              ],
              fields:
                "name,sex,vns{id,role,spoiler},traits{id,name,group_name,spoiler,lie}",
              results: 100,
              page,
            }),
          },
        );

        for (const character of response.results) {
          if (character.sex?.[0] !== "f") continue;
          const colors = [
            ...new Set(
              character.traits
                .filter((trait) => trait.spoiler === 0 && !trait.lie)
                .map((trait) => hairColorByTraitId[trait.id])
                .filter(
                  (color): color is SourceHeroineHairColor => color != null,
                ),
            ),
          ].sort(
            (left, right) =>
              (hairColorOrder.get(left) ?? 99) -
              (hairColorOrder.get(right) ?? 99),
          );
          if (colors.length === 0) continue;

          for (const relation of character.vns) {
            if (
              !idSet.has(relation.id) ||
              relation.role !== "primary" ||
              relation.spoiler !== 0
            )
              continue;
            const characters =
              charactersByVisualNovel.get(relation.id) ?? new Map();
            characters.set(character.id, {
              id: character.id,
              name: character.name,
              colors,
            });
            charactersByVisualNovel.set(relation.id, characters);
          }
        }
        if (!response.more) break;
      }
    }

    return new Map(
      [...charactersByVisualNovel].map(([visualNovelId, characters]) => {
        const values = [...characters.values()];
        const colors = [...new Set(values.flatMap((item) => item.colors))].sort(
          (left, right) =>
            (hairColorOrder.get(left) ?? 99) -
            (hairColorOrder.get(right) ?? 99),
        );
        return [visualNovelId, { colors, characters: values }];
      }),
    );
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
    heroineHair?: HeroineHairEvidence,
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
      heroineHairColors: heroineHair?.colors ?? [],
      animeAdaptation,
      ageRating,
      tags: item.tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        score: tag.rating,
        spoilerLevel: Math.min(2, Math.max(0, tag.spoiler)) as 0 | 1 | 2,
        category: tag.category,
      })),
      raw: {
        visualNovel: item,
        heroineHairEvidence: heroineHair?.characters ?? [],
      },
      fetchedAt: new Date().toISOString(),
    };
  }
}
