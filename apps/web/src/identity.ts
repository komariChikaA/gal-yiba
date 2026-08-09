import { featureCodeToPlayerId, normalizeFeatureCode } from "@gal-yiba/shared";

export { featureCodeToPlayerId, normalizeFeatureCode };

const PLAYER_ID_KEY = "gal-yiba-player-id";
const FEATURE_CODE_KEY = "gal-yiba-feature-code";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
