import type { ComparisonResult } from "@gal-yiba/shared";

const enumValueLabels: Record<string, string> = {
  very_short: "极短",
  short: "短篇",
  medium: "中篇",
  long: "长篇",
  very_long: "超长篇",
  none: "无动画",
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
    return result.key === "vndbVoteCount" || result.key === "bangumiVoteCount"
      ? value.toLocaleString("zh-CN")
      : String(value);
  }
  return enumValueLabels[value] ?? value;
}
