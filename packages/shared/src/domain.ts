export const comparisonKeys = [
  "developer",
  "publisher",
  "scenarioWriter",
  "heroineHairColor",
  "releaseYear",
  "playtime",
  "vndbRating",
  "bangumiRating",
  "vndbVoteCount",
  "bangumiVoteCount",
  "animeAdaptation",
  "ageRating",
  "platforms",
  "languages",
  "tags",
] as const;

export type ComparisonKey = (typeof comparisonKeys)[number];

export const defaultComparisonKeys = [
  "heroineHairColor",
  "vndbRating",
  "bangumiRating",
  "vndbVoteCount",
  "bangumiVoteCount",
  "releaseYear",
  "playtime",
  "animeAdaptation",
  "ageRating",
  "platforms",
  "tags",
] as const satisfies readonly ComparisonKey[];

export type Playtime = "very_short" | "short" | "medium" | "long" | "very_long";
export type AnimeAdaptation = "none" | "has_adaptation";
export type AgeRating = "all_ages" | "restricted" | "unknown";
export type HeroineHairColor =
  | "black"
  | "blond"
  | "blue"
  | "brown"
  | "cyan"
  | "green"
  | "grey"
  | "multicolored"
  | "orange"
  | "pink"
  | "red"
  | "teal"
  | "violet"
  | "white";

export interface Provenance {
  source: "vndb" | "bangumi" | "curated";
  sourceId: string;
  syncedAt: string;
}

export interface VisualNovelTag {
  name: string;
  spoilerLevel: 0 | 1 | 2;
  score?: number;
  category?: "cont" | "ero" | "tech";
}

export interface VisualNovel {
  id: string;
  title: string;
  aliases: string[];
  developer: string[] | null;
  publisher: string[] | null;
  scenarioWriter: string[] | null;
  heroineHairColor: HeroineHairColor[] | null;
  releaseYear: number | null;
  playtime: Playtime | null;
  vndbRating: number | null;
  bangumiRating: number | null;
  vndbVoteCount: number | null;
  bangumiVoteCount: number | null;
  animeAdaptation: AnimeAdaptation | null;
  ageRating: AgeRating | null;
  platforms: string[] | null;
  languages: string[] | null;
  tags: string[] | null;
  tagDetails?: VisualNovelTag[] | null;
  provenance: Partial<Record<ComparisonKey | "title", Provenance[]>>;
}

export interface PoolFilter {
  includeTags: string[];
  excludeTags: string[];
  tagMode: "all" | "any";
  allAgesOnly: boolean;
  maxTagSpoilerLevel: 0 | 1 | 2;
}

export interface GameRules {
  version: 1;
  mode: "solo" | "daily" | "race";
  maxGuesses: number;
  roundTimeSeconds: number;
  bestOf: 1 | 3 | 5 | 7;
  comparisonKeys: ComparisonKey[];
  pool: PoolFilter;
}

export type ComparisonStatus = "exact" | "partial" | "miss" | "unknown";
export type ComparisonDirection = "higher" | "lower";

export interface ComparisonResult {
  key: ComparisonKey;
  status: ComparisonStatus;
  direction?: ComparisonDirection;
  overlap?: string[];
  guessValue: string | number | string[] | null;
}
