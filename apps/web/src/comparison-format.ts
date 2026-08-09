import type { ComparisonResult } from "@gal-yiba/shared";

const enumValueLabels: Record<string, string> = {
  very_short: "极短",
  short: "短篇",
  medium: "中篇",
  long: "长篇",
  very_long: "超长篇",
  none: "无动画",
  announced: "已宣布，尚未播出",
  has_adaptation: "有动画化记录",
  all_ages: "全年龄",
  restricted: "限制级",
  unknown: "未知",
  black: "黑色",
  blond: "金色",
  blue: "蓝色",
  brown: "棕色",
  cyan: "青色",
  green: "绿色",
  grey: "灰色",
  multicolored: "多色",
  orange: "橙色",
  pink: "粉色",
  red: "红色",
  teal: "蓝绿色",
  violet: "紫色",
  white: "白色",
};

export function formatComparisonValue(result: ComparisonResult): string {
  const value = result.guessValue;
  if (value == null) return "数据未知";
  if (Array.isArray(value))
    return value.length > 0
      ? value.map((item) => enumValueLabels[item] ?? item).join(" · ")
      : "暂无";
  if (typeof value === "number") {
    if (result.key === "vndbVoteCount" || result.key === "bangumiVoteCount") {
      return value.toLocaleString("zh-CN");
    }
    if (result.key === "vndbRating") return value.toFixed(2);
    return String(value);
  }
  return enumValueLabels[value] ?? value;
}

type MarkerInput = {
  hint?: ComparisonResult["hint"] | null;
};

export function formatComparisonMarker(result: MarkerInput): string {
  return result.hint === "more" ? "+" : result.hint === "fewer" ? "−" : "";
}

type SymbolInput = {
  status: ComparisonResult["status"];
  hint?: ComparisonResult["hint"] | null;
  direction?: ComparisonResult["direction"] | null;
};

/** 徽章符号：优先数量提示（+ −），其次方向（↑ ↓），最后按状态兜底。 */
export function comparisonSymbol(result: SymbolInput): string {
  const quantity = formatComparisonMarker(result);
  if (quantity) return quantity;
  if (result.direction === "higher") return "↑";
  if (result.direction === "lower") return "↓";
  return (
    {
      exact: "✓",
      partial: "≈",
      miss: "×",
      unknown: "?",
    } as const
  )[result.status] ?? "?";
}

export function formatComparisonAriaLabel(result: ComparisonResult): string {
  const status = {
    exact: "匹配",
    partial: "接近",
    miss: "未匹配",
    unknown: "数据未知",
  }[result.status];
  const quantity =
    result.hint === "more"
      ? "，答案项目更多"
      : result.hint === "fewer"
        ? "，答案项目更少"
        : result.hint === "same_family"
          ? "，存在会社关系"
          : "";
  const direction =
    result.direction === "higher"
      ? "，答案更高"
      : result.direction === "lower"
        ? "，答案更低"
        : "";
  return `${status}${quantity}${direction}`;
}

export function formatGuessStars(
  guessCount: number,
  maxGuesses: number,
): string {
  const safeMax = Math.max(0, maxGuesses);
  const used = Math.min(Math.max(0, guessCount), safeMax);
  return `${"★".repeat(used)}${"☆".repeat(safeMax - used)}`;
}

export function formatCountdown(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
