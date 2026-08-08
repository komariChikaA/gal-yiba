import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { VisualNovel } from "@gal-yiba/shared";
import { migrateDatabase } from "../db/migrate.js";
import { RoomRegistry } from "../rooms.js";
import { MatchRecorder } from "./match-recorder.js";

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

let pool: Pool;

beforeEach(async () => {
  const memoryDatabase = newDb({ noAstCoverageCheck: true });
  const adapter = memoryDatabase.adapters.createPg();
  pool = new adapter.Pool() as Pool;
  await migrateDatabase(pool);
  await pool.query(
    "INSERT INTO canonical_visual_novels (id, display_title, review_status) VALUES ($1, $2, 'verified')",
    ["33333333-3333-4333-8333-333333333333", "作品 answer"],
  );
});

describe("forfeit match recording end-to-end", () => {
  it("records a duel finished by forfeit through the real room flow", async () => {
    const registry = new RoomRegistry();
    const host = registry.create("房主", "duel");
    const guest = registry.join(host.room.code, "玩家二");
    const catalog = [visualNovel("33333333-3333-4333-8333-333333333333")];
    registry.setReady(host.room.code, guest.session.playerId, true);
    registry.start(host.room.code, host.session.playerId, catalog, {
      random: () => 0,
      now: new Date("2026-08-08T00:00:00.000Z"),
    });

    const left = registry.leave(
      host.room.code,
      guest.session.playerId,
      new Date("2026-08-08T00:00:05.000Z"),
    );
    expect(left?.phase).toBe("finished");
    expect(left?.matchWinnerPlayerId).toBe(host.session.playerId);

    const report = registry.getMatchReport(host.room.code);
    expect(report).not.toBeNull();

    const recorder = new MatchRecorder(pool);
    await recorder.record(report);

    const players = await pool.query(
      "SELECT player_id, nickname, wins, is_winner FROM match_players",
    );
    console.log("match_players rows:", players.rows);
    expect(players.rows).toHaveLength(1);
    expect(players.rows[0]).toEqual({
      player_id: host.session.playerId,
      nickname: "房主",
      wins: 1,
      is_winner: true,
    });

    const matches = await pool.query(
      "SELECT room_code, mode, status, winner FROM match_records",
    );
    console.log("match_records rows:", matches.rows);
  });
});
