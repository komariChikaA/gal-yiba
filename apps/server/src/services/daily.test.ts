import { describe, expect, it } from "vitest";
import { defaultRules } from "../rooms.js";
import { DailyRegistry } from "./daily.js";
import type { VisualNovel } from "@gal-yiba/shared";

function visualNovel(id: string, overrides: Partial<VisualNovel> = {}): VisualNovel {
  return {
    id,
    title: `作品 ${id}`,
    aliases: [],
    developer: ["会社"],
    publisher: null,
    scenarioWriter: null,
    heroineHairColor: null,
    releaseYear: 2020,
    playtime: "medium",
    vndbRating: 8,
    bangumiRating: 7.8,
    vndbVoteCount: 500,
    bangumiVoteCount: 1200,
    animeAdaptation: null,
    ageRating: "all_ages",
    platforms: ["windows"],
    languages: ["ja"],
    tags: ["悬疑"],
    provenance: {},
    ...overrides,
  };
}

const catalog = [
  visualNovel("v-1"),
  visualNovel("v-2"),
  visualNovel("v-3"),
  visualNovel("v-4"),
  visualNovel("v-5"),
];

const now = new Date("2026-08-08T12:00:00.000Z");

describe("DailyRegistry", () => {
  it("creates a session and mints a player token", () => {
    const registry = new DailyRegistry();
    const result = registry.getOrCreate(null, catalog, defaultRules, now);
    expect(result.playerToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.date).toBe("2026-08-08");
    expect(result.session.status).toBe("active");
    expect(result.session.guesses).toEqual([]);
  });

  it("resumes the same session for the same token", () => {
    const registry = new DailyRegistry();
    const first = registry.getOrCreate(null, catalog, defaultRules, now);
    const resumed = registry.getOrCreate(
      first.playerToken,
      catalog,
      defaultRules,
      now,
    );
    expect(resumed.session.id).toBe(first.session.id);
    expect(resumed.playerToken).toBe(first.playerToken);
  });

  it("gives every player the same answer on the same day", () => {
    const registry = new DailyRegistry();
    const first = registry.getOrCreate(null, catalog, defaultRules, now);
    const second = registry.getOrCreate(null, catalog, defaultRules, now);
    expect(second.session.answer.id).toBe(first.session.answer.id);
    expect(second.session.id).not.toBe(first.session.id);
  });

  it("starts a fresh session on a new day", () => {
    const registry = new DailyRegistry();
    const first = registry.getOrCreate(null, catalog, defaultRules, now);
    const nextDay = registry.getOrCreate(
      first.playerToken,
      catalog,
      defaultRules,
      new Date("2026-08-09T12:00:00.000Z"),
    );
    expect(nextDay.session.id).not.toBe(first.session.id);
    expect(nextDay.date).toBe("2026-08-09");
  });

  it("settles an expired session on resume", () => {
    const registry = new DailyRegistry();
    const created = registry.getOrCreate(null, catalog, defaultRules, now);
    const later = registry.getOrCreate(
      created.playerToken,
      catalog,
      defaultRules,
      new Date("2026-08-08T12:06:00.000Z"),
    );
    expect(later.session.status).toBe("expired");
    expect(later.session.finishedAt).not.toBeNull();
  });

  it("marks the session won when the guess is the answer", () => {
    const registry = new DailyRegistry();
    const created = registry.getOrCreate(null, catalog, defaultRules, now);
    const outcome = registry.submitGuess(
      created.playerToken,
      created.session.answer.id,
      catalog,
      now,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.game.status).toBe("won");
      expect(outcome.guess.isCorrect).toBe(true);
    }
  });

  it("rejects guesses for an unknown player token", () => {
    const registry = new DailyRegistry();
    expect(() =>
      registry.submitGuess(
        "00000000-0000-4000-8000-000000000000",
        "v-1",
        catalog,
        now,
      ),
    ).toThrow("DAILY_SESSION_NOT_FOUND");
  });
});
