import type { FetchLike } from "./http.js";
import { requestJson } from "./http.js";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOptions {
  limit?: number;
}

export interface WebSearchProvider {
  search(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]>;
}

export interface HttpWebSearchOptions {
  apiUrl: string;
  apiKey?: string | undefined;
  fetcher?: FetchLike | undefined;
}

/** 通用 HTTP 搜索提供方：可对接 Bing / SerpAPI / 自建搜索代理 */
export class HttpWebSearchProvider implements WebSearchProvider {
  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetcher: FetchLike;

  constructor(options: HttpWebSearchOptions) {
    if (!options.apiUrl.trim()) throw new Error("WEB_SEARCH_API_URL_REQUIRED");
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
  }

  async search(
    query: string,
    options: WebSearchOptions = {},
  ): Promise<WebSearchResult[]> {
    const limit = Math.min(20, Math.max(1, options.limit ?? 5));
    const response = await requestJson<{ results: WebSearchResult[] }>(
      this.fetcher,
      this.apiUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
        },
        body: JSON.stringify({ query, limit }),
      },
    );
    return response.results ?? [];
  }
}

/** 仅用于测试/离线的可注入 mock */
export class MockWebSearchProvider implements WebSearchProvider {
  constructor(private readonly fixture: Map<string, WebSearchResult[]>) {}

  async search(
    query: string,
    options: WebSearchOptions = {},
  ): Promise<WebSearchResult[]> {
    const key = query.normalize("NFKC").trim().toLocaleLowerCase();
    return (this.fixture.get(key) ?? []).slice(
      0,
      Math.min(20, Math.max(1, options.limit ?? 5)),
    );
  }
}

/** 从环境变量创建搜索提供方；未启用时返回 null 以便回退本地逻辑 */
export function createWebSearchProviderFromEnv(
  fetcher?: FetchLike,
): WebSearchProvider | null {
  const enabled = process.env.WEB_SEARCH_ENABLED === "true";
  if (!enabled) return null;
  const apiUrl = process.env.WEB_SEARCH_API_URL?.trim();
  if (!apiUrl) return null;
  return new HttpWebSearchProvider({
    apiUrl,
    apiKey: process.env.WEB_SEARCH_API_KEY?.trim() || undefined,
    fetcher,
  });
}
