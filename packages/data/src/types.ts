export interface SourceTag {
  id?: string;
  name: string;
  score?: number;
  spoilerLevel?: 0 | 1 | 2;
  category?: "cont" | "ero" | "tech";
}

export interface SourceVisualNovel {
  source: "vndb" | "bangumi";
  sourceId: string;
  title: string;
  alternativeTitles: string[];
  releaseDate: string | null;
  developers: string[];
  scenarioWriters: string[];
  playtime: 1 | 2 | 3 | 4 | 5 | null;
  platforms: string[];
  languages: string[];
  rating: number | null;
  voteCount: number | null;
  popularity: number | null;
  animeAdaptation?: "none" | "has_adaptation" | "unknown";
  ageRating?: "all_ages" | "restricted" | "unknown";
  tags: SourceTag[];
  raw: unknown;
  fetchedAt: string;
}

export interface PagedResult<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}
