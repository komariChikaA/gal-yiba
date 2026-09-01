/** 可选的远程 API 根地址；空字符串表示同域（Docker/本地代理）。 */
export const API_BASE = String(import.meta.env.VITE_API_BASE ?? "").replace(
  /\/$/,
  "",
);

/** GitHub Pages 等无后端环境：用内置题库在浏览器里跑单人/每日。 */
export const STATIC_PLAY = import.meta.env.VITE_STATIC_PLAY === "true";

export const BASE_URL = import.meta.env.BASE_URL ?? "/";

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

export function publicAsset(path: string): string {
  const relative = path.replace(/^\//, "");
  return `${BASE_URL}${relative}`;
}
