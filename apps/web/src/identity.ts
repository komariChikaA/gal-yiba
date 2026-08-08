const PLAYER_ID_KEY = "gal-yiba-player-id";
const FEATURE_CODE_KEY = "gal-yiba-feature-code";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 规范化特征码：去空白、转大写、只留字母数字。 */
export function normalizeFeatureCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** FNV-1a 32 位哈希，输出 8 位十六进制。 */
function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 特征码 → 确定性 UUID（v4 形状）：同一特征码在任何设备都得到同一
 * playerId，排行榜据此跨设备合并战绩。
 */
export function featureCodeToPlayerId(code: string): string {
  const full =
    fnv1a(code) +
    fnv1a(`v2:${code}`) +
    fnv1a(`v3:${code}`) +
    fnv1a(`v4:${code}`);
  const variant = (parseInt(full[16] ?? "8", 16) & 0x3) | 0x8;
  return `${full.slice(0, 8)}-${full.slice(8, 12)}-4${full.slice(13, 16)}-${variant.toString(16)}${full.slice(17, 20)}-${full.slice(20)}`;
}

/** 生成匿名 UUID（非安全上下文降级为纯 JS 随机）。 */
function createAnonymousPlayerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const hex = "0123456789abcdef";
  let result = "";
  for (let index = 0; index < 36; index += 1) {
    if (index === 8 || index === 13 || index === 18 || index === 23) {
      result += "-";
    } else if (index === 14) {
      result += "4";
    } else if (index === 19) {
      result += hex[8 + Math.floor(Math.random() * 4)];
    } else {
      result += hex[Math.floor(Math.random() * 16)];
    }
  }
  return result;
}

/** 读取或创建匿名玩家 ID（localStorage 持久化）。 */
export function loadPlayerId(): string {
  const stored = localStorage.getItem(PLAYER_ID_KEY);
  if (stored && UUID_PATTERN.test(stored)) return stored;
  const id = createAnonymousPlayerId();
  localStorage.setItem(PLAYER_ID_KEY, id);
  return id;
}

export function loadFeatureCode(): string {
  return localStorage.getItem(FEATURE_CODE_KEY) ?? "";
}

export function saveFeatureCode(code: string): void {
  const normalized = normalizeFeatureCode(code);
  if (normalized) localStorage.setItem(FEATURE_CODE_KEY, normalized);
  else localStorage.removeItem(FEATURE_CODE_KEY);
}

/** 当前身份：有特征码用特征码派生 ID，否则用匿名 ID。 */
export function resolvePlayerId(featureCode: string): string {
  const normalized = normalizeFeatureCode(featureCode);
  return normalized.length >= 4
    ? featureCodeToPlayerId(normalized)
    : loadPlayerId();
}
