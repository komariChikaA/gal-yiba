import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { GameMode } from "@gal-yiba/shared";
import type { MatchReport } from "../rooms.js";

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  wins: number;
  matches: number;
}

/**
 * Persists finished matches (match_records + match_players + match_rounds)
 * and serves the leaderboard aggregation. A room produces one match record
 * per run; `forget` is called when a room is deleted or rematched so the
 * same room code can be recorded again.
 */
export class MatchRecorder {
  private readonly recorded = new Set<string>();

  constructor(private readonly pool: Pool | null) {}

  async record(report: MatchReport | null): Promise<void> {
    if (!report || !this.pool || this.recorded.has(report.roomCode)) return;
    this.recorded.add(report.roomCode);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const matchId = randomUUID();
      await client.query(
        `INSERT INTO match_records
          (id, room_code, mode, rules_snapshot, status, started_at, finished_at)
         VALUES ($1, $2, $3, $4::jsonb, 'finished', $5, $6)`,
        [
          matchId,
          report.roomCode,
          report.mode,
          JSON.stringify(report.rules),
          report.startedAt,
          report.finishedAt,
        ],
      );
      for (const player of report.players) {
        await client.query(
          `INSERT INTO match_players
            (match_id, player_id, nickname, wins, is_winner)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            matchId,
            player.playerId,
            player.nickname,
            player.wins,
            player.playerId === report.winnerPlayerId,
          ],
        );
        await client.query(
          `INSERT INTO players (player_id, nickname, updated_at, feature_code)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (player_id)
           DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = EXCLUDED.updated_at,
                         feature_code = EXCLUDED.feature_code`,
          [
            player.playerId,
            player.nickname,
            report.finishedAt,
            player.featureCode,
          ],
        );
      }
      for (const round of report.rounds) {
        await client.query(
          `INSERT INTO match_rounds
            (id, match_id, round_number, answer_canonical_id, answer_snapshot, started_at, finished_at, winner_player_id)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
          [
            randomUUID(),
            matchId,
            round.roundNumber,
            round.answerId,
            JSON.stringify(round.answerSnapshot),
            round.startedAt,
            round.finishedAt,
            round.winnerPlayerId,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      this.recorded.delete(report.roomCode);
      throw error;
    } finally {
      client.release();
    }
  }

  forget(roomCode: string): void {
    this.recorded.delete(roomCode);
  }

  async leaderboard(options: {
    mode?: GameMode;
    limit?: number;
  } = {}): Promise<LeaderboardEntry[]> {
    if (!this.pool) return [];
    const limit = Math.min(50, Math.max(1, options.limit ?? 20));
    const params: (string | number)[] = [limit];
    const modeClause = options.mode ? "AND mr.mode = $2" : "";
    if (options.mode) params.push(options.mode);
    const result = await this.pool.query<{
      player_id: string;
      nickname: string;
      wins: number;
      matches: number;
    }>(
      `SELECT mp.player_id,
              p.nickname AS nickname,
              COUNT(CASE WHEN mp.is_winner THEN 1 END)::int AS wins,
              COUNT(*)::int AS matches
       FROM match_players mp
       JOIN match_records mr ON mr.id = mp.match_id
       JOIN players p ON p.player_id = mp.player_id
       WHERE mr.status = 'finished' ${modeClause}
       GROUP BY mp.player_id, p.nickname
       ORDER BY wins DESC, matches ASC, nickname ASC
       LIMIT $1`,
      params,
    );
    return result.rows.map((row) => ({
      playerId: row.player_id,
      nickname: row.nickname,
      wins: row.wins,
      matches: row.matches,
    }));
  }
}
