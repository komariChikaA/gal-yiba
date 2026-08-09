import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateDatabase } from "../db/migrate.js";
import { MatchRecorder } from "./match-recorder.js";
import type { MatchReport } from "../rooms.js";

function report(overrides: Partial<MatchReport> = {}): MatchReport {
  return {
    roomCode: "ABCDE",
    mode: "duel",
    rules: {
      version: 1,
      mode: "duel",
      maxGuesses: 8,
      roundTimeSeconds: 300,
      bestOf: 1,
      replayTiedRounds: true,
      comparisonKeys: ["developer", "releaseYear"],
      pool: {
        includeTags: [],
        excludeTags: [],
        tagMode: "all",
        allAgesOnly: false,
        includeOtome: false,
        includeChina: false,
        includeWest: false,
        maxTagSpoilerLevel: 0,
        fameTier: "standard",
      },
    },
    status: "finished",
    startedAt: "2026-08-08T00:00:00.000Z",
    finishedAt: "2026-08-08T00:05:00.000Z",
    winnerPlayerId: "11111111-1111-4111-8111-111111111111",
    rankedMatch: null,
    players: [
      {
        playerId: "11111111-1111-4111-8111-111111111111",
        nickname: "房主",
        wins: 1,
        featureCode: "MYCODE",
      },
      {
        playerId: "22222222-2222-4222-8222-222222222222",
        nickname: "对手",
        wins: 0,
        featureCode: null,
      },
    ],
    rounds: [
      {
        roundNumber: 1,
        answerId: "33333333-3333-4333-8333-333333333333",
        answerSnapshot: {
          id: "33333333-3333-4333-8333-333333333333",
          title: "答案作品",
        },
        startedAt: "2026-08-08T00:00:00.000Z",
        finishedAt: "2026-08-08T00:05:00.000Z",
        winnerPlayerId: "11111111-1111-4111-8111-111111111111",
      },
    ],
    ...overrides,
  };
}
let pool: Pool;

beforeEach(async () => {
  const memoryDatabase = newDb({ noAstCoverageCheck: true });
  const adapter = memoryDatabase.adapters.createPg();
  pool = new adapter.Pool() as Pool;
  await migrateDatabase(pool);
  await pool.query(
    "INSERT INTO canonical_visual_novels (id, display_title, review_status) VALUES ($1, $2, 'verified')",
    ["33333333-3333-4333-8333-333333333333", "答案作品"],
  );
});

afterEach(async () => {
  await pool.end();
});

describe("MatchRecorder", () => {
  it("records a finished match across all three tables", async () => {
    const recorder = new MatchRecorder(pool);
    await recorder.record(report());
    const matches = await pool.query(
      "SELECT room_code, mode, status FROM match_records",
    );
    expect(matches.rows).toEqual([
      { room_code: "ABCDE", mode: "duel", status: "finished" },
    ]);
    const players = await pool.query(
      "SELECT nickname, wins, is_winner FROM match_players ORDER BY wins DESC",
    );
    expect(players.rows).toEqual([
      { nickname: "房主", wins: 1, is_winner: true },
      { nickname: "对手", wins: 0, is_winner: false },
    ]);
    const rounds = await pool.query(
      "SELECT round_number, answer_canonical_id, winner_player_id FROM match_rounds",
    );
    expect(rounds.rows).toEqual([
      {
        round_number: 1,
        answer_canonical_id: "33333333-3333-4333-8333-333333333333",
        winner_player_id: "11111111-1111-4111-8111-111111111111",
      },
    ]);
  });

  it("records the same room only once per run", async () => {
    const recorder = new MatchRecorder(pool);
    await recorder.record(report());
    await recorder.record(report());
    const matches = await pool.query(
      "SELECT count(*)::int AS n FROM match_records",
    );
    expect(matches.rows[0]!.n).toBe(1);
  });
  it("allows a rematched room to be recorded again after forget", async () => {
    const recorder = new MatchRecorder(pool);
    await recorder.record(report());
    recorder.forget("ABCDE");
    await recorder.record(report({ startedAt: "2026-08-09T00:00:00.000Z" }));
    const matches = await pool.query(
      "SELECT count(*)::int AS n FROM match_records",
    );
    expect(matches.rows[0]!.n).toBe(2);
  });

  it("no-ops without a database pool", async () => {
    const recorder = new MatchRecorder(null);
    await recorder.record(report());
    expect(await recorder.leaderboard({ limit: 5 })).toEqual([]);
  });

  it("aggregates the leaderboard by player with latest nickname", async () => {
    const recorder = new MatchRecorder(pool);
    const winner = "11111111-1111-4111-8111-111111111111";
    await recorder.record(
      report({
        roomCode: "AAAAA",
        winnerPlayerId: winner,
        players: [
          { playerId: winner, nickname: "老名字", wins: 1, featureCode: "WIN" },
          {
            playerId: "22222222-2222-4222-8222-222222222222",
            nickname: "乙",
            wins: 0,
            featureCode: null,
          },
        ],
      }),
    );
    await recorder.forget("AAAAA");
    await recorder.record(
      report({
        roomCode: "BBBBB",
        winnerPlayerId: winner,
        startedAt: "2026-08-09T00:00:00.000Z",
        finishedAt: "2026-08-09T00:05:00.000Z",
        players: [
          { playerId: winner, nickname: "新名字", wins: 1, featureCode: "WIN" },
          {
            playerId: "22222222-2222-4222-8222-222222222222",
            nickname: "乙",
            wins: 0,
            featureCode: null,
          },
        ],
      }),
    );
    const items = await recorder.leaderboard({ limit: 10 });
    expect(items[0]).toEqual({
      playerId: winner,
      nickname: "新名字",
      wins: 2,
      matches: 2,
    });
    const duelOnly = await recorder.leaderboard({ mode: "solo", limit: 10 });
    expect(duelOnly).toEqual([]);
  });

  it("stores the feature code on the players row", async () => {
    const recorder = new MatchRecorder(pool);
    await recorder.record(report());
    const players = await pool.query(
      "SELECT player_id, feature_code FROM players ORDER BY feature_code DESC NULLS LAST",
    );
    expect(players.rows).toEqual([
      {
        player_id: "11111111-1111-4111-8111-111111111111",
        feature_code: "MYCODE",
      },
      {
        player_id: "22222222-2222-4222-8222-222222222222",
        feature_code: null,
      },
    ]);
  });

  it("awards the revised +20 novice BO1 reward and floors losses at zero", async () => {
    const recorder = new MatchRecorder(pool);
    await recorder.record(
      report({ rankedMatch: { fameTier: "novice", bestOf: 1 } }),
    );
    const players = await pool.query(
      `SELECT nickname, ranked_pt, ranked_wins, ranked_matches
       FROM players ORDER BY ranked_pt DESC`,
    );
    expect(players.rows).toEqual([
      {
        nickname: "房主",
        ranked_pt: 20,
        ranked_wins: 1,
        ranked_matches: 1,
      },
      {
        nickname: "对手",
        ranked_pt: 0,
        ranked_wins: 0,
        ranked_matches: 1,
      },
    ]);
    const changes = await pool.query(
      "SELECT nickname, pt_delta, pt_after FROM match_players ORDER BY pt_after DESC",
    );
    expect(changes.rows).toEqual([
      { nickname: "房主", pt_delta: 20, pt_after: 20 },
      { nickname: "对手", pt_delta: 0, pt_after: 0 },
    ]);
  });

  it("applies BO3 PT, supports ranked rematches, and builds a PT leaderboard", async () => {
    const recorder = new MatchRecorder(pool);
    const winner = "11111111-1111-4111-8111-111111111111";
    const loser = "22222222-2222-4222-8222-222222222222";
    await pool.query(
      `INSERT INTO players (player_id, nickname, ranked_pt)
       VALUES ($1, '房主', 100), ($2, '对手', 100)`,
      [winner, loser],
    );
    await recorder.record(
      report({
        rankedMatch: { fameTier: "veteran", bestOf: 3 },
        rules: { ...report().rules, bestOf: 3 },
      }),
    );
    recorder.forget("ABCDE");
    await recorder.record(
      report({
        roomCode: "ABCDE",
        startedAt: "2026-08-09T00:00:00.000Z",
        finishedAt: "2026-08-09T00:05:00.000Z",
        winnerPlayerId: loser,
        rankedMatch: { fameTier: "veteran", bestOf: 3 },
        rules: { ...report().rules, bestOf: 3 },
        players: [
          {
            playerId: winner,
            nickname: "房主",
            wins: 0,
            featureCode: "MYCODE",
          },
          { playerId: loser, nickname: "对手", wins: 2, featureCode: null },
        ],
      }),
    );

    const leaderboard = await recorder.rankedLeaderboard(10);
    expect(leaderboard).toHaveLength(2);
    expect(leaderboard[0]).toMatchObject({
      playerId: loser,
      wins: 1,
      matches: 2,
      pt: 119,
      rank: { label: "初心★2" },
    });
    expect(leaderboard[1]).toMatchObject({
      playerId: winner,
      wins: 1,
      matches: 2,
      pt: 117,
      rank: { label: "初心★2" },
    });
  });
});
