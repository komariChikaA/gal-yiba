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

const bangumiOtomeTags = new Set([
  "乙女",
  "乙女向",
  "乙女游戏",
  "乙女遊戲",
  "乙女ゲー",
  "女性向",
  "女性向け",
  "otome",
  "otome game",
]);

function isBangumiOtome(tags: BangumiTag[]): boolean {
  return tags.some((tag) =>
    bangumiOtomeTags.has(tag.name.normalize("NFKC").trim().toLocaleLowerCase()),
  );
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
    this.baseUrl = options.baseUrl ?? "https://api.bangumi.tv";
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

  /** 轻量搜索：返回原始条目，不逐条深取动漫化关系（回填场景用）。 */
  async searchRaw(keyword: string, limit = 10, offset = 0): Promise<BangumiSubject[]> {
    const safeLimit = Math.min(50, Math.max(1, limit));
    const safeOffset = Math.max(0, offset);
    const response = await requestJson<BangumiSearchResponse>(
      this.fetcher,
      `${this.baseUrl}/v0/search/subjects?limit=${safeLimit}&offset=${safeOffset}`,
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
    return response.data;
  }

  /** 分页搜索：用于扩大召回，取多页聚合 */
  async searchRawPaged(keyword: string, limitPerPage = 20, maxPages = 2): Promise<BangumiSubject[]> {
    const seen = new Map<number, BangumiSubject>();
    for (let page = 0; page < maxPages; page++) {
      const offset = page * limitPerPage;
      const batch = await this.searchRaw(keyword, limitPerPage, offset);
      for (const s of batch) seen.set(s.id, s);
      if (batch.length < limitPerPage) break;
      // 轻微限速
      if (page + 1 < maxPages) await new Promise((r) => setTimeout(r, 180));
    }
    return [...seen.values()];
  }

  /** 是否已配置认证（未登录时 nsfw 条目会被过滤，召回受限） */
  get isAuthenticated(): boolean {
    return this.headers.authorization != null;
  }

  /** 详情：取条目完整字段（含动漫化关系判定）。 */
  async subjectDetail(subjectId: number): Promise<SourceVisualNovel> {
    const subject = await requestJson<BangumiSubject>(
      this.fetcher,
      `${this.baseUrl}/v0/subjects/${subjectId}`,
      { headers: this.headers },
    );
    return this.normalize(subject, await this.loadAnimeAdaptation(subjectId));
  }

  /** 原始条目转 SourceVisualNovel（动漫化未知，用于评分）。 */
  normalizeRaw(subject: BangumiSubject): SourceVisualNovel {
    return this.normalize(subject, "unknown");
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
      isOtome: isBangumiOtome(item.tags),
      tags: item.tags.map((tag) => ({ name: tag.name, score: tag.count })),
      raw: item,
      fetchedAt: new Date().toISOString(),
    };
  }
}
