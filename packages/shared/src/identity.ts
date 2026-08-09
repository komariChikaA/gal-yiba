/** 规范化特征码：去空白、转大写、只保留字母和数字。 */
export function normalizeFeatureCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** 同一规范化特征码在所有设备和服务端得到同一玩家 UUID。 */
export function featureCodeToPlayerId(codeInput: string): string {
  const code = normalizeFeatureCode(codeInput);
  const full =
    fnv1a(code) +
    fnv1a(`v2:${code}`) +
    fnv1a(`v3:${code}`) +
    fnv1a(`v4:${code}`);
  const variant = (parseInt(full[16] ?? "8", 16) & 0x3) | 0x8;
  return `${full.slice(0, 8)}-${full.slice(8, 12)}-4${full.slice(13, 16)}-${variant.toString(16)}${full.slice(17, 20)}-${full.slice(20)}`;
}
