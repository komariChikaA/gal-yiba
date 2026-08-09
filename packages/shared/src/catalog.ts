import type { VisualNovelTag } from "./domain.js";
import { selectRepresentativeTags } from "./tags.js";

const platformAliases: Record<string, string> = {
  pc: "PC",
  win: "PC",
  windows: "PC",
  lin: "PC",
  linux: "PC",
  mac: "PC",
  macos: "PC",
  osx: "PC",
  dos: "PC",
  pc88: "PC",
  pc98: "PC",
  ps1: "PlayStation",
  ps2: "PlayStation",
  ps3: "PlayStation",
  ps4: "PlayStation",
  ps5: "PlayStation",
  psp: "PlayStation",
  psv: "PlayStation",
  vita: "PlayStation",
  playstation: "PlayStation",
  swi: "Nintendo Switch",
  switch: "Nintendo Switch",
  "nintendo switch": "Nintendo Switch",
  xbo: "Xbox",
  xbox: "Xbox",
  x360: "Xbox",
  xone: "Xbox",
  xsx: "Xbox",
  wii: "Nintendo Wii",
  wiu: "Nintendo Wii",
  "wii u": "Nintendo Wii",
  nds: "Nintendo DS",
  "3ds": "Nintendo DS",
  and: "Android",
  android: "Android",
  ios: "iOS",
  web: "Web",
  browser: "Web",
};

const secondaryPlatforms = new Set(["Android", "iOS", "Web"]);
const platformPriority = new Map([
  ["PC", 0],
  ["PlayStation", 1],
  ["Nintendo Switch", 2],
  ["Xbox", 3],
  ["Nintendo Wii", 4],
  ["Nintendo DS", 5],
]);
const majorPlatforms = new Set(platformPriority.keys());

function normalizeKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function normalizeComparisonPlatforms(platforms: string[]): string[] {
  const normalized = [
    ...new Set(
      platforms
        .map((platform) => platform.trim())
        .filter(Boolean)
        .map((platform) => platformAliases[normalizeKey(platform)] ?? platform),
    ),
  ];
  const primary = normalized.filter(
    (platform) => !secondaryPlatforms.has(platform),
  );
  const major = primary.filter((platform) => majorPlatforms.has(platform));
  const selected =
    major.length > 0 ? major : primary.length > 0 ? primary : normalized;
  return selected
    .map((platform, index) => ({ platform, index }))
    .sort(
      (left, right) =>
        (platformPriority.get(left.platform) ?? 99) -
          (platformPriority.get(right.platform) ?? 99) ||
        left.index - right.index,
    )
    .slice(0, 4)
    .map((item) => item.platform);
}

export function selectImportantTags(
  tagDetails: VisualNovelTag[] | null | undefined,
  fallbackTags: string[] | null | undefined,
  maxSpoilerLevel: 0 | 1 | 2,
  limit = 3,
): VisualNovelTag[] {
  return selectRepresentativeTags(
    tagDetails,
    fallbackTags,
    maxSpoilerLevel,
    limit,
  );
}
