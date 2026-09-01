import { randomInt, randomUUID } from "node:crypto";
import {
  comparisonKeys,
  createGameSession,
  defaultGameRules,
  publicGameSession,
  submitGuess,
  type GameRules,
  type FameTier,
  type GameMode,
  type GameSession,
  type PublicGameSession,
  type RankedBestOf,
  type RankedFameTier,
  type VisualNovel,
} from "@gal-yiba/shared";

const roomAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface RoomPlayer {
  id: string;
  nickname: string;
  ready: boolean;
  connected: boolean;
  rankLabel: string | null;
}

export interface RankedMatchConfig {
  fameTier: RankedFameTier;
  bestOf: RankedBestOf;
}

export interface CreateRoomOptions {
  rulesLocked?: boolean;
  rankedMatch?: RankedMatchConfig;
  hostRankLabel?: string | null;
}

export interface RoomSnapshot {
  code: string;
  phase: "lobby" | "countdown" | "active" | "round_result" | "finished";
  hostPlayerId: string;
  players: RoomPlayer[];
  rules: GameRules;
  rulesLocked: boolean;
  rankedMatch: RankedMatchConfig | null;
  rematchVotes: string[];
  round: RoomRoundSnapshot | null;
  winnerPlayerId: string | null;
  matchWinnerPlayerId: string | null;
  scores: Array<{ playerId: string; wins: number }>;
  intermissionDeadlineAt: string | null;
  revision: number;
}

export interface RoomRoundSnapshot {
  roundNumber: number;
  startedAt: string;
  deadlineAt: string;
  answer: Pick<VisualNovel, "id" | "title"> | null;
  players: Array<{
    playerId: string;
    status: GameSession["status"];
    guessCount: number;
    guessStatuses: string[];
    guessDetails: Array<{
      guessNumber: number;
      titleStatus: string;
      comparisons: Array<{
        status: string;
        hint: string | null;
        direction: string | null;
      }>;
    }>;
    finishedAt: string | null;
  }>;
}

interface MutableRound {
  roundNumber: number;
  sequenceNumber: number;
  answer: VisualNovel;
  playerGames: Map<string, GameSession>;
}

interface MutableRoundRecord {
  roundNumber: number;
  answer: VisualNovel;
  startedAt: string;
  finishedAt: string | null;
  winnerPlayerId: string | null;
}

export interface ChatMessage {
  playerId: string;
  nickname: string;
  text: string;
  audioId: string | null;
  at: string;
}

interface MutableRoom extends Omit<
  RoomSnapshot,
  "players" | "round" | "scores" | "rematchVotes"
> {
  players: Map<string, RoomPlayer>;
  round: MutableRound | null;
  scores: Map<string, number>;
  catalog: VisualNovel[];
  roundHistory: MutableRoundRecord[];
  chat: ChatMessage[];
  featureCodes: Map<string, string | null>;
  rematchVotes: Set<string>;
}
export interface MatchRoundReport {
  roundNumber: number;
  answerId: string;
  answerSnapshot: { id: string; title: string };
  startedAt: string;
  finishedAt: string | null;
  winnerPlayerId: string | null;
}

export interface MatchPlayerReport {
  playerId: string;
  nickname: string;
  wins: number;
  featureCode: string | null;
}

export interface MatchReport {
  roomCode: string;
  mode: GameMode;
  rules: GameRules;
  status: "finished";
  startedAt: string;
  finishedAt: string;
  winnerPlayerId: string | null;
  rankedMatch: RankedMatchConfig | null;
  players: MatchPlayerReport[];
  rounds: MatchRoundReport[];
}

export interface PlayerSession {
  playerId: string;
  reconnectToken: string;
}

export const defaultRules: GameRules = defaultGameRules;

function createRoomCode(): string {
  return Array.from(
    { length: 5 },
    () => roomAlphabet[randomInt(roomAlphabet.length)],
  ).join("");
}

function cloneRules(rules: GameRules): GameRules {
  return structuredClone(rules);
}

function snapshot(room: MutableRoom): RoomSnapshot {
  const roundFinished =
    room.phase === "round_result" || room.phase === "finished";
  return {
    code: room.code,
    phase: room.phase,
    hostPlayerId: room.hostPlayerId,
    players: Array.from(room.players.values(), (player) => ({ ...player })),
    rules: cloneRules(room.rules),
    rulesLocked: room.rulesLocked,
    rankedMatch: room.rankedMatch ? { ...room.rankedMatch } : null,
    rematchVotes: [...room.rematchVotes],
    round: room.round
      ? {
          roundNumber: room.round.roundNumber,
          startedAt: [...room.round.playerGames.values()][0]?.startedAt ?? "",
          deadlineAt: [...room.round.playerGames.values()][0]?.deadlineAt ?? "",
          answer: roundFinished
            ? { id: room.round.answer.id, title: room.round.answer.title }
            : null,
          players: [...room.round.playerGames].map(([playerId, game]) => ({
            playerId,
            status: game.status,
            guessCount: game.guesses.length,
            guessStatuses: game.guesses.map((guess) => guess.titleStatus),
            guessDetails: game.guesses.map((guess) => ({
              guessNumber: guess.guessNumber,
              titleStatus: guess.titleStatus,
              comparisons: guess.comparison.map((comparison) => ({
                status: comparison.status,
                hint: comparison.hint ?? null,
                direction: comparison.direction ?? null,
              })),
            })),
            finishedAt: game.finishedAt,
          })),
        }
      : null,
    winnerPlayerId: room.winnerPlayerId,
    matchWinnerPlayerId: room.matchWinnerPlayerId,
    scores: [...room.scores].map(([playerId, wins]) => ({ playerId, wins })),
    intermissionDeadlineAt: room.intermissionDeadlineAt,
    revision: room.revision,
  };
}

export class RoomRegistry {
  private readonly rooms = new Map<string, MutableRoom>();
  private readonly reconnectTokens = new Map<
    string,
    { roomCode: string; playerId: string }
  >();

  activityStats(): { activeRooms: number; battlingPlayers: number } {
    let activeRooms = 0;
    let battlingPlayers = 0;
    for (const room of this.rooms.values()) {
      if (
        room.phase !== "countdown" &&
        room.phase !== "active" &&
        room.phase !== "round_result"
      ) {
        continue;
      }
      activeRooms += 1;
      battlingPlayers += [...room.players.values()].filter(
        (player) => player.connected,
      ).length;
    }
    return { activeRooms, battlingPlayers };
  }

  create(
    nickname: string,
    mode: GameMode = "race",
    fameTier: FameTier = "veteran",
    playerIdInput?: string,
    featureCodeInput?: string,
    options: CreateRoomOptions = {},
  ): { room: RoomSnapshot; session: PlayerSession } {
    let code = createRoomCode();
    while (this.rooms.has(code)) code = createRoomCode();

    const playerId = playerIdInput ?? randomUUID();
    const reconnectToken = randomUUID();
    const player: RoomPlayer = {
      id: playerId,
      nickname,
      ready: false,
      connected: true,
      rankLabel: options.hostRankLabel ?? null,
    };
    const room: MutableRoom = {
      code,
      phase: "lobby",
      hostPlayerId: playerId,
      players: new Map([[playerId, player]]),
      rules: {
        ...cloneRules(defaultRules),
        mode,
        bestOf: options.rankedMatch?.bestOf ?? 1,
        replayTiedRounds: mode === "duel",
        pool: { ...cloneRules(defaultRules).pool, fameTier },
      },
      rulesLocked: options.rulesLocked ?? false,
      rankedMatch: options.rankedMatch ? { ...options.rankedMatch } : null,
      rematchVotes: new Set(),
      round: null,
      winnerPlayerId: null,
      matchWinnerPlayerId: null,
      intermissionDeadlineAt: null,
      scores: new Map([[playerId, 0]]),
      featureCodes: new Map([[playerId, featureCodeInput?.trim() || null]]),
      catalog: [],
      roundHistory: [],
      chat: [],
      revision: 1,
    };
    this.rooms.set(code, room);
    this.reconnectTokens.set(reconnectToken, { roomCode: code, playerId });
    return { room: snapshot(room), session: { playerId, reconnectToken } };
  }

  join(
    codeInput: string,
    nickname: string,
    playerIdInput?: string,
    featureCodeInput?: string,
    rankLabelInput?: string | null,
  ): { room: RoomSnapshot; session: PlayerSession } {
    const code = codeInput.trim().toUpperCase();
    const room = this.requireRoom(code);
    if (room.phase !== "lobby") throw new Error("ROOM_ALREADY_STARTED");
    if (room.rules.mode === "solo") throw new Error("SOLO_ROOM");
    const capacity = room.rules.mode === "duel" ? 2 : 8;
    if (room.players.size >= capacity) throw new Error("ROOM_FULL");
    if (playerIdInput && room.players.has(playerIdInput))
      throw new Error("PLAYER_ALREADY_IN_ROOM");

    const playerId = playerIdInput ?? randomUUID();
    const reconnectToken = randomUUID();
    room.players.set(playerId, {
      id: playerId,
      nickname,
      ready: false,
      connected: true,
      rankLabel: rankLabelInput ?? null,
    });
    room.scores.set(playerId, 0);
    room.featureCodes.set(playerId, featureCodeInput?.trim() || null);
    room.revision += 1;
    this.reconnectTokens.set(reconnectToken, { roomCode: code, playerId });
    return { room: snapshot(room), session: { playerId, reconnectToken } };
  }

  reconnect(
    codeInput: string,
    reconnectToken: string,
  ): {
    room: RoomSnapshot;
    session: PlayerSession;
  } {
    const code = codeInput.trim().toUpperCase();
    const identity = this.reconnectTokens.get(reconnectToken);
    if (!identity || identity.roomCode !== code)
      throw new Error("INVALID_RECONNECT_TOKEN");
    const room = this.requireRoom(code);
    const player = room.players.get(identity.playerId);
    if (!player) throw new Error("PLAYER_NOT_FOUND");
    player.connected = true;
    room.revision += 1;
    return {
      room: snapshot(room),
      session: { playerId: player.id, reconnectToken },
    };
  }

  disconnect(codeInput: string, playerId: string): RoomSnapshot | null {
    const code = codeInput.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return null;
    const player = room.players.get(playerId);
    if (!player || !player.connected) return snapshot(room);
    player.connected = false;
    room.revision += 1;
    return snapshot(room);
  }

  updateRules(code: string, playerId: string, rules: GameRules): RoomSnapshot {
    const room = this.requireRoom(code);
    if (room.phase !== "lobby") throw new Error("ROOM_ALREADY_STARTED");
    if (room.hostPlayerId !== playerId) throw new Error("HOST_ONLY");
    if (room.rulesLocked) throw new Error("MATCHMAKING_RULES_LOCKED");
    if (rules.mode !== room.rules.mode) throw new Error("MODE_IMMUTABLE");
    if (rules.comparisonKeys.length < 3)
      throw new Error("TOO_FEW_COMPARISON_KEYS");
    if (new Set(rules.comparisonKeys).size !== rules.comparisonKeys.length) {
      throw new Error("DUPLICATE_COMPARISON_KEYS");
    }
    if (rules.comparisonKeys.some((key) => !comparisonKeys.includes(key))) {
      throw new Error("UNKNOWN_COMPARISON_KEY");
    }
    room.rules = cloneRules(rules);
    room.revision += 1;
    return snapshot(room);
  }

  setReady(code: string, playerId: string, ready: boolean): RoomSnapshot {
    const room = this.requireRoom(code);
    const player = room.players.get(playerId);
    if (!player) throw new Error("PLAYER_NOT_FOUND");
    player.ready = ready;
    room.revision += 1;
    if (room.phase === "round_result" && ready) {
      const connectedPlayers = [...room.players.values()].filter(
        (playerEntry) => playerEntry.connected,
      );
      if (
        connectedPlayers.length > 0 &&
        connectedPlayers.every((playerEntry) => playerEntry.ready)
      ) {
        this.startRound(room, { now: new Date() });
      }
    }
    return snapshot(room);
  }

  start(
    code: string,
    playerId: string,
    catalog: VisualNovel[],
    options: { now?: Date; random?: () => number } = {},
  ): RoomSnapshot {
    const room = this.requireRoom(code);
    if (room.phase !== "lobby") throw new Error("ROOM_ALREADY_STARTED");
    if (room.hostPlayerId !== playerId) throw new Error("HOST_ONLY");
    for (const player of [...room.players.values()]) {
      if (player.id !== playerId && !player.connected && !player.ready) {
        this.removePlayerState(room, player.id);
      }
    }
    const connectedPlayers = [...room.players.values()].filter(
      (player) => player.connected,
    );
    if (room.rules.mode === "solo" && connectedPlayers.length !== 1)
      throw new Error("INVALID_SOLO_PLAYERS");
    if (room.rules.mode === "duel" && connectedPlayers.length !== 2)
      throw new Error("NOT_ENOUGH_PLAYERS");
    if (room.rules.mode === "race" && connectedPlayers.length < 2)
      throw new Error("NOT_ENOUGH_PLAYERS");
    if (
      connectedPlayers.some((player) => player.id !== playerId && !player.ready)
    ) {
      throw new Error("PLAYERS_NOT_READY");
    }

    room.catalog = catalog;
    this.startRound(room, options);
    return snapshot(room);
  }

  private startRound(
    room: MutableRoom,
    options: { now?: Date; random?: () => number } = {},
  ): void {
    const baseGame = createGameSession(room.catalog, room.rules, options);
    const playerGames = new Map<string, GameSession>();
    for (const [playerId, player] of room.players) {
      if (!player.connected) continue;
      playerGames.set(playerId, {
        ...structuredClone(baseGame),
        id: `${baseGame.id}:${playerId}`,
        guesses: [],
      });
      player.ready = false;
    }
    const sequenceNumber = room.roundHistory.length + 1;
    const decidedRounds = [...room.scores.values()].reduce(
      (total, wins) => total + wins,
      0,
    );
    room.round = {
      roundNumber: room.rules.replayTiedRounds
        ? decidedRounds + 1
        : sequenceNumber,
      sequenceNumber,
      answer: structuredClone(baseGame.answer),
      playerGames,
    };
    room.roundHistory.push({
      roundNumber: sequenceNumber,
      answer: structuredClone(room.round.answer),
      startedAt: baseGame.startedAt,
      finishedAt: null,
      winnerPlayerId: null,
    });
    room.phase = "active";
    room.winnerPlayerId = null;
    room.intermissionDeadlineAt = null;
    room.revision += 1;
  }

  /** 进入 60 秒中场休息：揭示答案供交流，全员准备可提前开局。 */
  private enterIntermission(room: MutableRoom, now: Date): void {
    room.phase = "round_result";
    room.intermissionDeadlineAt = new Date(
      now.getTime() + 60_000,
    ).toISOString();
    for (const player of room.players.values()) player.ready = false;
  }

  /** 中场倒计时结束：无论准备与否都开下一轮。 */
  advanceIntermission(
    codeInput: string,
    now = new Date(),
  ): RoomSnapshot | null {
    const room = this.rooms.get(codeInput.trim().toUpperCase());
    if (room?.phase !== "round_result") return null;
    this.startRound(room, { now });
    return snapshot(room);
  }

  private settleRound(
    room: MutableRoom,
    now: Date,
    options: { forfeit?: boolean } = {},
  ): void {
    const winnerId = room.winnerPlayerId;
    const currentRecord = room.roundHistory[room.roundHistory.length - 1];
    if (currentRecord) {
      currentRecord.finishedAt = now.toISOString();
      currentRecord.winnerPlayerId = winnerId;
    }
    if (winnerId) {
      room.scores.set(winnerId, (room.scores.get(winnerId) ?? 0) + 1);
    }
    const competitive = room.rules.mode !== "solo";
    const target = Math.ceil(room.rules.bestOf / 2);
    const matchWinner =
      competitive &&
      winnerId !== null &&
      (room.scores.get(winnerId) ?? 0) >= target
        ? winnerId
        : null;
    if (!competitive || options.forfeit || matchWinner) {
      room.phase = "finished";
      room.matchWinnerPlayerId = options.forfeit ? winnerId : matchWinner;
      room.intermissionDeadlineAt = null;
      return;
    }
    if (
      !room.rules.replayTiedRounds &&
      room.roundHistory.length >= room.rules.bestOf
    ) {
      const sortedScores = [...room.scores].sort(
        (left, right) => right[1] - left[1],
      );
      room.phase = "finished";
      room.matchWinnerPlayerId =
        sortedScores.length > 0 &&
        sortedScores[0]![1] > (sortedScores[1]?.[1] ?? -1)
          ? sortedScores[0]![0]
          : null;
      room.intermissionDeadlineAt = null;
      return;
    }
    this.enterIntermission(room, now);
  }

  rematch(code: string, playerId: string): RoomSnapshot {
    const room = this.requireRoom(code);
    if (room.phase !== "finished") throw new Error("ROOM_NOT_FINISHED");
    if (!room.players.has(playerId)) throw new Error("PLAYER_NOT_FOUND");
    if (room.rankedMatch) {
      room.rematchVotes.add(playerId);
      const connectedPlayerIds = [...room.players.values()]
        .filter((player) => player.connected)
        .map((player) => player.id);
      if (
        connectedPlayerIds.length < 2 ||
        !connectedPlayerIds.every((id) => room.rematchVotes.has(id))
      ) {
        room.revision += 1;
        return snapshot(room);
      }
    } else if (room.hostPlayerId !== playerId) {
      throw new Error("HOST_ONLY");
    }
    this.resetForRematch(room);
    return snapshot(room);
  }

  updateRankLabels(
    code: string,
    labels: ReadonlyMap<string, string>,
  ): RoomSnapshot {
    const room = this.requireRoom(code);
    let changed = false;
    for (const [playerId, rankLabel] of labels) {
      const player = room.players.get(playerId);
      if (player && player.rankLabel !== rankLabel) {
        player.rankLabel = rankLabel;
        changed = true;
      }
    }
    if (changed) room.revision += 1;
    return snapshot(room);
  }

  private resetForRematch(room: MutableRoom): void {
    room.phase = "lobby";
    room.round = null;
    room.roundHistory = [];
    room.winnerPlayerId = null;
    room.matchWinnerPlayerId = null;
    room.intermissionDeadlineAt = null;
    room.rematchVotes.clear();
    for (const player of room.players.values()) player.ready = false;
    for (const playerIdKey of room.scores.keys()) {
      room.scores.set(playerIdKey, 0);
    }
    room.revision += 1;
  }

  submitPlayerGuess(
    code: string,
    playerId: string,
    guessedVisualNovelId: string,
    catalog: VisualNovel[],
    now = new Date(),
  ): { room: RoomSnapshot; game: PublicGameSession } {
    const room = this.requireRoom(code);
    if (room.phase !== "active" || !room.round)
      throw new Error("ROOM_NOT_ACTIVE");
    const game = room.round.playerGames.get(playerId);
    if (!game) throw new Error("PLAYER_NOT_IN_ROUND");
    const guessedVisualNovel = catalog.find(
      (visualNovel) => visualNovel.id === guessedVisualNovelId,
    );
    if (!guessedVisualNovel) throw new Error("GUESS_NOT_IN_CATALOG");

    const outcome = submitGuess(game, guessedVisualNovel, now);
    room.round.playerGames.set(playerId, outcome.game);
    if (!outcome.ok && outcome.error !== "GAME_EXPIRED")
      throw new Error(outcome.error);

    if (outcome.game.status === "won") {
      room.winnerPlayerId = playerId;
      for (const [otherPlayerId, otherGame] of room.round.playerGames) {
        if (otherPlayerId !== playerId && otherGame.status === "active") {
          room.round.playerGames.set(otherPlayerId, {
            ...otherGame,
            status: "lost",
            finishedAt: now.toISOString(),
          });
        }
      }
      this.settleRound(room, now);
    } else if (
      [...room.round.playerGames.values()].every(
        (playerGame) => playerGame.status !== "active",
      )
    ) {
      this.settleRound(room, now);
    }
    room.revision += 1;
    return {
      room: snapshot(room),
      game: publicGameSession(room.round.playerGames.get(playerId)!, {
        hideAnswer: room.phase === "active" && outcome.game.status === "lost",
      }),
    };
  }

  getPlayerGame(code: string, playerId: string): PublicGameSession {
    const room = this.requireRoom(code);
    const game = room.round?.playerGames.get(playerId);
    if (!game) throw new Error("PLAYER_NOT_IN_ROUND");
    return publicGameSession(game, {
      hideAnswer: room.phase === "active" && game.status === "lost",
    });
  }

  get(code: string): RoomSnapshot {
    return snapshot(this.requireRoom(code.trim().toUpperCase()));
  }

  getMatchReport(codeInput: string): MatchReport | null {
    const room = this.rooms.get(codeInput.trim().toUpperCase());
    if (!room || room.phase !== "finished" || room.roundHistory.length === 0)
      return null;
    const lastRound = room.roundHistory[room.roundHistory.length - 1];
    const firstRound = room.roundHistory[0];
    return {
      roomCode: room.code,
      mode: room.rules.mode,
      rules: cloneRules(room.rules),
      status: "finished",
      startedAt: firstRound?.startedAt ?? "",
      finishedAt: lastRound?.finishedAt ?? new Date().toISOString(),
      winnerPlayerId: room.matchWinnerPlayerId,
      rankedMatch: room.rankedMatch ? { ...room.rankedMatch } : null,
      players: [...room.players].map(([playerId, player]) => ({
        playerId,
        nickname: player.nickname,
        wins: room.scores.get(playerId) ?? 0,
        featureCode: room.featureCodes.get(playerId) ?? null,
      })),
      rounds: room.roundHistory.map((record) => ({
        roundNumber: record.roundNumber,
        answerId: record.answer.id,
        answerSnapshot: {
          id: record.answer.id,
          title: record.answer.title,
        },
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        winnerPlayerId: record.winnerPlayerId,
      })),
    };
  }

  postChat(
    codeInput: string,
    playerId: string,
    textInput: string,
    now = new Date(),
    audioId: string | null = null,
  ): ChatMessage {
    const code = codeInput.trim().toUpperCase();
    const room = this.requireRoom(code);
    const player = room.players.get(playerId);
    if (!player) throw new Error("PLAYER_NOT_FOUND");
    const text = textInput.trim();
    if (text.length === 0 && !audioId) throw new Error("CHAT_EMPTY");
    if (text.length > 200) throw new Error("CHAT_TOO_LONG");
    const last = [...room.chat]
      .reverse()
      .find((message) => message.playerId === playerId);
    if (last && now.getTime() - Date.parse(last.at) < 400)
      throw new Error("CHAT_TOO_FAST");
    const message: ChatMessage = {
      playerId,
      nickname: player.nickname,
      text,
      audioId,
      at: now.toISOString(),
    };
    room.chat.push(message);
    if (room.chat.length > 100) room.chat.splice(0, room.chat.length - 100);
    return message;
  }

  chatHistory(codeInput: string): ChatMessage[] {
    return this.requireRoom(codeInput.trim().toUpperCase()).chat.map(
      (message) => ({ ...message }),
    );
  }
  expire(codeInput: string, now = new Date()): RoomSnapshot | null {
    const room = this.rooms.get(codeInput.trim().toUpperCase());
    if (room?.phase !== "active" || !room.round) return null;
    const games = [...room.round.playerGames.values()];
    const deadlineAt = games[0]?.deadlineAt;
    if (!deadlineAt || now.getTime() < Date.parse(deadlineAt)) return null;
    for (const [playerId, game] of room.round.playerGames) {
      if (game.status !== "active") continue;
      room.round.playerGames.set(playerId, {
        ...game,
        status: "expired",
        finishedAt: now.toISOString(),
      });
    }
    room.winnerPlayerId = null;
    this.settleRound(room, now);
    room.revision += 1;
    return snapshot(room);
  }

  leave(
    codeInput: string,
    playerId: string,
    now = new Date(),
  ): RoomSnapshot | null {
    const code = codeInput.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return null;
    if (!room.players.has(playerId)) return snapshot(room);

    this.removePlayerState(room, playerId);
    if (room.players.size === 0) {
      this.rooms.delete(code);
      return null;
    }
    if (room.hostPlayerId === playerId) {
      room.hostPlayerId = room.players.keys().next().value as string;
    }
    if (
      (room.phase === "active" || room.phase === "round_result") &&
      room.round &&
      room.rules.mode !== "solo" &&
      room.round.playerGames.size === 1
    ) {
      const [winnerId, winnerGame] = room.round.playerGames.entries().next()
        .value as [string, GameSession];
      room.round.playerGames.set(winnerId, {
        ...winnerGame,
        status: "won",
        finishedAt: now.toISOString(),
      });
      room.winnerPlayerId = winnerId;
      this.settleRound(room, now, { forfeit: true });
    }
    room.revision += 1;
    return snapshot(room);
  }

  private requireRoom(code: string): MutableRoom {
    const room = this.rooms.get(code);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    return room;
  }

  private removePlayerState(room: MutableRoom, playerId: string): void {
    room.players.delete(playerId);
    room.scores.delete(playerId);
    room.featureCodes.delete(playerId);
    room.rematchVotes.delete(playerId);
    room.round?.playerGames.delete(playerId);
    for (const [token, identity] of this.reconnectTokens) {
      if (identity.roomCode === room.code && identity.playerId === playerId) {
        this.reconnectTokens.delete(token);
      }
    }
  }
}
