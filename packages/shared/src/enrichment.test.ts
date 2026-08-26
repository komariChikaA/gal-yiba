import { describe, expect, it } from "vitest";
import {
  classifyOtomeFromText,
  classifyRegionFromText,
  classifyRegionFromLanguages,
} from "./enrichment.js";

describe("classifyOtomeFromText", () => {
  it("detects otome keywords with confidence", () => {
    const r = classifyOtomeFromText("这是一款女性向乙女游戏，攻略对象都是男性角色");
    expect(r.isOtome).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(60);
    expect(r.evidence.length).toBeGreaterThan(0);
  });
  it("returns not otome when no keywords", () => {
    const r = classifyOtomeFromText("校园恋爱科幻悬疑");
    expect(r.isOtome).toBe(false);
    expect(r.confidence).toBe(0);
  });
  it("high confidence with multiple hits", () => {
    const r = classifyOtomeFromText("乙女ゲーム 女性向 otome game");
    expect(r.confidence).toBe(85);
  });
});

describe("classifyRegionFromText", () => {
  it("detects china", () => {
    const r = classifyRegionFromText("国产 Galgame 中国制作 中文原创");
    expect(r.region).toBe("china");
    expect(r.confidence).toBeGreaterThanOrEqual(60);
  });
  it("detects west", () => {
    const r = classifyRegionFromText("western visual novel english game 欧美");
    expect(r.region).toBe("west");
  });
  it("unknown when no evidence", () => {
    const r = classifyRegionFromText("日本の学園恋愛ゲーム");
    expect(r.region).toBe("unknown");
  });
});

describe("classifyRegionFromLanguages", () => {
  it("japan default when empty", () => {
    expect(classifyRegionFromLanguages([])).toBe("japan");
  });
  it("japan when contains ja", () => {
    expect(classifyRegionFromLanguages(["ja", "en"])).toBe("japan");
  });
  it("china when all zh", () => {
    expect(classifyRegionFromLanguages(["zh"])).toBe("china");
  });
  it("west when en only", () => {
    expect(classifyRegionFromLanguages(["en"])).toBe("west");
  });
});
