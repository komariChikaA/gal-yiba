import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { normalizeTitle } from "@gal-yiba/data";
import {
  comparisonKeys,
  fameTierPoolIncludes,
  fameTierPoolSizes,
  publicGameSession,
  selectImportantTags,
  type FameTier,
  type GameMode,
  type GameRules,
  type VisualNovel,
} from "@gal-yiba/shared";
import {
  CatalogRepository,
  createDatabasePool,
  migrateDatabase,
} from "./db/index.js";
import { RoomRegistry, defaultRules } from "./rooms.js";
import { DailyRegistry } from "./services/daily.js";
import { MatchRecorder } from "./services/match-recorder.js";
import { searchCatalog } from "./services/catalog-search.js";
import { CatalogSyncService } from "./services/catalog-sync.js";
import { demoCatalog } from "./demo-catalog.js";
const port = Number(process.env.PORT ?? 3000);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: webOrigin, credentials: true },
});
const rooms = new RoomRegistry();
const dailyGames = new DailyRegistry();
const databasePool = process.env.DATABASE_URL ? createDatabasePool() : null;
if (databasePool) await migrateDatabase(databasePool);
const catalogRepository = databasePool
  ? new CatalogRepository(databasePool)
  : null;
const matchRecorder = new MatchRecorder(databasePool);
/** 聊天语音消息：内存暂存 30 分钟，供回放/重连拉取。 */
const chatAudios = new Map<string, { buffer: Buffer; mimeType: string }>();

let catalogCache: VisualNovel[] | null = null;
let catalogCacheAt = 0;

async function loadCatalog() {
  if (!catalogRepository) return demoCatalog;
  const now = Date.now();
  if (catalogCache && now - catalogCacheAt < 300_000) return catalogCache;
  const catalog = await catalogRepository.listVisualNovels();
  catalogCache = catalog;
  catalogCacheAt = now;
  return catalog;
}
const nicknameSchema = z.string().trim().min(1).max(20);
const playerIdSchema = z.string().uuid().optional();
const featureCodeSchema = z.string().trim().max(20).optional();
const joinSchema = z.object({
  code: z.string().trim().length(5),
  nickname: nicknameSchema,
  playerId: playerIdSchema,
  featureCode: featureCodeSchema,
});
const createRoomSchema = z.object({
  nickname: nicknameSchema,
  mode: z.enum(["solo", "duel", "race"]),
  fameTier: z.enum(["novice", "standard", "veteran", "experienced", "master"]),
  playerId: playerIdSchema,
  featureCode: featureCodeSchema,
});
const reconnectSchema = z.object({
  code: z.string().trim().length(5),
  reconnectToken: z.string().uuid(),
});
const gameRulesSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["solo", "duel", "race"]),
  maxGuesses: z.number().int().min(1).max(20),
  roundTimeSeconds: z.number().int().min(30).max(600),
  bestOf: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7)]),
  comparisonKeys: z
    .array(z.enum(comparisonKeys))
    .min(3)
    .max(comparisonKeys.length),
  pool: z.object({
    includeTags: z.array(z.string().trim().min(1).max(80)).max(50),
    excludeTags: z.array(z.string().trim().min(1).max(80)).max(50),
    tagMode: z.enum(["all", "any"]),
    allAgesOnly: z.boolean(),
    includeOtome: z.boolean().default(false),
    includeChina: z.boolean(),
    includeWest: z.boolean(),
    maxTagSpoilerLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    fameTier: z.enum([
      "novice",
      "standard",
      "veteran",
      "experienced",
      "master",
    ]),
  }),
});

function bindSocketSession(
  socket: { data: Record<string, unknown> },
  roomCode: string,
  playerId: string,
): void {
  socket.data.roomCode = roomCode;
  socket.data.playerId = playerId;
}

function socketIdentity(socket: { data: Record<string, unknown> }): {
  roomCode: string;
  playerId: string;
} {
  if (
    typeof socket.data.roomCode !== "string" ||
    typeof socket.data.playerId !== "string"
  ) {
    throw new Error("SOCKET_SESSION_REQUIRED");
  }
  return {
    roomCode: socket.data.roomCode,
    playerId: socket.data.playerId,
  };
}
async function broadcastRoomState(roomCode: string): Promise<void> {
  const room = rooms.get(roomCode);
  io.to(roomCode).emit("room:updated", room);
  if (!room.round) return;
  if (room.phase === "active") {
    scheduleRoomExpiry(room.code, room.round.deadlineAt);
  } else if (room.phase === "round_result" && room.intermissionDeadlineAt) {
    scheduleIntermissionEnd(room.code, room.intermissionDeadlineAt);
  }
  const sockets = await io.in(roomCode).fetchSockets();
  for (const roomSocket of sockets) {
    try {
      const identity = socketIdentity(roomSocket);
      roomSocket.emit(
        "game:state",
        rooms.getPlayerGame(roomCode, identity.playerId),
      );
    } catch {
      // Ignore sockets that have not completed room authentication.
    }
  }
}

async function persistMatchIfFinished(roomCode: string): Promise<void> {
  try {
    await matchRecorder.record(rooms.getMatchReport(roomCode));
  } catch (error) {
    console.error("match recording failed:", error);
  }
}

function scheduleRoomExpiry(roomCode: string, deadlineAt: string): void {
  const delay = Math.max(0, Date.parse(deadlineAt) - Date.now()) + 50;
  setTimeout(() => {
    const expiredRoom = rooms.expire(roomCode);
    if (expiredRoom) {
      void broadcastRoomState(expiredRoom.code);
      void persistMatchIfFinished(expiredRoom.code);
    }
  }, delay).unref();
}

function scheduleIntermissionEnd(roomCode: string, deadlineAt: string): void {
  const delay = Math.max(0, Date.parse(deadlineAt) - Date.now()) + 50;
  setTimeout(() => {
    const advancedRoom = rooms.advanceIntermission(roomCode);
    if (advancedRoom) {
      void broadcastRoomState(advancedRoom.code);
    }
  }, delay).unref();
}

app.use(cors({ origin: webOrigin, credentials: true }));
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "gal-yiba-server",
    now: new Date().toISOString(),
  });
});

app.get("/api/rules/options", (_request, response) => {
  response.json({ comparisonKeys, defaults: defaultRules });
});

app.get("/api/catalog/search", async (request, response, next) => {
  try {
    const query = normalizeTitle(String(request.query.q ?? ""));
    if (!query) return response.json({ items: [] });
    const items = searchCatalog(await loadCatalog(), query);
    return response.json({ items });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/catalog/tags", async (request, response, next) => {
  try {
    const query = normalizeTitle(String(request.query.q ?? ""));
    const parsedSpoilerLevel = Number(request.query.maxSpoilerLevel ?? 0);
    const allAgesOnly = String(request.query.allAgesOnly ?? "false") === "true";
    const includeOtome =
      String(request.query.includeOtome ?? "false") === "true";
    const fameTier = z
      .enum(["novice", "standard", "veteran", "experienced", "master"])
      .optional()
      .parse(request.query.fameTier);
    const maxSpoilerLevel = (
      [0, 1, 2].includes(parsedSpoilerLevel) ? parsedSpoilerLevel : 0
    ) as 0 | 1 | 2;
    const catalog = await loadCatalog();
    const counts = new Map<string, number>();
    for (const visualNovel of catalog) {
      if (fameTier && !fameTierPoolIncludes(catalog, visualNovel, fameTier))
        continue;
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
    const items = [...counts]
      .filter(([tag]) => !query || normalizeTitle(tag).includes(query))
      .sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      )
      .slice(0, 60)
      .map(([name, count]) => ({ name, count }));
    return response.json({ items });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/catalog/fame-tiers", async (_request, response, next) => {
  try {
    const catalog = await loadCatalog();
    const counts = {} as Record<FameTier, number>;
    for (const tier of Object.keys(fameTierPoolSizes) as FameTier[]) {
      counts[tier] = Math.min(fameTierPoolSizes[tier], catalog.length);
    }
    response.json({ counts, sizes: fameTierPoolSizes });
  } catch (error) {
    next(error);
  }
});

const dailyRules: GameRules = {
  ...defaultRules,
  mode: "solo",
};

app.get("/api/daily", async (request, response, next) => {
  try {
    const catalog = await loadCatalog();
    if (catalog.length === 0) throw new Error("CATALOG_EMPTY");
    const playerToken = String(request.header("x-daily-player") ?? "").trim();
    const result = dailyGames.getOrCreate(
      playerToken || null,
      catalog,
      dailyRules,
      new Date(),
    );
    if (!playerToken) response.setHeader("X-Daily-Player", result.playerToken);
    response.json({
      date: result.date,
      rules: result.session.rules,
      session: publicGameSession(result.session),
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/daily/guess", async (request, response, next) => {
  try {
    const playerToken = String(request.header("x-daily-player") ?? "").trim();
    if (!playerToken) throw new Error("DAILY_PLAYER_REQUIRED");
    const parsedId = z
      .string()
      .uuid()
      .safeParse((request.body as { visualNovelId?: unknown })?.visualNovelId);
    if (!parsedId.success) throw new Error("INVALID_VISUAL_NOVEL_ID");
    const outcome = dailyGames.submitGuess(
      playerToken,
      parsedId.data,
      await loadCatalog(),
      new Date(),
    );
    if (!outcome.ok && outcome.error !== "GAME_EXPIRED")
      throw new Error(outcome.error);
    response.json({ session: publicGameSession(outcome.game) });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/leaderboard", async (request, response, next) => {
  try {
    const rawMode = String(request.query.mode ?? "");
    const mode: GameMode | undefined =
      rawMode === "solo" || rawMode === "duel" || rawMode === "race"
        ? rawMode
        : undefined;
    const limit = Math.min(
      50,
      Math.max(1, Number(request.query.limit ?? 20) || 20),
    );
    const items = await matchRecorder.leaderboard(
      mode ? { mode, limit } : { limit },
    );
    response.json({ items });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/chat-audio/:audioId", (request, response) => {
  const audio = chatAudios.get(String(request.params.audioId ?? ""));
  if (!audio) {
    response.status(404).end();
    return;
  }
  response.setHeader("Content-Type", audio.mimeType);
  response.setHeader("Cache-Control", "private, max-age=300");
  response.send(audio.buffer);
});

const adminToken = process.env.ADMIN_TOKEN ?? "";
const adminEnabled = adminToken.length > 0;

function requireAdmin(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
): void {
  if (!adminEnabled) return next(new Error("ADMIN_DISABLED"));
  if (request.header("authorization") !== `Bearer ${adminToken}`) {
    return next(new Error("ADMIN_UNAUTHORIZED"));
  }
  next();
}

app.use("/api/admin", requireAdmin);

app.get("/api/admin/mappings", async (request, response, next) => {
  try {
    if (!catalogRepository) throw new Error("DATABASE_UNAVAILABLE");
    const limit = Math.min(
      100,
      Math.max(1, Number(request.query.limit ?? 100) || 100),
    );
    const suggestions = await catalogRepository.listMappingSuggestions(limit);
    response.json({ suggestions });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/mappings/rebuild", async (_request, response, next) => {
  try {
    if (!databasePool || !catalogRepository)
      throw new Error("DATABASE_UNAVAILABLE");
    const summary = await new CatalogSyncService(
      databasePool,
    ).rebuildBangumiSuggestions(5_000);
    response.json(summary);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/mappings/decision", async (request, response, next) => {
  try {
    if (!catalogRepository) throw new Error("DATABASE_UNAVAILABLE");
    const input = z
      .object({
        source: z.enum(["vndb", "bangumi"]),
        sourceId: z.string().trim().min(1).max(120),
        decision: z.enum(["approved", "rejected"]),
      })
      .parse(request.body);
    await catalogRepository.reviewMappingSuggestion(
      input.source,
      input.sourceId,
      input.decision === "approved" ? "verified" : "rejected",
    );
    response.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.use(
  "/api",
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(400).json({
      error: error instanceof Error ? error.message : "INTERNAL_ERROR",
    });
  },
);

if (process.env.NODE_ENV === "production") {
  const webDist =
    process.env.WEB_DIST_PATH ??
    join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  app.use(express.static(webDist, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api(?:\/|$)|\/socket\.io(?:\/|$)).*/, (_request, response) => {
    response.sendFile(join(webDist, "index.html"));
  });
}

io.on("connection", (socket) => {
  socket.on("room:create", async (payload: unknown, acknowledge) => {
    try {
      const input = createRoomSchema.parse(payload);
      const result = rooms.create(
        input.nickname,
        input.mode,
        input.fameTier,
        input.playerId,
        input.featureCode,
      );
      socket.join(result.room.code);
      bindSocketSession(socket, result.room.code, result.session.playerId);
      acknowledge({ ok: true, ...result });
      await broadcastRoomState(result.room.code);
    } catch (error) {
      acknowledge({
        ok: false,
        error: error instanceof Error ? error.message : "INVALID_REQUEST",
      });
    }
  });

  socket.on("room:leave", async (_payload: unknown, acknowledge) => {
    try {
      const identity = socketIdentity(socket);
      const room = rooms.leave(identity.roomCode, identity.playerId);
      await socket.leave(identity.roomCode);
      delete socket.data.roomCode;
      delete socket.data.playerId;
      if (room) {
        await broadcastRoomState(room.code);
        await persistMatchIfFinished(room.code);
      } else {
        matchRecorder.forget(identity.roomCode);
      }
      acknowledge({ ok: true });
    } catch (error) {
      acknowledge({
        ok: false,
        error: error instanceof Error ? error.message : "INVALID_REQUEST",
      });
    }
  });

  socket.on("room:rematch", async (_payload: unknown, acknowledge) => {
    try {
      const identity = socketIdentity(socket);
      await persistMatchIfFinished(identity.roomCode);
      const room = rooms.rematch(identity.roomCode, identity.playerId);
      matchRecorder.forget(identity.roomCode);
      await broadcastRoomState(room.code);
    } catch (error) {
      acknowledge({
        ok: false,
        error: error instanceof Error ? error.message : "INVALID_REQUEST",
      });
    }
  });

  socket.on("room:chat", (payload: unknown, acknowledge) => {
    try {
      const identity = socketIdentity(socket);
      const text = z
        .string()
        .trim()
        .min(1)
        .max(200)
        .parse((payload as { text?: unknown })?.text);
      const message = rooms.postChat(
        identity.roomCode,
        identity.playerId,
        text,
        new Date(),
      );
      acknowledge({ ok: true, message });
      io.to(identity.roomCode).emit("room:chat", message);
    } catch (error) {
      acknowledge({
        ok: false,
        error: error instanceof Error ? error.message : "INVALID_REQUEST",
      });
    }
  });

  socket.on("room:chat-history", (_payload: unknown, acknowledge) => {
    try {
      const identity = socketIdentity(socket);
      acknowledge({ ok: true, messages: rooms.chatHistory(identity.roomCode) });
    } catch (error) {
      acknowledge({
        ok: false,
        error: error instanceof Error ? error.message : "INVALID_REQUEST",
      });
    }
  });

  socket.on("room:chat-audio", (payload: unknown, acknowledge) => {
    try {
      const identity = socketIdentity(socket);
      const data = payload as { audio?: unknown; mimeType?: unknown };
      const raw = data.audio;
      if (!(raw instanceof Uint8Array) || raw.byteLength === 0)
        throw new Error("AUDIO_EMPTY");
      if (raw.byteLength > 1_000_000) throw new Error("AUDIO_TOO_LARGE");
      const mimeType =
        typeof data.mimeType === "string" && data.mimeType.startsWith("audio/")
          ? data.mimeType
          : "audio/webm";
      const audioId = randomUUID();
      chatAudios.set(audioId, { buffer: Buffer.from(raw), mimeType });
      setTimeout(() => chatAudios.delete(audioId), 30 * 60_000).unref();
      const message = rooms.postChat(
        identity.roomCode,
        identity.playerId,
        "",
        new Date(),
        audioId,
      );
      acknowledge({ ok: true, message });
      io.to(identity.roomCode).emit("room:chat", message);
    } catch (error) {
      acknowledge({
        ok: false,
        error: error instanceof Error ? error.message : "INVALID_REQUEST",
      });
    }
  });

  socket.on("room:join", (payload: unknown, acknowledge) => {
    try {
      const input = joinSchema.parse(payload);
      const result = rooms.join(
        input.code,
        input.nickname,
        input.playerId,
        input.featureCode,
      );
      socket.join(result.room.code);
      bindSocketSession(socket, result.room.code, result.session.playerId);
      acknowledge({ ok: true, ...result });
      io.to(result.room.code).emit("room:updated", result.room);
    } catch (error) {
      acknowledge({
        ok: false,
        error: error instanceof Error ? error.message : "INVALID_REQUEST",
      });
    }
  });

  socket.on("room:reconnect", async (payload: unknown, acknowledge) => {
    try {
      const input = reconnectSchema.parse(payload);
      const result = rooms.reconnect(input.code, input.reconnectToken);
      socket.join(result.room.code);
      bindSocketSession(socket, result.room.code, result.session.playerId);
      acknowledge({ ok: true, ...result });
      await broadcastRoomState(result.room.code);
    } catch (error) {
      acknowledge({
        ok: false,
        error: error instanceof Error ? error.message : "INVALID_REQUEST",
      });
    }
  });

  socket.on("room:set-rules", (payload: unknown, acknowledge) => {
    try {
      const identity = socketIdentity(socket);
      const rules = gameRulesSchema.parse(
        (payload as { rules?: unknown })?.rules,
      ) as GameRules;
      const room = rooms.updateRules(
        identity.roomCode,
        identity.playerId,
        rules,
      );
      io.to(room.code).emit("room:updated", room);
      acknowledge({ ok: true, room });
    } catch (error) {
      acknowledge({
        ok: false,
        error: error instanceof Error ? error.message : "INVALID_REQUEST",
      });
    }
  });

  socket.on("room:set-ready", (payload: { ready: boolean }, acknowledge) => {
    try {
      const identity = socketIdentity(socket);
      const room = rooms.setReady(
        identity.roomCode,
        identity.playerId,
        Boolean(payload.ready),
      );
      io.to(room.code).emit("room:updated", room);
      acknowledge({ ok: true, room });
    } catch (error) {
      acknowledge({
        ok: false,
        error: error instanceof Error ? error.message : "INVALID_REQUEST",
      });
    }
  });

  socket.on("room:start", async (_payload: unknown, acknowledge) => {
    try {
      const identity = socketIdentity(socket);
      const catalog = await loadCatalog();
      if (catalog.length === 0) throw new Error("CATALOG_EMPTY");
      const room = rooms.start(identity.roomCode, identity.playerId, catalog);
      if (room.round) scheduleRoomExpiry(room.code, room.round.deadlineAt);
      await broadcastRoomState(room.code);
      acknowledge({
        ok: true,
        room,
        game: rooms.getPlayerGame(room.code, identity.playerId),
      });
    } catch (error) {
      acknowledge({
        ok: false,
        error: error instanceof Error ? error.message : "INVALID_REQUEST",
      });
    }
  });

  socket.on(
    "game:guess",
    async (payload: { visualNovelId?: unknown }, acknowledge) => {
      try {
        const identity = socketIdentity(socket);
        const visualNovelId = z.string().uuid().parse(payload.visualNovelId);
        const catalog = await loadCatalog();
        const result = rooms.submitPlayerGuess(
          identity.roomCode,
          identity.playerId,
          visualNovelId,
          catalog,
        );
        acknowledge({ ok: true, ...result });
        await broadcastRoomState(result.room.code);
        await persistMatchIfFinished(result.room.code);
      } catch (error) {
        acknowledge({
          ok: false,
          error: error instanceof Error ? error.message : "INVALID_REQUEST",
        });
      }
    },
  );

  socket.on("disconnect", () => {
    try {
      const identity = socketIdentity(socket);
      const room = rooms.disconnect(identity.roomCode, identity.playerId);
      if (room) io.to(room.code).emit("room:updated", room);
    } catch {
      // The socket may disconnect before it has joined a room.
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Gal Yi Ba server listening on http://localhost:${port}`);
});

async function shutdown(): Promise<void> {
  await databasePool?.end();
  httpServer.close();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
