import { describe, expect, it } from "vitest";
import {
  createDailyGameSession,
  createGameSession,
  fameTierPoolSizes,
  filterAnswerPool,
  publicGameSession,
  submitGuess,
  visualNovelRegion,
} from "./game.js";
import type { GameRules, VisualNovel } from "./domain.js";

const rules: GameRules = {
  version: 1,
  mode: "solo",
  maxGuesses: 2,
  roundTimeSeconds: 60,
  bestOf: 1,
  comparisonKeys: ["developer", "releaseYear", "tags"],
  pool: {
    includeTags: ["悬疑"],
    excludeTags: ["猎奇"],
    tagMode: "all",
    allAgesOnly: false,
    includeChina: false,
    includeWest: false,
    maxTagSpoilerLevel: 0,
    fameTier: "novice",
  },
};

function visualNovel(
  id: string,
  overrides: Partial<VisualNovel> = {},
): VisualNovel {
  return {
    id,
    title: `作品 ${id}`,
    aliases: [],
    developer: ["会社 A"],
    publisher: null,
    scenarioWriter: null,
    heroineHairColor: null,
    releaseYear: 2020,
    playtime: "medium",
    vndbRating: 8,
    bangumiRating: 7.8,
    vndbVoteCount: 3000,
    bangumiVoteCount: 1200,
    animeAdaptation: "none",
    ageRating: "all_ages",
    platforms: ["windows"],
    languages: ["ja"],
    tags: ["悬疑"],
    provenance: {},
    ...overrides,
  };
}

describe("filterAnswerPool", () => {
  it("applies include, exclude and all-ages-only room rules", () => {
    const catalog = [
      visualNovel("valid"),
      visualNovel("excluded", { tags: ["悬疑", "猎奇"] }),
      visualNovel("restricted", { ageRating: "restricted" }),
      visualNovel("wrong-tag", { tags: ["纯爱"] }),
    ];
    expect(filterAnswerPool(catalog, rules).map((item) => item.id)).toEqual([
      "valid",
      "restricted",
    ]);
    expect(
      filterAnswerPool(catalog, {
        ...rules,
        pool: { ...rules.pool, allAgesOnly: true },
      }).map((item) => item.id),
    ).toEqual(["valid"]);
  });

  it("builds cumulative top-N pools by score rank", () => {
    const catalog = [
      visualNovel("top", { vndbRating: 9.0, vndbVoteCount: 500 }),
      visualNovel("mid", { vndbRating: 8.0, vndbVoteCount: 500 }),
      visualNovel("low", { vndbRating: 7.0, vndbVoteCount: 500 }),
    ];
    const idsFor = (fameTier: GameRules["pool"]["fameTier"]) =>
      filterAnswerPool(catalog, {
        ...rules,
        pool: { ...rules.pool, fameTier },
      }).map((item) => item.id);
    // 目录小于 150 部时，每个档位都包含全部作品。
    expect(idsFor("novice")).toEqual(["top", "mid", "low"]);
    expect(idsFor("standard")).toEqual(["top", "mid", "low"]);
    expect(idsFor("veteran")).toEqual(["top", "mid", "low"]);
    expect(idsFor("master")).toEqual(["top", "mid", "low"]);
  });

  it("cuts each tier at its pool size by score", () => {
    const catalog = Array.from({ length: 160 }, (_, index) =>
      visualNovel(`v-${index}`, {
        vndbRating: index < 150 ? 8 : 5,
        vndbVoteCount: 100,
      }),
    );
    const novice = filterAnswerPool(catalog, {
      ...rules,
      pool: { ...rules.pool, fameTier: "novice" },
    });
    expect(novice).toHaveLength(150);
    const veteran = filterAnswerPool(catalog, {
      ...rules,
      pool: { ...rules.pool, fameTier: "veteran" },
    });
    expect(veteran).toHaveLength(160);
    // 老资历档在前 150 名之外再容纳 338 部。
    expect(fameTierPoolSizes.master).toBe(1028);
  });

  it("filters and compares tags at the configured spoiler level", () => {
    const tagged = visualNovel("tagged", {
      tags: ["悬疑", "成人内容", "真结局反转"],
      tagDetails: [
        { name: "悬疑", spoilerLevel: 0, category: "cont" },
        { name: "成人内容", spoilerLevel: 0, category: "ero" },
        { name: "真结局反转", spoilerLevel: 2 },
      ],
    });
    expect(filterAnswerPool([tagged], rules)[0]?.tags).toEqual([
      "悬疑",
      "成人内容",
    ]);
    expect(
      filterAnswerPool([tagged], {
        ...rules,
        pool: { ...rules.pool, maxTagSpoilerLevel: 2 },
      })[0]?.tags,
    ).toEqual(["悬疑", "成人内容", "真结局反转"]);
    expect(
      filterAnswerPool([tagged], {
        ...rules,
        pool: { ...rules.pool, allAgesOnly: false },
      })[0]?.tags,
    ).toEqual(["悬疑", "成人内容"]);
    expect(
      filterAnswerPool([tagged], {
        ...rules,
        pool: { ...rules.pool, includeTags: ["真结局反转"] },
      }),
    ).toHaveLength(0);
  });

  it("uses only the three most important allowed tags", () => {
    const tagged = visualNovel("ranked-tags", {
      tags: ["Romance", "Comedy", "School", "Drama", "True Ending"],
      tagDetails: [
        { name: "Romance", spoilerLevel: 0, score: 2.1 },
        { name: "Comedy", spoilerLevel: 0, score: 2.8 },
        { name: "School", spoilerLevel: 0, score: 2.5 },
        { name: "Drama", spoilerLevel: 0, score: 2.4 },
        { name: "True Ending", spoilerLevel: 2, score: 3 },
      ],
    });
    expect(
      filterAnswerPool([tagged], {
        ...rules,
        pool: { ...rules.pool, includeTags: [], excludeTags: [] },
      })[0]?.tags,
    ).toEqual(["Comedy", "School", "Drama"]);
  });
});

describe("game session", () => {
  it("selects deterministically and never exposes the answer while active", () => {
    const session = createGameSession(
      [visualNovel("a"), visualNovel("b")],
      rules,
      {
        random: () => 0.99,
        now: new Date("2026-08-08T00:00:00.000Z"),
        id: "game-1",
      },
    );
    expect(session.answer.id).toBe("b");
    expect(publicGameSession(session).answer).toBeUndefined();
  });

  it("returns only the fields enabled by room rules and blocks duplicate guesses", () => {
    const session = createGameSession([visualNovel("answer")], rules, {
      random: () => 0,
      now: new Date("2026-08-08T00:00:00.000Z"),
    });
    const first = submitGuess(
      session,
      visualNovel("wrong", { releaseYear: 2018 }),
      new Date("2026-08-08T00:00:10.000Z"),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.guess.comparison.map((item) => item.key)).toEqual([
      "developer",
      "releaseYear",
      "tags",
    ]);
    expect(first.guess.titleStatus).toBe("miss");
    expect(
      submitGuess(
        first.game,
        visualNovel("wrong"),
        new Date("2026-08-08T00:00:20.000Z"),
      ),
    ).toMatchObject({ ok: false, error: "DUPLICATE_GUESS" });
  });

  it("marks a wrong title yellow when it belongs to the answer series", () => {
    const session = createGameSession(
      [visualNovel("answer", { seriesIds: ["vndb:v1", "vndb:v2"] })],
      rules,
      { random: () => 0 },
    );
    const outcome = submitGuess(
      session,
      visualNovel("related", { seriesIds: ["vndb:v2", "vndb:v3"] }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.guess.titleStatus).toBe("partial");
  });

  it("reveals the answer after a win", () => {
    const session = createGameSession([visualNovel("answer")], rules, {
      random: () => 0,
    });
    const outcome = submitGuess(session, visualNovel("answer"));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.game.status).toBe("won");
    expect(publicGameSession(outcome.game).answer).toEqual({
      id: "answer",
      title: "作品 answer",
    });
  });

  it("ends when attempts are exhausted", () => {
    let session = createGameSession([visualNovel("answer")], rules, {
      random: () => 0,
    });
    const first = submitGuess(session, visualNovel("wrong-1"));
    if (!first.ok) throw new Error("first guess failed");
    session = first.game;
    const second = submitGuess(session, visualNovel("wrong-2"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.game.status).toBe("lost");
    expect(publicGameSession(second.game).answer?.id).toBe("answer");
  });

  it("expires on a late guess", () => {
    const session = createGameSession([visualNovel("answer")], rules, {
      now: new Date("2026-08-08T00:00:00.000Z"),
    });
    expect(
      submitGuess(
        session,
        visualNovel("wrong"),
        new Date("2026-08-08T00:01:01.000Z"),
      ),
    ).toMatchObject({
      ok: false,
      error: "GAME_EXPIRED",
      game: { status: "expired" },
    });
  });
});

describe("daily question session", () => {
  const dailyCatalog = [
    visualNovel("v-1"),
    visualNovel("v-2"),
    visualNovel("v-3"),
    visualNovel("v-4"),
    visualNovel("v-5"),
    visualNovel("v-6"),
  ];

  it("picks the same answer for the same date", () => {
    const first = createDailyGameSession(dailyCatalog, rules, "2026-08-08");
    const second = createDailyGameSession(dailyCatalog, rules, "2026-08-08");
    expect(first.answer.id).toBe(second.answer.id);
    expect(first.answer).not.toBe(second.answer);
  });

  it("only uses answers inside the filtered pool", () => {
    const catalog = Array.from({ length: 160 }, (_, index) =>
      visualNovel(`v-${index}`, {
        vndbRating: index < 150 ? 8 : 5,
        vndbVoteCount: 100,
      }),
    );
    const session = createDailyGameSession(catalog, rules, "2026-08-08");
    expect(Number(session.answer.id.split("-")[1])).toBeLessThan(150);
  });

  it("rotates the answer across dates", () => {
    const picked = new Set(
      ["2026-08-08", "2026-08-09", "2026-08-10"].map((date) =>
        createDailyGameSession(dailyCatalog, rules, date).answer.id,
      ),
    );
    expect(picked.size).toBeGreaterThan(1);
  });

  it("creates independent sessions that share the day's answer", () => {
    const first = createDailyGameSession(dailyCatalog, rules, "2026-08-08");
    const second = createDailyGameSession(dailyCatalog, rules, "2026-08-08");
    expect(second.answer.id).toBe(first.answer.id);
    expect(second.id).not.toBe(first.id);
    expect(second.guesses).toEqual([]);
  });
});

describe("filterAnswerPool region toggles", () => {
  const japanese = visualNovel("japan", {
    title: "Japanese Game",
    languages: ["ja"],
  });
  const chinese = visualNovel("china", {
    title: "Chinese Game",
    languages: ["zh-Hans"],
  });
  const western = visualNovel("west", {
    title: "Western Game",
    languages: ["en"],
  });
  const translated = visualNovel("west-translated", {
    title: "Western with Chinese",
    languages: ["en", "zh-Hans"],
  });

  it("excludes Chinese and Western games by default", () => {
    const ids = filterAnswerPool(
      [japanese, chinese, western, translated],
      rules,
    ).map((item) => item.id);
    expect(ids).toEqual(["japan"]);
  });

  it("includes Chinese games only when toggled on", () => {
    const ids = filterAnswerPool(
      [japanese, chinese, western],
      {
        ...rules,
        pool: { ...rules.pool, includeChina: true },
      },
    ).map((item) => item.id);
    expect(ids).toEqual(["japan", "china"]);
  });

  it("includes Western games only when toggled on", () => {
    const ids = filterAnswerPool(
      [japanese, chinese, western],
      {
        ...rules,
        pool: { ...rules.pool, includeWest: true },
      },
    ).map((item) => item.id);
    expect(ids).toEqual(["japan", "west"]);
  });

  it("classifies a Western game with a Chinese translation as Western", () => {
    expect(visualNovelRegion(translated)).toBe("west");
    expect(visualNovelRegion(chinese)).toBe("china");
    expect(visualNovelRegion(japanese)).toBe("japan");
  });
});

describe("publicGameSession answer hiding", () => {
  it("keeps the answer hidden for an exhausted player mid-round", () => {
    const session = createGameSession(
      [visualNovel("answer")],
      { ...rules, maxGuesses: 1, pool: { ...rules.pool, includeTags: [] } },
      { random: () => 0 },
    );
    const outcome = submitGuess(
      session,
      visualNovel("wrong"),
      new Date("2026-08-08T00:00:05.000Z"),
    );
    if (!outcome.ok) throw new Error("expected a guess outcome");
    expect(outcome.game.status).toBe("lost");
    expect(publicGameSession(outcome.game).answer?.id).toBe("answer");
    expect(
      publicGameSession(outcome.game, { hideAnswer: true }).answer,
    ).toBeUndefined();
    expect(
      publicGameSession(outcome.game, { hideAnswer: false }).answer?.id,
    ).toBe("answer");
  });
});
