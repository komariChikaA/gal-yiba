import { io } from "socket.io-client";

const serverUrl = process.env.SERVER_URL ?? "http://127.0.0.1:3000";
const runGameSmoke = process.env.RUN_GAME_SMOKE === "1";

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(serverUrl, { timeout: 5_000 });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function emitWithAcknowledgement(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

const host = await connect();
const guest = await connect();
let reconnectedHost;

try {
  const created = await emitWithAcknowledgement(host, "room:create", {
    nickname: "房主",
  });
  if (!created.ok) throw new Error(`room:create failed: ${created.error}`);

  const joined = await emitWithAcknowledgement(guest, "room:join", {
    nickname: "玩家二",
    code: created.room.code.toLowerCase(),
  });
  if (!joined.ok) throw new Error(`room:join failed: ${joined.error}`);
  if (joined.room.players.length !== 2)
    throw new Error("expected two players in room");

  const spoofedRuleUpdate = await emitWithAcknowledgement(
    guest,
    "room:set-rules",
    {
      playerId: created.session.playerId,
      rules: created.room.rules,
    },
  );
  if (spoofedRuleUpdate.ok || spoofedRuleUpdate.error !== "HOST_ONLY") {
    throw new Error("guest was able to spoof host identity");
  }

  host.close();
  reconnectedHost = await connect();
  const restored = await emitWithAcknowledgement(
    reconnectedHost,
    "room:reconnect",
    {
      code: created.room.code,
      reconnectToken: created.session.reconnectToken,
    },
  );
  if (!restored.ok || restored.session.playerId !== created.session.playerId) {
    throw new Error("host reconnect failed");
  }

  let gameResult = {};
  if (runGameSmoke) {
    const ready = await emitWithAcknowledgement(guest, "room:set-ready", {
      ready: true,
    });
    if (!ready.ok) throw new Error(`room:set-ready failed: ${ready.error}`);
    const started = await emitWithAcknowledgement(
      reconnectedHost,
      "room:start",
      {},
    );
    if (!started.ok || started.room.phase !== "active" || started.game.answer) {
      throw new Error(
        `room:start failed or exposed answer: ${started.error ?? "invalid state"}`,
      );
    }

    const searchResponse = await fetch(
      `${serverUrl}/api/catalog/search?q=CLANNAD`,
    );
    const search = await searchResponse.json();
    const candidate = search.items?.[0];
    if (!candidate) throw new Error("catalog smoke candidate not found");
    const guessed = await emitWithAcknowledgement(guest, "game:guess", {
      visualNovelId: candidate.id,
    });
    if (!guessed.ok || guessed.game.guesses.length !== 1) {
      throw new Error(`game:guess failed: ${guessed.error ?? "missing guess"}`);
    }
    const comparisonCount = guessed.game.guesses[0]?.comparison.length;
    if (comparisonCount !== created.room.rules.comparisonKeys.length) {
      throw new Error("guess comparison fields do not match room rules");
    }
    const heroineHairColors = guessed.game.guesses[0]?.comparison.find(
      (result) => result.key === "heroineHairColor",
    )?.guessValue;
    if (!Array.isArray(heroineHairColors) || heroineHairColors.length === 0) {
      throw new Error("source-backed heroine hair colors are missing");
    }
    gameResult = {
      gameStartOk: started.ok,
      answerHiddenAtStart: !started.game.answer,
      guessOk: guessed.ok,
      comparisonCount,
      heroineHairColors,
    };
  }

  console.log(
    JSON.stringify({
      createOk: created.ok,
      joinOk: joined.ok,
      codeLength: created.room.code.length,
      players: joined.room.players.length,
      spoofBlocked: !spoofedRuleUpdate.ok,
      reconnectOk: restored.ok,
      ...gameResult,
    }),
  );
} finally {
  host.close();
  guest.close();
  reconnectedHost?.close();
}
