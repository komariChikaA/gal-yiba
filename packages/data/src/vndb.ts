import { requestJson, type FetchLike } from "./http.js";
import { normalizeTitle } from "./matching.js";
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

const visualNovelFields =
  "id,title,alttitle,aliases,titles{title,lang,main},released,developers{id,name},staff{id,name,original,lang,role},relations{id,relation,relation_official},length,languages,platforms,rating,votecount,popularity,tags{id,name,rating,spoiler,category}";

export type VndbVisualNovelSort = "id" | "released" | "rating" | "votecount";

export interface VndbListOptions {
  sort?: VndbVisualNovelSort;
  reverse?: boolean;
}

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
  aliases: string[];
  titles: VndbTitle[];
  released: string | null;
  developers: Array<{ id: string; name: string }>;
  staff: Array<{
    id: string;
    name: string;
    original: string | null;
    lang: string;
    role: string;
  }>;
  relations: Array<{
    id: string;
    relation: string;
    relation_official: boolean;
  }>;
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

interface VndbProducer {
  id: string;
  name: string;
  original: string | null;
  aliases: string[];
}

interface VndbProducerResponse {
  results: VndbProducer[];
  more: boolean;
}

interface VndbRelease {
  released: string | null;
  minage: number | null;
  has_ero: boolean;
  official: boolean;
  platforms: string[];
  vns: Array<{ id: string; rtype: "trial" | "partial" | "complete" }>;
  producers: Array<{
    id: string;
    name: string;
    developer: boolean;
    publisher: boolean;
  }>;
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

function displayStaffName(staff: VndbVisualNovel["staff"][number]): string {
  const preferred = staff.original?.trim() || staff.name.trim();
  return staff.lang === "ja" &&
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(preferred)
    ? preferred.replace(/\s+/g, "")
    : preferred;
}

interface ReleaseEvidence {
  releaseDate: string | null;
  ageRating: "all_ages" | "restricted" | "unknown";
  publishers: string[];
  publisherIds: string[];
  releases: Array<{
    released: string | null;
    platforms: string[];
    minage: number | null;
    hasEro: boolean;
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
    options: VndbListOptions = {},
  ): Promise<PagedResult<SourceVisualNovel>> {
    return this.queryVisualNovels(
      ["id", ">=", "v1"],
      page,
      pageSize,
      options.sort ?? "id",
      options.reverse ?? false,
    );
  }

  async searchVisualNovels(
    query: string,
    page = 1,
    pageSize = 100,
  ): Promise<PagedResult<SourceVisualNovel>> {
    if (!query.trim()) throw new Error("VNDB_SEARCH_QUERY_REQUIRED");
    return this.queryVisualNovels(
      ["search", "=", query.trim()],
      page,
      pageSize,
      "searchrank",
      false,
    );
  }

  async getVisualNovelsByIds(
    sourceIds: string[],
  ): Promise<PagedResult<SourceVisualNovel>> {
    const ids = [
      ...new Set(
        sourceIds
          .map((sourceId) => sourceId.trim())
          .filter((sourceId) => /^v\d+$/.test(sourceId)),
      ),
    ].slice(0, 100);
    if (ids.length === 0)
      return { items: [], hasMore: false, nextCursor: null };
    const filters =
      ids.length === 1
        ? ["id", "=", ids[0]]
        : ["or", ...ids.map((id) => ["id", "=", id])];
    return this.queryVisualNovels(filters, 1, ids.length, "id", false);
  }

  async listVisualNovelsByDeveloper(
    query: string,
    page = 1,
    pageSize = 100,
  ): Promise<PagedResult<SourceVisualNovel>> {
    const search = query.trim();
    if (!search) throw new Error("VNDB_DEVELOPER_QUERY_REQUIRED");
    const response = await requestJson<VndbProducerResponse>(
      this.fetcher,
      `${this.baseUrl}/producer`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: ["search", "=", search],
          fields: "name,original,aliases",
          results: 10,
        }),
      },
    );
    const normalizedQuery = normalizeTitle(search);
    const producer =
      response.results.find((candidate) =>
        [candidate.name, candidate.original, ...candidate.aliases]
          .filter((value): value is string => Boolean(value))
          .some((value) => normalizeTitle(value) === normalizedQuery),
      ) ?? response.results[0];
    if (!producer) return { items: [], hasMore: false, nextCursor: null };

    return this.queryVisualNovels(
      ["developer", "=", ["id", "=", producer.id]],
      page,
      pageSize,
      "released",
      false,
    );
  }

  private async queryVisualNovels(
    filters: unknown[],
    page: number,
    pageSize: number,
    sort: VndbVisualNovelSort | "searchrank",
    reverse: boolean,
  ): Promise<PagedResult<SourceVisualNovel>> {
    const response = await requestJson<VndbResponse>(
      this.fetcher,
      `${this.baseUrl}/vn`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters,
          fields: visualNovelFields,
          sort,
          reverse,
          results: Math.min(100, Math.max(1, pageSize)),
          page,
        }),
      },
    );

    const visualNovelIds = response.results.map((item) => item.id);
    const releaseEvidence = await this.loadReleaseEvidence(visualNovelIds);
    const animeAdaptations = await this.loadAnimeAdaptations(visualNovelIds);
    const heroineHair = await this.loadHeroineHairColors(visualNovelIds);
    return {
      items: response.results.map((item) =>
        this.normalize(
          item,
          releaseEvidence.get(item.id),
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

  private async loadReleaseEvidence(
    visualNovelIds: string[],
  ): Promise<Map<string, ReleaseEvidence>> {
    const states = new Map<
      string,
      {
        hasAdultContent: boolean;
        hasNonAdultRating: boolean;
        hasAdultRating: boolean;
        releaseDates: string[];
        publishers: Map<string, string>;
        releases: ReleaseEvidence["releases"];
      }
    >(
      visualNovelIds.map((id) => [
        id,
        {
          hasAdultContent: false,
          hasNonAdultRating: false,
          hasAdultRating: false,
          releaseDates: [],
          publishers: new Map(),
          releases: [],
        },
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
            fields:
              "released,minage,has_ero,official,platforms,vns{id,rtype},producers{id,name,developer,publisher}",
            results: 100,
            page,
          }),
        },
      );
      for (const release of response.results) {
        if (!release.official) continue;
        for (const vn of release.vns ?? []) {
          if (vn.rtype !== "complete") continue;
          const state = states.get(vn.id);
          if (!state) continue;
          if (release.released?.match(/^\d{4}/)) {
            state.releaseDates.push(release.released);
          }
          state.hasAdultContent ||= release.has_ero;
          state.hasNonAdultRating ||=
            !release.has_ero && release.minage != null && release.minage <= 15;
          state.hasAdultRating ||= (release.minage ?? 0) >= 18;
          for (const producer of release.producers ?? []) {
            if (producer.publisher)
              state.publishers.set(producer.id, producer.name);
          }
          state.releases.push({
            released: release.released,
            platforms: release.platforms ?? [],
            minage: release.minage,
            hasEro: release.has_ero,
          });
        }
      }
      if (!response.more) break;
    }

    return new Map(
      [...states].map(([id, state]) => {
        const publishers = [...state.publishers];
        return [
          id,
          {
            releaseDate: state.releaseDates.sort()[0] ?? null,
            ageRating: state.hasAdultContent
              ? "restricted"
              : state.hasNonAdultRating
                ? "all_ages"
                : state.hasAdultRating
                  ? "restricted"
                  : "unknown",
            publishers: publishers.map(([, name]) => name),
            publisherIds: publishers.map(([producerId]) => producerId),
            releases: state.releases,
          },
        ];
      }),
    );
  }

  private normalize(
    item: VndbVisualNovel,
    releaseEvidence: ReleaseEvidence | undefined,
    animeAdaptation: "none" | "has_adaptation",
    heroineHair?: HeroineHairEvidence,
  ): SourceVisualNovel {
    const alternativeTitles = [
      item.alttitle,
      ...item.aliases,
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
      releaseDate: releaseEvidence?.releaseDate ?? null,
      developers: item.developers.map((developer) => developer.name),
      developerIds: item.developers.map((developer) => developer.id),
      publishers: releaseEvidence?.publishers ?? [],
      publisherIds: releaseEvidence?.publisherIds ?? [],
      scenarioWriters: item.staff
        .filter((staff) => staff.role === "scenario")
        .map(displayStaffName)
        .filter(Boolean),
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
      ageRating: releaseEvidence?.ageRating ?? "unknown",
      seriesIds: [
        item.id,
        ...(item.relations ?? [])
          .filter(
            (relation) =>
              relation.relation_official && relation.relation !== "char",
          )
          .map((relation) => relation.id),
      ],
      tags: item.tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        score: tag.rating,
        spoilerLevel: Math.min(2, Math.max(0, tag.spoiler)) as 0 | 1 | 2,
        category: tag.category,
      })),
      raw: {
        visualNovel: item,
        formalReleaseEvidence: releaseEvidence?.releases ?? [],
        heroineHairEvidence: heroineHair?.characters ?? [],
      },
      fetchedAt: new Date().toISOString(),
    };
  }
}
