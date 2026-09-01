import {
  createDailyGameSession,
  createGameSession,
  dailyDateString,
  defaultGameRules,
  demoCatalog,
  fameTierPoolIncludes,
  fameTierPoolSizes,
  publicGameSession,
  selectImportantTags,
  submitGuess,
  type FameTier,
  type GameMode,
  type GameRules,
  type GameSession,
  type PublicGameSession,
  type VisualNovel,
} from "@gal-yiba/shared";

export type Ack = (response: any) => void;
type Handler = (...args: unknown[]) => void;

export interface SearchItem {
  id: string;
  title: string;
  displayTitle: string;
  aliases: string[];
  developers: string[];
  match: { type: "title" | "developer"; value: string };
}

interface Session {
  playerId: string;
  reconnectToken: string;
}

interface RoomPlayer {
  id: string;
  nickname: string;
  ready: boolean;
  connected: boolean;
  rankLabel: string | null;
}

interface RoomSnapshot {
  code: string;
  phase: "lobby" | "active" | "round_result" | "finished";
  hostPlayerId: string;
  players: RoomPlayer[];
  rules: GameRules;
  rulesLocked: boolean;
  rankedMatch: null;
  rematchVotes: string[];
  round: {
    roundNumber: number;
    startedAt: string;
    deadlineAt: string;
    answer: { id: string; title: string } | null;
    players: Array<{
      playerId: string;
      status: string;
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
    }>;
  } | null;
  winnerPlayerId: string | null;
  matchWinnerPlayerId: string | null;
  scores: Array<{ playerId: string; wins: number }>;
  intermissionDeadlineAt: string | null;
  revision: number;
}

interface ChatMessage {
  playerId: string;
  nickname: string;
  text: string;
  at: string;
  audioId: string | null;
}

interface MutableRoom {
  snapshot: RoomSnapshot;
  session: Session;
  nickname: string;
  privateGame: GameSession | null;
}

const DAILY_STORAGE_KEY = "gal-yiba-static-daily";
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function cloneRules(rules: GameRules): GameRules {
  return structuredClone(rules);
}

function createId(): string {
  return crypto.randomUUID();
}

function createRoomCode(): string {
  return Array.from(
    { length: 5 },
    () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)],
  ).join("");
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s'’\-_.＊*]/g, "");
}

export function searchDemoCatalog(
  catalog: VisualNovel[],
  queryInput: string,
  limit = 20,
): SearchItem[] {
  const query = normalizeSearchText(queryInput);
  if (!query) return [];
  const ranked: Array<{ score: number; item: SearchItem }> = [];
  for (const visualNovel of catalog) {
    const titles = [visualNovel.title, ...(visualNovel.aliases ?? [])];
    const developers = visualNovel.developer ?? [];
    let titleScore = 0;
    let titleValue = visualNovel.title;
    for (const title of titles) {
      const normalized = normalizeSearchText(title);
      const score = textScore(query, normalized);
      if (score > titleScore) {
        titleScore = score;
        titleValue = title;
      }
    }
    let developerScore = 0;
    let developerValue = "";
    for (const developer of developers) {
      const score = textScore(query, normalizeSearchText(developer));
      if (score > developerScore) {
        developerScore = score;
        developerValue = developer;
      }
    }
    const useDeveloper = developerScore > 0 && developerScore > titleScore;
    const score = useDeveloper ? developerScore : titleScore;
    if (score <= 0) continue;
    ranked.push({
      score,
      item: {
        id: visualNovel.id,
        title: visualNovel.title,
        displayTitle: visualNovel.aliases?.[0] ?? visualNovel.title,
        aliases: visualNovel.aliases ?? [],
        developers,
        match: {
          type: useDeveloper ? "developer" : "title",
          value: useDeveloper ? developerValue : titleValue,
        },
      },
    });
  }
  return ranked
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function textScore(query: string, candidate: string): number {
  if (!candidate) return 0;
  if (candidate === query) return 1000;
  if (candidate.startsWith(query)) return 900;
  if (candidate.includes(query)) return 800;
  return 0;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function snapshotRound(
  game: GameSession | null,
  phase: RoomSnapshot["phase"],
): RoomSnapshot["round"] {
  if (!game) return null;
  const reveal = phase === "round_result" || phase === "finished";
  return {
    roundNumber: 1,
    startedAt: game.startedAt,
    deadlineAt: game.deadlineAt,
    answer: reveal ? { id: game.answer.id, title: game.answer.title } : null,
    players: [
      {
        playerId: "self",
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
      },
    ],
  };
}

function publicRoom(room: MutableRoom): RoomSnapshot {
  const playerId = room.session.playerId;
  const round = snapshotRound(room.privateGame, room.snapshot.phase);
  if (round) {
    round.players = round.players.map((player) => ({
      ...player,
      playerId,
    }));
  }
  return {
    ...room.snapshot,
    round,
    players: room.snapshot.players.map((player) => ({ ...player })),
    rules: cloneRules(room.snapshot.rules),
    scores: room.snapshot.scores.map((score) => ({ ...score })),
  };
}

interface StoredDaily {
  date: string;
  playerToken: string;
  session: GameSession;
}

export class StaticPlayRuntime {
  readonly catalog = demoCatalog;
  private readonly listeners = new Map<string, Set<Handler>>();
  private room: MutableRoom | null = null;
  private readonly audioUrls = new Map<string, string>();
  private daily: StoredDaily | null = null;

  constructor(private readonly storage: Storage | null = defaultStorage()) {
    this.daily = this.readDaily();
  }

  on(event: string, handler: Handler): void {
    const set = this.listeners.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.listeners.set(event, set);
  }

  off(event: string, handler: Handler): void {
    this.listeners.get(event)?.delete(handler);
  }

  audioSrc(audioId: string): string {
    return this.audioUrls.get(audioId) ?? "";
  }

  handleFetch(path: string, init?: RequestInit): Promise<Response> {
    return Promise.resolve(this.routeFetch(path, init));
  }

  handleEmit(event: string, payload: unknown, ack?: Ack): void {
    try {
      const result = this.routeEmit(event, payload);
      ack?.(result);
    } catch (error) {
      ack?.({
        ok: false,
        error: error instanceof Error ? error.message : "INVALID_REQUEST",
      });
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const handler of this.listeners.get(event) ?? []) handler(...args);
  }

  private routeFetch(path: string, init?: RequestInit): Response {
    const url = new URL(path, "https://static.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const route = url.pathname;

    if (route === "/api/catalog/fame-tiers" && method === "GET") {
      const counts = {} as Record<FameTier, number>;
      for (const tier of Object.keys(fameTierPoolSizes) as FameTier[]) {
        counts[tier] = Math.min(fameTierPoolSizes[tier], this.catalog.length);
      }
      return jsonResponse({ counts, sizes: fameTierPoolSizes });
    }

    if (route === "/api/catalog/search" && method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      return jsonResponse({ items: searchDemoCatalog(this.catalog, query) });
    }

    if (route === "/api/catalog/tags" && method === "GET") {
      return jsonResponse({ items: this.listTags(url.searchParams) });
    }

    if (route === "/api/daily" && method === "GET") {
      return this.getDaily();
    }

    if (route === "/api/daily/guess" && method === "POST") {
      return this.postDailyGuess(init);
    }

    if (route === "/api/stats/realtime" && method === "GET") {
      return jsonResponse({
        onlinePlayers: 1,
        battlingPlayers: this.room?.snapshot.phase === "active" ? 1 : 0,
        activeRooms: this.room?.snapshot.phase === "active" ? 1 : 0,
        updatedAt: new Date().toISOString(),
      });
    }

    if (route === "/api/matchmaking/stats" && method === "GET") {
      return jsonResponse({
        total: 0,
        byFameTier: { novice: 0, standard: 0, veteran: 0 },
        byQueue: {},
        updatedAt: new Date().toISOString(),
      });
    }

    if (route === "/api/ranked/profile" && method === "GET") {
      return jsonResponse({ error: "STATIC_PLAY" }, 404);
    }

    if (route === "/api/leaderboard" || route === "/api/leaderboard/ranked") {
      return jsonResponse({ items: [] });
    }

    if (route.startsWith("/api/admin")) {
      return jsonResponse({ error: "STATIC_PLAY" }, 403);
    }

    return jsonResponse({ error: "NOT_FOUND" }, 404);
  }

  private routeEmit(event: string, payload: unknown): unknown {
    switch (event) {
      case "room:create":
        return this.createRoom(payload);
      case "room:join":
        return { ok: false, error: "静态演示无法加入他人房间" };
      case "room:reconnect":
        return this.reconnect();
      case "room:leave":
        return this.leaveRoom();
      case "room:set-rules":
        return this.setRules(payload);
      case "room:set-ready":
        return this.setReady(payload);
      case "room:start":
        return this.startRoom();
      case "game:guess":
        return this.guess(payload);
      case "room:rematch":
        return this.rematch();
      case "room:chat":
        return this.chat(payload);
      case "room:chat-history":
        return { ok: true, messages: [] };
      case "room:chat-audio":
        return this.chatAudio(payload);
      case "matchmaking:join":
        return { ok: false, error: "静态演示没有联机匹配" };
      case "matchmaking:cancel":
        return { ok: true };
      default:
        return { ok: false, error: "UNSUPPORTED_EVENT" };
    }
  }

  private createRoom(payload: unknown): unknown {
    const input = payload as {
      nickname?: string;
      mode?: GameMode;
      fameTier?: FameTier;
      playerId?: string;
    };
    const nickname = String(input.nickname ?? "").trim();
    if (!nickname) return { ok: false, error: "NICKNAME_REQUIRED" };
    const mode = input.mode ?? "solo";
    const fameTier = input.fameTier ?? "veteran";
    const playerId = input.playerId || createId();
    const reconnectToken = createId();
    const rules: GameRules = {
      ...cloneRules(defaultGameRules),
      mode,
      replayTiedRounds: mode === "duel",
      pool: { ...cloneRules(defaultGameRules).pool, fameTier },
    };
    const snapshot: RoomSnapshot = {
      code: createRoomCode(),
      phase: "lobby",
      hostPlayerId: playerId,
      players: [
        {
          id: playerId,
          nickname,
          ready: mode === "solo",
          connected: true,
          rankLabel: null,
        },
      ],
      rules,
      rulesLocked: false,
      rankedMatch: null,
      rematchVotes: [],
      round: null,
      winnerPlayerId: null,
      matchWinnerPlayerId: null,
      scores: [{ playerId, wins: 0 }],
      intermissionDeadlineAt: null,
      revision: 1,
    };
    this.room = {
      snapshot,
      session: { playerId, reconnectToken },
      nickname,
      privateGame: null,
    };
    return {
      ok: true,
      room: publicRoom(this.room),
      session: this.room.session,
    };
  }

  private reconnect(): unknown {
    if (!this.room) return { ok: false, error: "ROOM_NOT_FOUND" };
    return {
      ok: true,
      room: publicRoom(this.room),
      session: this.room.session,
      game: this.room.privateGame
        ? publicGameSession(this.room.privateGame)
        : undefined,
    };
  }

  private leaveRoom(): unknown {
    this.room = null;
    return { ok: true };
  }

  private setRules(payload: unknown): unknown {
    const room = this.requireRoom();
    const rules = (payload as { rules?: GameRules }).rules;
    if (!rules) return { ok: false, error: "RULES_REQUIRED" };
    if ((rules.comparisonKeys?.length ?? 0) < 3) {
      return { ok: false, error: "至少保留 3 个比较项" };
    }
    room.snapshot.rules = cloneRules(rules);
    room.snapshot.revision += 1;
    this.emit("room:updated", publicRoom(room));
    return { ok: true };
  }

  private setReady(payload: unknown): unknown {
    const room = this.requireRoom();
    const ready = Boolean((payload as { ready?: boolean }).ready);
    room.snapshot.players = room.snapshot.players.map((player) =>
      player.id === room.session.playerId ? { ...player, ready } : player,
    );
    room.snapshot.revision += 1;
    this.emit("room:updated", publicRoom(room));
    return { ok: true };
  }

  private startRoom(): unknown {
    const room = this.requireRoom();
    const game = createGameSession(this.catalog, room.snapshot.rules);
    room.privateGame = game;
    room.snapshot.phase = "active";
    room.snapshot.winnerPlayerId = null;
    room.snapshot.matchWinnerPlayerId = null;
    room.snapshot.revision += 1;
    const publicGame = publicGameSession(game);
    this.emit("room:updated", publicRoom(room));
    this.emit("game:state", publicGame);
    return { ok: true, room: publicRoom(room), game: publicGame };
  }

  private guess(payload: unknown): unknown {
    const room = this.requireRoom();
    if (!room.privateGame) return { ok: false, error: "ROOM_NOT_STARTED" };
    const visualNovelId = String(
      (payload as { visualNovelId?: unknown }).visualNovelId ?? "",
    );
    const guessed = this.catalog.find((item) => item.id === visualNovelId);
    if (!guessed) return { ok: false, error: "GUESS_NOT_IN_CATALOG" };
    const outcome = submitGuess(room.privateGame, guessed);
    room.privateGame = outcome.game;
    if (!outcome.ok && outcome.error !== "GAME_EXPIRED") {
      return { ok: false, error: outcome.error };
    }
    if (outcome.game.status !== "active") {
      room.snapshot.phase = "finished";
      room.snapshot.winnerPlayerId =
        outcome.game.status === "won" ? room.session.playerId : null;
      room.snapshot.matchWinnerPlayerId = room.snapshot.winnerPlayerId;
      if (outcome.game.status === "won") {
        room.snapshot.scores = [
          { playerId: room.session.playerId, wins: 1 },
        ];
      }
    }
    room.snapshot.revision += 1;
    const publicGame = publicGameSession(outcome.game);
    this.emit("room:updated", publicRoom(room));
    this.emit("game:state", publicGame);
    return { ok: true, room: publicRoom(room), game: publicGame };
  }

  private rematch(): unknown {
    const room = this.requireRoom();
    room.privateGame = null;
    room.snapshot.phase = "lobby";
    room.snapshot.round = null;
    room.snapshot.winnerPlayerId = null;
    room.snapshot.matchWinnerPlayerId = null;
    room.snapshot.scores = [{ playerId: room.session.playerId, wins: 0 }];
    room.snapshot.players = room.snapshot.players.map((player) => ({
      ...player,
      ready: room.snapshot.rules.mode === "solo",
    }));
    room.snapshot.revision += 1;
    this.emit("room:updated", publicRoom(room));
    return { ok: true, room: publicRoom(room) };
  }

  private chat(payload: unknown): unknown {
    const room = this.requireRoom();
    const text = String((payload as { text?: unknown }).text ?? "").trim();
    if (!text) return { ok: false, error: "CHAT_EMPTY" };
    const message: ChatMessage = {
      playerId: room.session.playerId,
      nickname: room.nickname,
      text: text.slice(0, 200),
      audioId: null,
      at: new Date().toISOString(),
    };
    this.emit("room:chat", message);
    return { ok: true, message };
  }

  private chatAudio(payload: unknown): unknown {
    const room = this.requireRoom();
    const blob = (payload as { audio?: Blob }).audio;
    if (!blob) return { ok: false, error: "AUDIO_REQUIRED" };
    const audioId = createId();
    this.audioUrls.set(audioId, URL.createObjectURL(blob));
    const message: ChatMessage = {
      playerId: room.session.playerId,
      nickname: room.nickname,
      text: "",
      audioId,
      at: new Date().toISOString(),
    };
    this.emit("room:chat", message);
    return { ok: true, message };
  }

  private getDaily(): Response {
    const date = dailyDateString();
    const rules: GameRules = { ...cloneRules(defaultGameRules), mode: "solo" };
    let stored = this.daily;
    if (!stored || stored.date !== date) {
      stored = {
        date,
        playerToken: stored?.playerToken || createId(),
        session: createDailyGameSession(this.catalog, rules, date),
      };
      this.daily = stored;
      this.writeDaily(stored);
    }
    return jsonResponse(
      {
        date: stored.date,
        rules: stored.session.rules,
        session: publicGameSession(stored.session),
      },
      200,
      { "X-Daily-Player": stored.playerToken },
    );
  }

  private postDailyGuess(init?: RequestInit): Response {
    const stored = this.daily;
    if (!stored) return jsonResponse({ error: "DAILY_SESSION_NOT_FOUND" }, 400);
    const raw = init?.body;
    const parsed =
      typeof raw === "string" ? (JSON.parse(raw) as { visualNovelId?: string }) : {};
    const guessed = this.catalog.find((item) => item.id === parsed.visualNovelId);
    if (!guessed) return jsonResponse({ error: "GUESS_NOT_IN_CATALOG" }, 400);
    const outcome = submitGuess(stored.session, guessed);
    stored.session = outcome.game;
    this.writeDaily(stored);
    if (!outcome.ok && outcome.error !== "GAME_EXPIRED") {
      return jsonResponse(
        { error: outcome.error, session: publicGameSession(outcome.game) },
        400,
      );
    }
    return jsonResponse({ session: publicGameSession(outcome.game) });
  }

  private listTags(
    params: URLSearchParams,
  ): Array<{ name: string; count: number }> {
    const allAgesOnly = params.get("allAgesOnly") === "true";
    const includeOtome = params.get("includeOtome") === "true";
    const fameTier = (params.get("fameTier") ?? "veteran") as FameTier;
    const spoiler = Number(params.get("maxSpoilerLevel") ?? 0);
    const maxSpoilerLevel = ([0, 1, 2].includes(spoiler) ? spoiler : 0) as
      | 0
      | 1
      | 2;
    const counts = new Map<string, number>();
    for (const visualNovel of this.catalog) {
      if (!fameTierPoolIncludes(this.catalog, visualNovel, fameTier)) continue;
      if (allAgesOnly && visualNovel.ageRating !== "all_ages") continue;
      if (!includeOtome && visualNovel.isOtome) continue;
      const tags = selectImportantTags(
        visualNovel.tagDetails,
        visualNovel.tags,
        maxSpoilerLevel,
      ).map((tag) => tag.name);
      for (const tag of new Set(tags)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 60)
      .map(([name, count]) => ({ name, count }));
  }

  private requireRoom(): MutableRoom {
    if (!this.room) throw new Error("NOT_IN_ROOM");
    return this.room;
  }

  private readDaily(): StoredDaily | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(DAILY_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as StoredDaily;
    } catch {
      return null;
    }
  }

  private writeDaily(value: StoredDaily): void {
    this.storage?.setItem(DAILY_STORAGE_KEY, JSON.stringify(value));
  }
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function publicSession(session: GameSession): PublicGameSession {
  return publicGameSession(session);
}
