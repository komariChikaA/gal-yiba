import { io } from "socket.io-client";

const serverUrl = process.env.SERVER_URL ?? "http://127.0.0.1:3000";

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(serverUrl, { timeout: 5_000 });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForRoom(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("room:updated", onRoom);
      reject(new Error("room update timed out"));
    }, 5_000);
    function onRoom(room) {
      if (!predicate(room)) return;
      clearTimeout(timer);
      socket.off("room:updated", onRoom);
      resolve(room);
    }
    socket.on("room:updated", onRoom);
  });
}

const sockets = [];
try {
  const fameResponse = await fetch(`${serverUrl}/api/catalog/fame-tiers`);
  const fame = await fameResponse.json();
  if (!fame.counts || Object.values(fame.counts).some((count) => count < 1)) {
    throw new Error("one or more fame pools are empty");
  }

  const solo = await connect();
  sockets.push(solo);
  const soloCreated = await emitAck(solo, "room:create", {
    nickname: "单人玩家",
    mode: "solo",
    fameTier: "standard",
  });
  const soloStarted = await emitAck(solo, "room:start", {});
  if (
    !soloCreated.ok ||
    !soloStarted.ok ||
    soloStarted.room.phase !== "active"
  ) {
    throw new Error(
      `solo mode failed: ${soloStarted.error ?? "invalid state"}`,
    );
  }
  await emitAck(solo, "room:leave", {});

  const host = await connect();
  const guest = await connect();
  sockets.push(host, guest);
  const duelCreated = await emitAck(host, "room:create", {
    nickname: "左侧玩家",
    mode: "duel",
    fameTier: "standard",
  });
  const duelJoined = await emitAck(guest, "room:join", {
    nickname: "右侧玩家",
    code: duelCreated.room.code,
  });
  await emitAck(guest, "room:set-ready", { ready: true });
  const duelStarted = await emitAck(host, "room:start", {});
  if (!duelCreated.ok || !duelJoined.ok || !duelStarted.ok) {
    throw new Error(
      `duel mode failed: ${duelStarted.error ?? "invalid state"}`,
    );
  }

  const search = await fetch(`${serverUrl}/api/catalog/search?q=CLANNAD`).then(
    (response) => response.json(),
  );
  const candidate = search.items?.[0];
  if (!candidate) throw new Error("catalog smoke candidate not found");
  const progressUpdate = waitForRoom(host, (room) =>
    room.round?.players.some(
      (player) =>
        player.playerId === duelJoined.session.playerId &&
        player.guessCount === 1,
    ),
  );
  const guessed = await emitAck(guest, "game:guess", {
    visualNovelId: candidate.id,
  });
  if (!guessed.ok) throw new Error(`duel guess failed: ${guessed.error}`);
  await progressUpdate;

  if (guessed.room.phase === "active") {
    const concedeUpdate = waitForRoom(
      host,
      (room) =>
        room.phase === "finished" &&
        room.winnerPlayerId === duelCreated.session.playerId,
    );
    await emitAck(guest, "room:leave", {});
    await concedeUpdate;
  } else {
    await emitAck(guest, "room:leave", {});
  }

  console.log(
    JSON.stringify({
      solo: "active",
      duel: "progress-and-leave-ok",
      race: "covered-by-smoke-game",
      fameCounts: fame.counts,
    }),
  );
} finally {
  for (const socket of sockets) socket.close();
}
