import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  calculateRankedPtDeltas,
  rankFromPt,
  type GameMode,
  type PlayerRank,
} from "@gal-yiba/shared";
import type { MatchReport } from "../rooms.js";

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  wins: number;
  matches: number;
}

export interface RankedLeaderboardEntry extends LeaderboardEntry {
  pt: number;
  rank: PlayerRank;
}

export interface RankedProfile {
  playerId: string;
  pt: number;
  wins: number;
  matches: number;
  rank: PlayerRank;
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
          (id, room_code, mode, rules_snapshot, status, started_at, finished_at,
           ranked_match, ranked_fame_tier, ranked_best_of)
         VALUES ($1, $2, $3, $4::jsonb, 'finished', $5, $6, $7, $8, $9)`,
        [
          matchId,
          report.roomCode,
          report.mode,
          JSON.stringify(report.rules),
          report.startedAt,
          report.finishedAt,
          report.rankedMatch !== null,
          report.rankedMatch?.fameTier ?? null,
          report.rankedMatch?.bestOf ?? null,
        ],
      );
      for (const player of report.players) {
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

      const ptChanges = new Map<string, { delta: number; after: number }>();
      if (report.rankedMatch && report.winnerPlayerId) {
        const winner = report.players.find(
          (player) => player.playerId === report.winnerPlayerId,
        );
        const loser = report.players.find(
          (player) => player.playerId !== report.winnerPlayerId,
        );
        if (winner && loser) {
          const current = await client.query<{
            player_id: string;
            ranked_pt: number;
          }>(
            `SELECT player_id, ranked_pt
             FROM players
             WHERE player_id IN ($1, $2)
             FOR UPDATE`,
            [winner.playerId, loser.playerId],
          );
          const points = new Map(
            current.rows.map((row) => [row.player_id, row.ranked_pt]),
          );
          const deltas = calculateRankedPtDeltas({
            ...report.rankedMatch,
            winnerPt: points.get(winner.playerId) ?? 0,
            loserPt: points.get(loser.playerId) ?? 0,
          });
          const winnerAfter =
            (points.get(winner.playerId) ?? 0) + deltas.winnerDelta;
          const loserAfter = Math.max(
            0,
            (points.get(loser.playerId) ?? 0) + deltas.loserDelta,
          );
          ptChanges.set(winner.playerId, {
            delta: deltas.winnerDelta,
            after: winnerAfter,
          });
          ptChanges.set(loser.playerId, {
            delta: loserAfter - (points.get(loser.playerId) ?? 0),
            after: loserAfter,
          });
          await client.query(
            `UPDATE players
             SET ranked_pt = $2, ranked_matches = ranked_matches + 1,
                 ranked_wins = ranked_wins + 1
             WHERE player_id = $1`,
            [winner.playerId, winnerAfter],
          );
          await client.query(
            `UPDATE players
             SET ranked_pt = $2, ranked_matches = ranked_matches + 1
             WHERE player_id = $1`,
            [loser.playerId, loserAfter],
          );
        }
      }

      for (const player of report.players) {
        const ptChange = ptChanges.get(player.playerId);
        await client.query(
          `INSERT INTO match_players
            (match_id, player_id, nickname, wins, is_winner, pt_delta, pt_after)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            matchId,
            player.playerId,
            player.nickname,
            player.wins,
            player.playerId === report.winnerPlayerId,
            ptChange?.delta ?? 0,
            ptChange?.after ?? null,
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

  async leaderboard(
    options: {
      mode?: GameMode;
      limit?: number;
    } = {},
  ): Promise<LeaderboardEntry[]> {
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

  async rankedLeaderboard(limitInput = 20): Promise<RankedLeaderboardEntry[]> {
    if (!this.pool) return [];
    const limit = Math.min(50, Math.max(1, limitInput));
    const result = await this.pool.query<{
      player_id: string;
      nickname: string;
      ranked_pt: number;
      ranked_wins: number;
      ranked_matches: number;
    }>(
      `SELECT player_id, nickname, ranked_pt, ranked_wins, ranked_matches
       FROM players
       WHERE ranked_matches > 0
       ORDER BY ranked_pt DESC, ranked_wins DESC, ranked_matches ASC, nickname ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      playerId: row.player_id,
      nickname: row.nickname,
      pt: row.ranked_pt,
      wins: row.ranked_wins,
      matches: row.ranked_matches,
      rank: rankFromPt(row.ranked_pt),
    }));
  }

  async rankedProfiles(playerIds: string[]): Promise<RankedProfile[]> {
    const uniqueIds = [...new Set(playerIds)];
    if (uniqueIds.length === 0) return [];
    if (!this.pool) {
      return uniqueIds.map((playerId) => ({
        playerId,
        pt: 0,
        wins: 0,
        matches: 0,
        rank: rankFromPt(0),
      }));
    }
    const placeholders = uniqueIds
      .map((_, index) => `$${index + 1}`)
      .join(", ");
    const result = await this.pool.query<{
      player_id: string;
      ranked_pt: number;
      ranked_wins: number;
      ranked_matches: number;
    }>(
      `SELECT player_id, ranked_pt, ranked_wins, ranked_matches
       FROM players WHERE player_id IN (${placeholders})`,
      uniqueIds,
    );
    const existing = new Map(result.rows.map((row) => [row.player_id, row]));
    return uniqueIds.map((playerId) => {
      const row = existing.get(playerId);
      const pt = row?.ranked_pt ?? 0;
      return {
        playerId,
        pt,
        wins: row?.ranked_wins ?? 0,
        matches: row?.ranked_matches ?? 0,
        rank: rankFromPt(pt),
      };
    });
  }
}
