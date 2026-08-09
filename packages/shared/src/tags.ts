import type { VisualNovelTag } from "./domain.js";

type TagGroup =
  "genre" | "tone" | "setting" | "theme" | "relationship" | "audience";

interface TagDefinition {
  name: string;
  group: TagGroup;
  aliases: readonly string[];
}

const definitions: readonly TagDefinition[] = [
  { name: "恋爱", group: "relationship", aliases: ["romance", "恋爱", "戀愛"] },
  {
    name: "纯爱",
    group: "relationship",
    aliases: [
      "pure love story",
      "pure love",
      "love overcomes all",
      "纯爱",
      "純愛",
    ],
  },
  {
    name: "百合",
    group: "audience",
    aliases: [
      "girl x girl romance",
      "girl x girl romance only",
      "girls love",
      "yuri",
      "百合",
    ],
  },
  {
    name: "BL",
    group: "audience",
    aliases: [
      "boy x boy romance",
      "boy x boy romance only",
      "boys love",
      "yaoi",
      "bl",
      "耽美",
    ],
  },
  { name: "乙女", group: "audience", aliases: ["otome game", "otome", "乙女"] },
  { name: "后宫", group: "relationship", aliases: ["harem", "后宫", "後宮"] },
  {
    name: "禁忌恋",
    group: "relationship",
    aliases: [
      "brother/sister romance",
      "parent/child romance",
      "incest",
      "禁忌恋",
      "禁斷之戀",
    ],
  },
  { name: "喜剧", group: "tone", aliases: ["comedy", "喜剧", "喜劇", "搞笑"] },
  { name: "剧情", group: "tone", aliases: ["drama", "剧情", "劇情"] },
  {
    name: "治愈",
    group: "tone",
    aliases: ["healing", "iyashikei", "heartwarming", "治愈", "治癒"],
  },
  {
    name: "催泪",
    group: "tone",
    aliases: ["nakige", "tearjerker", "催泪", "泣系"],
  },
  {
    name: "致郁",
    group: "tone",
    aliases: ["utsuge", "depressing", "致郁", "鬱ゲー"],
  },
  {
    name: "黑暗",
    group: "tone",
    aliases: ["dark", "dark story", "黑暗", "暗黑"],
  },
  {
    name: "悬疑",
    group: "genre",
    aliases: ["mystery", "suspense", "悬疑", "懸疑"],
  },
  {
    name: "推理",
    group: "theme",
    aliases: ["detective work", "detective", "推理", "侦探", "偵探"],
  },
  { name: "惊悚", group: "tone", aliases: ["thriller", "惊悚", "驚悚"] },
  {
    name: "恐怖",
    group: "genre",
    aliases: ["horror", "psychological horror", "恐怖"],
  },
  {
    name: "猎奇",
    group: "tone",
    aliases: ["grotesque", "guro", "猎奇", "獵奇"],
  },
  {
    name: "心理",
    group: "theme",
    aliases: [
      "psychological",
      "psychological problems",
      "protagonist with psychological problems",
      "clinical depression",
      "心理",
    ],
  },
  {
    name: "超现实",
    group: "tone",
    aliases: ["surreal", "surrealism", "超现实", "超現實"],
  },
  {
    name: "奇幻",
    group: "genre",
    aliases: ["fantasy", "urban fantasy", "奇幻"],
  },
  {
    name: "科幻",
    group: "genre",
    aliases: ["science fiction", "sci-fi", "sf", "科幻"],
  },
  { name: "冒险", group: "genre", aliases: ["adventure", "冒险", "冒險"] },
  { name: "动作", group: "genre", aliases: ["action", "动作", "動作"] },
  {
    name: "战斗",
    group: "theme",
    aliases: [
      "combat",
      "battle",
      "fighting heroine",
      "fighting protagonist",
      "combat capable friends",
      "战斗",
      "戰鬥",
    ],
  },
  {
    name: "日常",
    group: "tone",
    aliases: ["slice of life", "daily life", "slice of life comedy", "日常"],
  },
  {
    name: "校园",
    group: "setting",
    aliases: [
      "school",
      "high school",
      "school dormitory",
      "former all-girls school",
      "校园",
      "校園",
      "学园",
      "學園",
    ],
  },
  {
    name: "现代",
    group: "setting",
    aliases: [
      "modern day",
      "modern day earth",
      "modern day japan",
      "现代",
      "現代",
    ],
  },
  { name: "都市", group: "setting", aliases: ["urban", "city", "都市"] },
  {
    name: "乡村",
    group: "setting",
    aliases: ["rural", "countryside", "乡村", "鄉村", "田园"],
  },
  {
    name: "历史",
    group: "setting",
    aliases: ["historical", "history", "历史", "歷史"],
  },
  {
    name: "和风",
    group: "setting",
    aliases: ["japanese-style", "japanese style", "和风", "和風"],
  },
  {
    name: "异世界",
    group: "setting",
    aliases: ["isekai", "other world", "异世界", "異世界"],
  },
  {
    name: "架空世界",
    group: "setting",
    aliases: ["fictional world", "架空世界"],
  },
  {
    name: "末世",
    group: "setting",
    aliases: [
      "post-apocalyptic",
      "post apocalyptic earth",
      "apocalypse",
      "末世",
      "末日",
    ],
  },
  {
    name: "太空",
    group: "setting",
    aliases: ["space", "outer space", "太空", "宇宙"],
  },
  {
    name: "军事",
    group: "setting",
    aliases: [
      "military",
      "war",
      "world war ii",
      "军事",
      "軍事",
      "战争",
      "戰爭",
    ],
  },
  { name: "魔法", group: "theme", aliases: ["magic", "魔法", "魔术", "魔術"] },
  {
    name: "超能力",
    group: "theme",
    aliases: ["superpowers", "superpower", "超能力", "异能", "異能"],
  },
  {
    name: "超自然",
    group: "theme",
    aliases: ["supernatural", "超自然", "灵异", "靈異"],
  },
  {
    name: "时间旅行",
    group: "theme",
    aliases: ["time travel", "时间旅行", "時間旅行", "穿越"],
  },
  {
    name: "轮回",
    group: "theme",
    aliases: ["time loop", "loop", "轮回", "輪迴", "循环"],
  },
  {
    name: "失忆",
    group: "theme",
    aliases: ["amnesia", "memory loss", "失忆", "失憶"],
  },
  {
    name: "疾病",
    group: "theme",
    aliases: [
      "health issues",
      "terminal illness",
      "disease",
      "sickly protagonist",
      "sickly heroine",
      "疾病",
    ],
  },
  { name: "犯罪", group: "theme", aliases: ["crime", "犯罪"] },
  {
    name: "家庭",
    group: "theme",
    aliases: ["family", "family drama", "家庭", "亲情", "親情"],
  },
  { name: "友情", group: "theme", aliases: ["friendship", "友情"] },
  {
    name: "成长",
    group: "theme",
    aliases: ["coming of age", "growing up", "成长", "成長"],
  },
  { name: "音乐", group: "theme", aliases: ["music", "音乐", "音樂"] },
  {
    name: "职场",
    group: "setting",
    aliases: ["workplace", "office", "part-time job", "cafe", "职场", "職場"],
  },
  {
    name: "网络",
    group: "theme",
    aliases: ["internet", "social networking service", "网络", "網絡"],
  },
  { name: "夏日", group: "setting", aliases: ["summer", "夏日", "夏天"] },
  {
    name: "体育",
    group: "theme",
    aliases: ["sports", "sport", "体育", "體育", "竞技"],
  },
  {
    name: "忍者",
    group: "theme",
    aliases: [
      "ninja",
      "shinobi",
      "kunoichi heroine",
      "ninja protagonist",
      "忍者",
    ],
  },
  {
    name: "人外",
    group: "theme",
    aliases: [
      "fictional beings",
      "non-human heroine",
      "non-human protagonist",
      "monsters",
      "demons",
      "undead",
      "vampire",
      "人外",
      "吸血鬼",
    ],
  },
  {
    name: "同居",
    group: "relationship",
    aliases: ["under the same roof", "domicile", "living together", "同居"],
  },
  {
    name: "神话",
    group: "theme",
    aliases: ["mythology", "mythological", "神话", "神話"],
  },
  {
    name: "机器人",
    group: "theme",
    aliases: ["robots", "robot", "mecha", "机器人", "機器人", "机甲"],
  },
  {
    name: "赛博朋克",
    group: "setting",
    aliases: ["cyberpunk", "赛博朋克", "賽博朋克"],
  },
  { name: "蒸汽朋克", group: "setting", aliases: ["steampunk", "蒸汽朋克"] },
];

const vndbTagIds = new Map<string, string>([
  ["g96", "恋爱"],
  ["g2", "奇幻"],
  ["g147", "剧情"],
  ["g47", "校园"],
  ["g104", "喜剧"],
  ["g19", "悬疑"],
  ["g105", "科幻"],
  ["g7", "恐怖"],
  ["g12", "动作"],
  ["g454", "日常"],
  ["g4", "魔法"],
  ["g710", "友情"],
  ["g152", "失忆"],
  ["g6", "超能力"],
  ["g97", "百合"],
  ["g98", "BL"],
  ["g1986", "百合"],
  ["g2002", "BL"],
  ["g322", "犯罪"],
  ["g259", "架空世界"],
  ["g13", "战斗"],
  ["g202", "人外"],
  ["g996", "人外"],
  ["g491", "人外"],
  ["g123", "人外"],
  ["g400", "人外"],
  ["g308", "同居"],
]);

function normalizeKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, " ");
}

const definitionsByName = new Map(definitions.map((item) => [item.name, item]));
const definitionsByAlias = new Map<string, TagDefinition>();
for (const definition of definitions) {
  for (const alias of [definition.name, ...definition.aliases]) {
    definitionsByAlias.set(normalizeKey(alias), definition);
  }
}

interface NormalizedTag extends VisualNovelTag {
  group: TagGroup;
}

/**
 * Converts VNDB and Bangumi community tags into a deliberately small Chinese
 * vocabulary. Unknown, technical and sexual-detail tags are omitted instead of
 * leaking untranslated or overly specific metadata into the guessing rules.
 */
export function normalizeRepresentativeTag(
  detail: VisualNovelTag,
): NormalizedTag | null {
  if (detail.category === "ero" || detail.category === "tech") return null;
  const idName = detail.id ? vndbTagIds.get(detail.id) : undefined;
  const definition = idName
    ? definitionsByName.get(idName)
    : definitionsByAlias.get(normalizeKey(detail.name));
  if (!definition) return null;
  return {
    ...(detail.id ? { id: detail.id } : {}),
    name: definition.name,
    spoilerLevel: detail.spoilerLevel,
    ...(detail.score == null ? {} : { score: detail.score }),
    category: "cont",
    group: definition.group,
  };
}

export function selectRepresentativeTags(
  tagDetails: VisualNovelTag[] | null | undefined,
  fallbackTags: string[] | null | undefined,
  maxSpoilerLevel: 0 | 1 | 2,
  limit = 3,
): VisualNovelTag[] {
  const candidates: VisualNovelTag[] = tagDetails?.length
    ? tagDetails
    : (fallbackTags ?? []).map((name) => ({ name, spoilerLevel: 0 }));
  const byName = new Map<
    string,
    { detail: NormalizedTag; originalIndex: number }
  >();
  candidates.forEach((candidate, originalIndex) => {
    if (candidate.spoilerLevel > maxSpoilerLevel) return;
    const detail = normalizeRepresentativeTag(candidate);
    if (!detail) return;
    const existing = byName.get(detail.name);
    if (!existing || (detail.score ?? 0) > (existing.detail.score ?? 0)) {
      byName.set(detail.name, { detail, originalIndex });
    }
  });

  const ranked = [...byName.values()].sort(
    (left, right) =>
      (right.detail.score ?? 0) - (left.detail.score ?? 0) ||
      left.originalIndex - right.originalIndex,
  );
  return ranked
    .slice(0, Math.max(0, limit))
    .map(({ detail: { group: _group, ...detail } }) => detail);
}
