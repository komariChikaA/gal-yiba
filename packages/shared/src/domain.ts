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
  "developer",
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
export type AnimeAdaptation = "none" | "announced" | "has_adaptation";
export type AgeRating = "all_ages" | "restricted" | "unknown";
export type GameMode = "solo" | "duel" | "race";
export type FameTier = "novice" | "standard" | "veteran" | "master";
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
  id?: string;
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
  isOtome: boolean;
  platforms: string[] | null;
  languages: string[] | null;
  tags: string[] | null;
  tagDetails?: VisualNovelTag[] | null;
  seriesIds?: string[] | null;
  developerFamilyIds?: string[] | null;
  provenance: Partial<Record<ComparisonKey | "title", Provenance[]>>;
}

export interface PoolFilter {
  includeTags: string[];
  excludeTags: string[];
  tagMode: "all" | "any";
  allAgesOnly: boolean;
  /** Include otome games in the answer pool. Disabled by default. */
  includeOtome: boolean;
  /** 把中国本土作品纳入题池（默认关闭，仅日系）。 */
  includeChina: boolean;
  /** 把非日本非中国（欧美等）作品纳入题池（默认关闭）。 */
  includeWest: boolean;
  maxTagSpoilerLevel: 0 | 1 | 2;
  fameTier: FameTier;
}

export interface GameRules {
  version: 1;
  mode: GameMode;
  maxGuesses: number;
  roundTimeSeconds: number;
  bestOf: 1 | 3 | 5 | 7;
  comparisonKeys: ComparisonKey[];
  pool: PoolFilter;
}

export type ComparisonStatus = "exact" | "partial" | "miss" | "unknown";
export type ComparisonDirection = "higher" | "lower";
export type ComparisonHint = "more" | "fewer" | "same_family";
export type ComparisonBasis = "value" | "tier";

export interface ComparisonResult {
  key: ComparisonKey;
  status: ComparisonStatus;
  direction?: ComparisonDirection;
  hint?: ComparisonHint;
  basis?: ComparisonBasis;
  overlap?: string[];
  guessValue: string | number | string[] | null;
}
