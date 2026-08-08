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
    expect(created.room.rules.roundTimeSeconds).toBe(300);
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

  it("automatically expires an active round when its deadline passes", () => {
    const registry = new RoomRegistry();
    const host = registry.create("单人玩家", "solo", "standard");
    const started = registry.start(
      host.room.code,
      host.session.playerId,
      [visualNovel("answer")],
      { now: new Date("2026-08-09T00:00:00.000Z"), random: () => 0 },
    );
    expect(
      registry.expire(host.room.code, new Date("2026-08-09T00:04:59.000Z")),
    ).toBeNull();
    const expired = registry.expire(
      host.room.code,
      new Date("2026-08-09T00:05:00.000Z"),
    );
    expect(expired?.phase).toBe("finished");
    expect(expired?.winnerPlayerId).toBeNull();
    expect(expired?.round?.players[0]?.status).toBe("expired");
    expect(expired?.round?.answer?.id).toBe("answer");
  });
});

describe("best-of rounds", () => {
  const catalog = [visualNovel("answer")];

  function startDuel(registry: RoomRegistry, bestOf: 1 | 3 | 5 | 7) {
    const host = registry.create("房主", "duel");
    const guest = registry.join(host.room.code, "玩家二");
    registry.setReady(host.room.code, guest.session.playerId, true);
    registry.updateRules(host.room.code, host.session.playerId, {
      ...host.room.rules,
      bestOf,
    });
    registry.start(host.room.code, host.session.playerId, catalog, {
      random: () => 0,
      now: new Date("2026-08-08T00:00:00.000Z"),
    });
    return { host, guest };
  }

  it("rests between rounds and reveals the answer during intermission", () => {
    const registry = new RoomRegistry();
    const { host, guest } = startDuel(registry, 3);
    const first = registry.submitPlayerGuess(
      host.room.code,
      guest.session.playerId,
      "answer",
      catalog,
      new Date("2026-08-08T00:00:05.000Z"),
    );
    expect(first.room.phase).toBe("round_result");
    expect(first.room.round?.roundNumber).toBe(1);
    expect(first.room.round?.answer?.title).toBe("作品 answer");
    expect(first.room.intermissionDeadlineAt).toBe(
      "2026-08-08T00:01:05.000Z",
    );
    expect(first.room.scores).toEqual([
      { playerId: host.session.playerId, wins: 0 },
      { playerId: guest.session.playerId, wins: 1 },
    ]);
    expect(first.room.matchWinnerPlayerId).toBeNull();
  });

  it("starts the next round early when everyone readies up", () => {
    const registry = new RoomRegistry();
    const { host, guest } = startDuel(registry, 3);
    registry.submitPlayerGuess(
      host.room.code,
      guest.session.playerId,
      "answer",
      catalog,
      new Date("2026-08-08T00:00:05.000Z"),
    );
    registry.setReady(host.room.code, host.session.playerId, true);
    const second = registry.setReady(
      host.room.code,
      guest.session.playerId,
      true,
    );
    expect(second.phase).toBe("active");
    expect(second.round?.roundNumber).toBe(2);
    expect(second.intermissionDeadlineAt).toBeNull();
    expect(second.players.every((player) => !player.ready)).toBe(true);

    const finished = registry.submitPlayerGuess(
      host.room.code,
      guest.session.playerId,
      "answer",
      catalog,
      new Date("2026-08-08T00:02:05.000Z"),
    );
    expect(finished.room.phase).toBe("finished");
    expect(finished.room.matchWinnerPlayerId).toBe(guest.session.playerId);
    expect(finished.room.scores).toEqual([
      { playerId: host.session.playerId, wins: 0 },
      { playerId: guest.session.playerId, wins: 2 },
    ]);
  });

  it("starts the next round after the intermission deadline regardless of readiness", () => {
    const registry = new RoomRegistry();
    const { host, guest } = startDuel(registry, 3);
    registry.submitPlayerGuess(
      host.room.code,
      guest.session.playerId,
      "answer",
      catalog,
      new Date("2026-08-08T00:00:05.000Z"),
    );
    const advanced = registry.advanceIntermission(
      host.room.code,
      new Date("2026-08-08T00:01:05.000Z"),
    );
    expect(advanced?.phase).toBe("active");
    expect(advanced?.round?.roundNumber).toBe(2);
  });

  it("ends the match by forfeit when the opponent leaves", () => {
    const registry = new RoomRegistry();
    const { host, guest } = startDuel(registry, 3);
    const remaining = registry.leave(host.room.code, guest.session.playerId);
    expect(remaining?.phase).toBe("finished");
    expect(remaining?.matchWinnerPlayerId).toBe(host.session.playerId);
    expect(remaining?.scores).toEqual([
      { playerId: host.session.playerId, wins: 1 },
    ]);
  });

  it("never starts more rounds than the configured best of", () => {
    const registry = new RoomRegistry();
    const { host, guest } = startDuel(registry, 3);
    for (let round = 1; round <= 3; round += 1) {
      const expired = registry.expire(
        host.room.code,
        new Date(
          `2026-08-08T00:${String(round * 6).padStart(2, "0")}:00.000Z`,
        ),
      );
      if (round < 3) {
        expect(expired?.phase).toBe("round_result");
        const advanced = registry.advanceIntermission(
          host.room.code,
          new Date(
            `2026-08-08T00:${String(round * 6 + 1).padStart(2, "0")}:00.000Z`,
          ),
        );
        expect(advanced?.phase).toBe("active");
        expect(advanced?.round?.roundNumber).toBe(round + 1);
      } else {
        expect(expired?.phase).toBe("finished");
        expect(expired?.round?.roundNumber).toBe(round);
      }
    }
    expect(registry.get(host.room.code).matchWinnerPlayerId).toBeNull();
  });
});

describe("rematch in the same room", () => {
  it("resets a finished match back to a lobby for another run", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主", "duel");
    const guest = registry.join(host.room.code, "玩家二");
    registry.setReady(host.room.code, guest.session.playerId, true);
    const catalog = [visualNovel("answer")];
    registry.start(host.room.code, host.session.playerId, catalog, {
      random: () => 0,
      now: new Date("2026-08-08T00:00:00.000Z"),
    });
    const finished = registry.submitPlayerGuess(
      host.room.code,
      guest.session.playerId,
      "answer",
      catalog,
      new Date("2026-08-08T00:00:05.000Z"),
    );
    expect(finished.room.phase).toBe("finished");

    const lobby = registry.rematch(host.room.code, host.session.playerId);
    expect(lobby.phase).toBe("lobby");
    expect(lobby.round).toBeNull();
    expect(lobby.matchWinnerPlayerId).toBeNull();
    expect(lobby.scores).toEqual([
      { playerId: host.session.playerId, wins: 0 },
      { playerId: guest.session.playerId, wins: 0 },
    ]);
    expect(lobby.players.every((player) => !player.ready)).toBe(true);

    registry.setReady(host.room.code, guest.session.playerId, true);
    const second = registry.start(
      host.room.code,
      host.session.playerId,
      catalog,
      {
        random: () => 0,
        now: new Date("2026-08-08T00:01:00.000Z"),
      },
    );
    expect(second.phase).toBe("active");
    expect(second.round?.roundNumber).toBe(1);
  });

  it("lets only the host rematch and only after the match finished", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主", "duel");
    const guest = registry.join(host.room.code, "玩家二");
    const catalog = [visualNovel("answer")];
    expect(() =>
      registry.rematch(host.room.code, host.session.playerId),
    ).toThrow("ROOM_NOT_FINISHED");

    registry.setReady(host.room.code, guest.session.playerId, true);
    registry.start(host.room.code, host.session.playerId, catalog, {
      random: () => 0,
    });
    expect(() =>
      registry.rematch(host.room.code, guest.session.playerId),
    ).toThrow("ROOM_NOT_FINISHED");

    registry.submitPlayerGuess(
      host.room.code,
      guest.session.playerId,
      "answer",
      catalog,
      new Date("2026-08-08T00:00:05.000Z"),
    );
    expect(() =>
      registry.rematch(host.room.code, guest.session.playerId),
    ).toThrow("HOST_ONLY");
    expect(
      registry.rematch(host.room.code, host.session.playerId).phase,
    ).toBe("lobby");
  });
});

describe("stable player identity and match reports", () => {
  const hostId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const guestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("keeps a client-provided player id across create and join", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主", "duel", "standard", hostId);
    const guest = registry.join(host.room.code, "玩家二", guestId);
    expect(host.session.playerId).toBe(hostId);
    expect(guest.session.playerId).toBe(guestId);
    expect(host.room.players.map((player) => player.id)).toContain(hostId);
    expect(guest.room.players.map((player) => player.id)).toContain(guestId);
  });

  it("exposes a finished single-round match report", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主", "duel", "standard", hostId);
    const guest = registry.join(host.room.code, "玩家二", guestId);
    registry.setReady(host.room.code, guestId, true);
    const catalog = [visualNovel("answer")];
    registry.start(host.room.code, hostId, catalog, {
      random: () => 0,
      now: new Date("2026-08-08T00:00:00.000Z"),
    });
    expect(registry.getMatchReport(host.room.code)).toBeNull();
    registry.submitPlayerGuess(
      host.room.code,
      guestId,
      "answer",
      catalog,
      new Date("2026-08-08T00:00:05.000Z"),
    );
    const report = registry.getMatchReport(host.room.code);
    expect(report).not.toBeNull();
    expect(report?.mode).toBe("duel");
    expect(report?.winnerPlayerId).toBe(guestId);
    expect(report?.rounds).toHaveLength(1);
    expect(report?.rounds[0]?.winnerPlayerId).toBe(guestId);
    expect(report?.rounds[0]?.answerId).toBe("answer");
    expect(report?.players).toEqual([
      {
        playerId: hostId,
        nickname: "房主",
        wins: 0,
        featureCode: null,
      },
      {
        playerId: guestId,
        nickname: "玩家二",
        wins: 1,
        featureCode: null,
      },
    ]);
  });

  it("reports every round of a best-of match with its winner", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主", "duel", "standard", hostId);
    const guest = registry.join(host.room.code, "玩家二", guestId);
    registry.setReady(host.room.code, guestId, true);
    registry.updateRules(host.room.code, hostId, {
      ...host.room.rules,
      bestOf: 3,
    });
    const catalog = [visualNovel("answer")];
    registry.start(host.room.code, hostId, catalog, {
      random: () => 0,
      now: new Date("2026-08-08T00:00:00.000Z"),
    });
    registry.submitPlayerGuess(
      host.room.code,
      guestId,
      "answer",
      catalog,
      new Date("2026-08-08T00:00:05.000Z"),
    );
    registry.setReady(host.room.code, hostId, true);
    registry.setReady(host.room.code, guestId, true);
    registry.submitPlayerGuess(
      host.room.code,
      guestId,
      "answer",
      catalog,
      new Date("2026-08-08T00:02:05.000Z"),
    );
    const report = registry.getMatchReport(host.room.code);
    expect(report?.rounds).toHaveLength(2);
    expect(report?.rounds.map((round) => round.winnerPlayerId)).toEqual([
      guestId,
      guestId,
    ]);
    expect(report?.winnerPlayerId).toBe(guestId);
  });

  it("clears the round history after a rematch", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主", "duel", "standard", hostId);
    const guest = registry.join(host.room.code, "玩家二", guestId);
    registry.setReady(host.room.code, guestId, true);
    const catalog = [visualNovel("answer")];
    registry.start(host.room.code, hostId, catalog, { random: () => 0 });
    registry.submitPlayerGuess(
      host.room.code,
      guestId,
      "answer",
      catalog,
      new Date("2026-08-08T00:00:05.000Z"),
    );
    expect(registry.getMatchReport(host.room.code)).not.toBeNull();
    registry.rematch(host.room.code, hostId);
    expect(registry.getMatchReport(host.room.code)).toBeNull();
  });
});

describe("room chat", () => {
  it("posts and returns a chat message with the sender nickname", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主");
    const message = registry.postChat(
      host.room.code,
      host.session.playerId,
      "  大家加油！  ",
      new Date("2026-08-08T00:00:00.000Z"),
    );
    expect(message).toEqual({
      playerId: host.session.playerId,
      nickname: "房主",
      text: "大家加油！",
      at: "2026-08-08T00:00:00.000Z",
    });
    expect(registry.chatHistory(host.room.code)).toHaveLength(1);
  });

  it("rejects empty text, oversized text, and unknown players", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主");
    expect(() =>
      registry.postChat(host.room.code, host.session.playerId, "   "),
    ).toThrow("CHAT_EMPTY");
    expect(() =>
      registry.postChat(
        host.room.code,
        host.session.playerId,
        "字".repeat(201),
      ),
    ).toThrow("CHAT_TOO_LONG");
    expect(() =>
      registry.postChat(
        host.room.code,
        "00000000-0000-4000-8000-000000000000",
        "hi",
      ),
    ).toThrow("PLAYER_NOT_FOUND");
  });

  it("rate-limits rapid messages from the same player", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主");
    registry.postChat(
      host.room.code,
      host.session.playerId,
      "第一条",
      new Date("2026-08-08T00:00:00.000Z"),
    );
    expect(() =>
      registry.postChat(
        host.room.code,
        host.session.playerId,
        "太快了",
        new Date("2026-08-08T00:00:00.200Z"),
      ),
    ).toThrow("CHAT_TOO_FAST");
    const ok = registry.postChat(
      host.room.code,
      host.session.playerId,
      "隔了半秒",
      new Date("2026-08-08T00:00:00.600Z"),
    );
    expect(ok.text).toBe("隔了半秒");
  });

  it("bounds the chat history to the last 100 messages", () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主");
    const base = new Date("2026-08-08T00:00:00.000Z").getTime();
    for (let index = 0; index < 120; index += 1) {
      registry.postChat(
        host.room.code,
        host.session.playerId,
        `消息 ${index}`,
        new Date(base + index * 600),
      );
    }
    const history = registry.chatHistory(host.room.code);
    expect(history).toHaveLength(100);
    expect(history[0]?.text).toBe("消息 20");
    expect(history[history.length - 1]?.text).toBe("消息 119");
  });
});
