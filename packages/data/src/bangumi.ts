import { requestJson, type FetchLike } from "./http.js";
import type { PagedResult, SourceVisualNovel } from "./types.js";

interface BangumiTag {
  name: string;
  count: number;
}

interface BangumiSubject {
  id: number;
  name: string;
  name_cn: string;
  date: string | null;
  platform: string;
  rating?: { score: number; total: number };
  nsfw?: boolean;
  tags: BangumiTag[];
}

interface BangumiSearchResponse {
  data: BangumiSubject[];
  total: number;
  limit: number;
  offset: number;
}

interface BangumiRelatedSubject {
  id: number;
  type: number;
  name: string;
  name_cn: string;
  relation: string;
}

export interface BangumiClientOptions {
  userAgent: string;
  accessToken?: string;
  baseUrl?: string;
  fetcher?: FetchLike;
}

export class BangumiClient {
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly headers: Record<string, string>;

  constructor(options: BangumiClientOptions) {
    if (!options.userAgent.trim())
      throw new Error("BANGUMI_USER_AGENT_REQUIRED");
    this.baseUrl = options.baseUrl ?? "https://api.bgm.tv";
    this.fetcher = options.fetcher ?? fetch;
    this.headers = {
      "content-type": "application/json",
      "user-agent": options.userAgent,
      ...(options.accessToken
        ? { authorization: `Bearer ${options.accessToken}` }
        : {}),
    };
  }

  async searchGames(
    keyword: string,
    offset = 0,
    limit = 20,
  ): Promise<PagedResult<SourceVisualNovel>> {
    const safeLimit = Math.min(50, Math.max(1, limit));
    const response = await requestJson<BangumiSearchResponse>(
      this.fetcher,
      `${this.baseUrl}/v0/search/subjects?limit=${safeLimit}&offset=${Math.max(0, offset)}`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          keyword,
          sort: "match",
          filter: { type: [4] },
        }),
      },
    );

    const nextOffset = response.offset + response.data.length;
    const items: SourceVisualNovel[] = [];
    for (const item of response.data) {
      items.push(this.normalize(item, await this.loadAnimeAdaptation(item.id)));
    }
    return {
      items,
      hasMore: nextOffset < response.total,
      nextCursor: nextOffset < response.total ? String(nextOffset) : null,
    };
  }

  async getGamesByIds(
    sourceIds: string[],
  ): Promise<PagedResult<SourceVisualNovel>> {
    const ids = [
      ...new Set(
        sourceIds
          .map((sourceId) => Number(sourceId))
          .filter((sourceId) => Number.isSafeInteger(sourceId) && sourceId > 0),
      ),
    ];
    const items: SourceVisualNovel[] = [];
    for (const subjectId of ids) {
      const item = await requestJson<BangumiSubject>(
        this.fetcher,
        `${this.baseUrl}/v0/subjects/${subjectId}`,
        { headers: this.headers },
      );
      items.push(
        this.normalize(item, await this.loadAnimeAdaptation(subjectId)),
      );
    }
    return { items, hasMore: false, nextCursor: null };
  }

  private async loadAnimeAdaptation(
    subjectId: number,
  ): Promise<"none" | "announced" | "has_adaptation" | "unknown"> {
    const relations = await requestJson<BangumiRelatedSubject[]>(
      this.fetcher,
      `${this.baseUrl}/v0/subjects/${subjectId}/subjects`,
      { headers: this.headers },
    );
    const animeRelations = relations.filter((relation) => relation.type === 2);
    if (animeRelations.length === 0) return "none";

    let hasFutureDate = false;
    let hasKnownDate = false;
    const today = new Date().toISOString().slice(0, 10);
    for (const relation of animeRelations) {
      const subject = await requestJson<BangumiSubject>(
        this.fetcher,
        `${this.baseUrl}/v0/subjects/${relation.id}`,
        { headers: this.headers },
      );
      if (!subject.date?.match(/^\d{4}/)) continue;
      hasKnownDate = true;
      if (subject.date <= today) return "has_adaptation";
      hasFutureDate = true;
    }
    return hasFutureDate
      ? "announced"
      : hasKnownDate
        ? "has_adaptation"
        : "unknown";
  }

  private normalize(
    item: BangumiSubject,
    animeAdaptation: "none" | "announced" | "has_adaptation" | "unknown",
  ): SourceVisualNovel {
    return {
      source: "bangumi",
      sourceId: String(item.id),
      title: item.name_cn || item.name,
      alternativeTitles: [item.name, item.name_cn]
        .filter((title) => title && title !== (item.name_cn || item.name))
        .filter((title, index, all) => all.indexOf(title) === index),
      releaseDate: item.date,
      developers: [],
      scenarioWriters: [],
      playtime: null,
      platforms: item.platform ? [item.platform] : [],
      languages: [],
      rating: item.rating?.score ?? null,
      voteCount: item.rating?.total ?? null,
      popularity: null,
      animeAdaptation,
      ageRating: item.nsfw ? "restricted" : "unknown",
      tags: item.tags.map((tag) => ({ name: tag.name, score: tag.count })),
      raw: item,
      fetchedAt: new Date().toISOString(),
    };
  }
}
