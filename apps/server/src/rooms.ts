import { randomInt, randomUUID } from "node:crypto";
import {
  comparisonKeys,
  createGameSession,
  defaultComparisonKeys,
  publicGameSession,
  submitGuess,
  type GameRules,
  type FameTier,
  type GameMode,
  type GameSession,
  type PublicGameSession,
  type VisualNovel,
} from "@gal-yiba/shared";

const roomAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface RoomPlayer {
  id: string;
  nickname: string;
  ready: boolean;
  connected: boolean;
}

export interface RoomSnapshot {
  code: string;
  phase: "lobby" | "countdown" | "active" | "round_result" | "finished";
  hostPlayerId: string;
  players: RoomPlayer[];
  rules: GameRules;
  round: RoomRoundSnapshot | null;
  winnerPlayerId: string | null;
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
    finishedAt: string | null;
  }>;
}

interface MutableRound {
  roundNumber: number;
  answer: VisualNovel;
  playerGames: Map<string, GameSession>;
}

interface MutableRoom extends Omit<RoomSnapshot, "players" | "round"> {
  players: Map<string, RoomPlayer>;
  round: MutableRound | null;
}

export interface PlayerSession {
  playerId: string;
  reconnectToken: string;
}

export const defaultRules: GameRules = {
  version: 1,
  mode: "race",
  maxGuesses: 8,
  roundTimeSeconds: 300,
  bestOf: 1,
  comparisonKeys: [...defaultComparisonKeys],
  pool: {
    includeTags: [],
    excludeTags: [],
    tagMode: "all",
    allAgesOnly: false,
    maxTagSpoilerLevel: 0,
    fameTier: "standard",
  },
};

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
            finishedAt: game.finishedAt,
          })),
        }
      : null,
    winnerPlayerId: room.winnerPlayerId,
    revision: room.revision,
  };
}

export class RoomRegistry {
  private readonly rooms = new Map<string, MutableRoom>();
  private readonly reconnectTokens = new Map<
    string,
    { roomCode: string; playerId: string }
  >();

  create(
    nickname: string,
    mode: GameMode = "race",
    fameTier: FameTier = "standard",
  ): { room: RoomSnapshot; session: PlayerSession } {
    let code = createRoomCode();
    while (this.rooms.has(code)) code = createRoomCode();

    const playerId = randomUUID();
    const reconnectToken = randomUUID();
    const player: RoomPlayer = {
      id: playerId,
      nickname,
      ready: false,
      connected: true,
    };
    const room: MutableRoom = {
      code,
      phase: "lobby",
      hostPlayerId: playerId,
      players: new Map([[playerId, player]]),
      rules: {
        ...cloneRules(defaultRules),
        mode,
        pool: { ...cloneRules(defaultRules).pool, fameTier },
      },
      round: null,
      winnerPlayerId: null,
      revision: 1,
    };
    this.rooms.set(code, room);
    this.reconnectTokens.set(reconnectToken, { roomCode: code, playerId });
    return { room: snapshot(room), session: { playerId, reconnectToken } };
  }

  join(
    codeInput: string,
    nickname: string,
  ): { room: RoomSnapshot; session: PlayerSession } {
    const code = codeInput.trim().toUpperCase();
    const room = this.requireRoom(code);
    if (room.phase !== "lobby") throw new Error("ROOM_ALREADY_STARTED");
    if (room.rules.mode === "solo") throw new Error("SOLO_ROOM");
    const capacity = room.rules.mode === "duel" ? 2 : 8;
    if (room.players.size >= capacity) throw new Error("ROOM_FULL");

    const playerId = randomUUID();
    const reconnectToken = randomUUID();
    room.players.set(playerId, {
      id: playerId,
      nickname,
      ready: false,
      connected: true,
    });
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

    const baseGame = createGameSession(catalog, room.rules, options);
    const playerGames = new Map<string, GameSession>();
    for (const player of connectedPlayers) {
      playerGames.set(player.id, {
        ...structuredClone(baseGame),
        id: `${baseGame.id}:${player.id}`,
        guesses: [],
      });
      player.ready = false;
    }
    room.round = {
      roundNumber: 1,
      answer: structuredClone(baseGame.answer),
      playerGames,
    };
    room.phase = "active";
    room.winnerPlayerId = null;
    room.revision += 1;
    return snapshot(room);
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
      room.phase = "finished";
    } else if (
      [...room.round.playerGames.values()].every(
        (playerGame) => playerGame.status !== "active",
      )
    ) {
      room.phase = "finished";
    }
    room.revision += 1;
    return {
      room: snapshot(room),
      game: publicGameSession(room.round.playerGames.get(playerId)!),
    };
  }

  getPlayerGame(code: string, playerId: string): PublicGameSession {
    const room = this.requireRoom(code);
    const game = room.round?.playerGames.get(playerId);
    if (!game) throw new Error("PLAYER_NOT_IN_ROUND");
    return publicGameSession(game);
  }

  get(code: string): RoomSnapshot {
    return snapshot(this.requireRoom(code.trim().toUpperCase()));
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
    room.phase = "finished";
    room.winnerPlayerId = null;
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

    room.players.delete(playerId);
    room.round?.playerGames.delete(playerId);
    for (const [token, identity] of this.reconnectTokens) {
      if (identity.roomCode === code && identity.playerId === playerId) {
        this.reconnectTokens.delete(token);
      }
    }
    if (room.players.size === 0) {
      this.rooms.delete(code);
      return null;
    }
    if (room.hostPlayerId === playerId) {
      room.hostPlayerId = room.players.keys().next().value as string;
    }
    if (
      room.phase === "active" &&
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
      room.phase = "finished";
    }
    room.revision += 1;
    return snapshot(room);
  }

  private requireRoom(code: string): MutableRoom {
    const room = this.rooms.get(code);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    return room;
  }
}
