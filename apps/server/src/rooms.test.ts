import { describe, expect, it } from "vitest";
import { RoomRegistry } from "./rooms.js";
import type { VisualNovel } from "@gal-yiba/shared";

function visualNovel(id: string): VisualNovel {
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
  };
}

describe("RoomRegistry", () => {
  it("creates a five-character room and lets another player join case-insensitively", () => {
    const registry = new RoomRegistry();
    const created = registry.create("房主", "race", "standard");
    const joined = registry.join(created.room.code.toLowerCase(), "玩家二");
    expect(created.room.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(joined.room.players.map((player) => player.nickname)).toEqual([
      "房主",
      "玩家二",
    ]);
    expect(created.room.rules.comparisonKeys).toEqual([
      "developer",
      "heroineHairColor",
      "vndbRating",
      "bangumiRating",
      "vndbVoteCount",
      "bangumiVoteCount",
      "releaseYear",
      "playtime",
      "animeAdaptation",
      "ageRating",
      "platforms",
      "tags",
    ]);
  });

  it("allows only the host to change enabled comparison fields", () => {
    const registry = new RoomRegistry();
    const created = registry.create("房主");
    const joined = registry.join(created.room.code, "玩家二");
    expect(() =>
      registry.updateRules(
        created.room.code,
        joined.session.playerId,
        created.room.rules,
      ),
    ).toThrow("HOST_ONLY");

    const updated = registry.updateRules(
      created.room.code,
      created.session.playerId,
      {
        ...created.room.rules,
        comparisonKeys: ["developer", "releaseYear", "tags"],
      },
    );
    expect(updated.rules.comparisonKeys).toEqual([
      "developer",
      "releaseYear",
      "tags",
    ]);
  });

  it("restores the same player with a scoped reconnect token", () => {
    const registry = new RoomRegistry();
    const created = registry.create("房主");
    registry.disconnect(created.room.code, created.session.playerId);
    expect(registry.get(created.room.code).players[0]?.connected).toBe(false);

    const restored = registry.reconnect(
      created.room.code,
      created.session.reconnectToken,
    );
    expect(restored.session.playerId).toBe(created.session.playerId);
    expect(restored.room.players[0]?.connected).toBe(true);
    expect(() => registry.reconnect(created.room.code, "wrong-token")).toThrow(
      "INVALID_RECONNECT_TOKEN",
    );
  });

  it("starts the same hidden answer for ready players and ends on the first correct guess", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主");
    const guest = registry.join(host.room.code, "玩家二");
    registry.setReady(host.room.code, guest.session.playerId, true);
    const started = registry.start(
      host.room.code,
      host.session.playerId,
      [visualNovel("answer")],
      {
        random: () => 0,
        now: new Date("2026-08-08T00:00:00.000Z"),
      },
    );
    expect(started.phase).toBe("active");
    expect(started.round?.answer).toBeNull();
    expect(
      registry.getPlayerGame(host.room.code, host.session.playerId).answer,
    ).toBeUndefined();

    const result = registry.submitPlayerGuess(
      host.room.code,
      guest.session.playerId,
      "answer",
      [visualNovel("answer")],
      new Date("2026-08-08T00:00:05.000Z"),
    );
    expect(result.room.phase).toBe("finished");
    expect(result.room.winnerPlayerId).toBe(guest.session.playerId);
    expect(result.room.round?.answer?.id).toBe("answer");
    expect(
      registry.getPlayerGame(host.room.code, host.session.playerId).status,
    ).toBe("lost");
  });

  it("requires at least two players and readiness before a race", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主");
    expect(() =>
      registry.start(host.room.code, host.session.playerId, [
        visualNovel("answer"),
      ]),
    ).toThrow("NOT_ENOUGH_PLAYERS");
    registry.join(host.room.code, "玩家二");
    expect(() =>
      registry.start(host.room.code, host.session.playerId, [
        visualNovel("answer"),
      ]),
    ).toThrow("PLAYERS_NOT_READY");
  });

  it("starts a solo room with one player", () => {
    const registry = new RoomRegistry();
    const host = registry.create("单人玩家", "solo", "novice");
    expect(() => registry.join(host.room.code, "旁观者")).toThrow("SOLO_ROOM");
    const started = registry.start(
      host.room.code,
      host.session.playerId,
      [{ ...visualNovel("answer"), vndbVoteCount: 1000 }],
      { random: () => 0 },
    );
    expect(started.phase).toBe("active");
    expect(started.rules.pool.fameTier).toBe("novice");
    expect(started.round?.players).toHaveLength(1);
  });

  it("caps 1v1 rooms at two players and awards a win when one leaves", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主", "duel");
    const guest = registry.join(host.room.code, "玩家二");
    expect(() => registry.join(host.room.code, "玩家三")).toThrow("ROOM_FULL");
    registry.setReady(host.room.code, guest.session.playerId, true);
    registry.start(host.room.code, host.session.playerId, [
      visualNovel("answer"),
    ]);
    const remaining = registry.leave(host.room.code, guest.session.playerId);
    expect(remaining?.phase).toBe("finished");
    expect(remaining?.winnerPlayerId).toBe(host.session.playerId);
  });

  it("transfers lobby ownership and deletes an empty room on leave", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主", "race");
    const guest = registry.join(host.room.code, "玩家二");
    const remaining = registry.leave(host.room.code, host.session.playerId);
    expect(remaining?.hostPlayerId).toBe(guest.session.playerId);
    expect(registry.leave(host.room.code, guest.session.playerId)).toBeNull();
    expect(() => registry.get(host.room.code)).toThrow("ROOM_NOT_FOUND");
  });
});
