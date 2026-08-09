import { describe, expect, it } from "vitest";
import { MatchmakingPool } from "./matchmaking.js";

describe("MatchmakingPool", () => {
  it("matches players in the same fame tier in FIFO order", () => {
    const pool = new MatchmakingPool();
    expect(
      pool.enqueue({
        socketId: "first",
        nickname: "甲",
        fameTier: "standard",
        bestOf: 1,
        joinedAt: 1,
      }),
    ).toEqual({ status: "waiting", position: 1 });
    expect(
      pool.enqueue({
        socketId: "second",
        nickname: "乙",
        fameTier: "standard",
        bestOf: 1,
        joinedAt: 2,
      }),
    ).toEqual({
      status: "matched",
      opponent: expect.objectContaining({ socketId: "first" }),
    });
    expect(pool.stats().total).toBe(0);
  });

  it("keeps different fame tiers in separate queues", () => {
    const pool = new MatchmakingPool();
    pool.enqueue({
      socketId: "novice",
      nickname: "萌新",
      fameTier: "novice",
      bestOf: 1,
      joinedAt: 1,
    });
    expect(
      pool.enqueue({
        socketId: "master",
        nickname: "标准 BO3",
        fameTier: "veteran",
        bestOf: 3,
        joinedAt: 2,
      }),
    ).toEqual({ status: "waiting", position: 1 });
    expect(pool.stats()).toEqual({
      total: 2,
      byFameTier: {
        novice: 1,
        standard: 0,
        veteran: 1,
      },
      byQueue: { "novice:bo1": 1, "veteran:bo3": 1 },
    });
  });

  it("never matches two sockets belonging to the same player identity", () => {
    const pool = new MatchmakingPool();
    pool.enqueue({
      socketId: "tab-one",
      nickname: "同一玩家",
      fameTier: "novice",
      bestOf: 1,
      playerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      joinedAt: 1,
    });
    expect(
      pool.enqueue({
        socketId: "tab-two",
        nickname: "同一玩家",
        fameTier: "novice",
        bestOf: 1,
        playerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        joinedAt: 2,
      }),
    ).toEqual({ status: "waiting", position: 2 });
    expect(pool.stats().total).toBe(2);
  });

  it("removes cancelled or disconnected sockets and updates positions", () => {
    const pool = new MatchmakingPool();
    pool.enqueue({
      socketId: "first",
      nickname: "甲",
      fameTier: "veteran",
      bestOf: 1,
      joinedAt: 1,
    });
    pool.enqueue({
      socketId: "other-tier",
      nickname: "丙",
      fameTier: "veteran",
      bestOf: 3,
      joinedAt: 2,
    });
    expect(pool.cancel("first")).toBe(true);
    expect(pool.position("first")).toBeNull();
    expect(pool.stats().total).toBe(1);
    expect(pool.cancel("missing")).toBe(false);
  });

  it("does not pair BO1 and BO3 players in the same difficulty", () => {
    const pool = new MatchmakingPool();
    pool.enqueue({
      socketId: "bo1",
      nickname: "甲",
      fameTier: "standard",
      bestOf: 1,
      joinedAt: 1,
    });
    expect(
      pool.enqueue({
        socketId: "bo3",
        nickname: "乙",
        fameTier: "standard",
        bestOf: 3,
        joinedAt: 2,
      }),
    ).toEqual({ status: "waiting", position: 1 });
    expect(pool.stats().byQueue).toEqual({
      "standard:bo1": 1,
      "standard:bo3": 1,
    });
  });
});
