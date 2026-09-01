import { describe, expect, it } from "vitest";
import {
  StaticPlayRuntime,
  normalizeSearchText,
  searchDemoCatalog,
} from "./static-play";
import { demoCatalog } from "@gal-yiba/shared";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("searchDemoCatalog", () => {
  it("matches Chinese aliases and developers", () => {
    expect(normalizeSearchText("千恋＊万花")).toContain("千恋");
    const byAlias = searchDemoCatalog(demoCatalog, "时空轮回");
    expect(byAlias[0]?.title).toMatch(/Ever17/i);
    const byDeveloper = searchDemoCatalog(demoCatalog, "Yuzusoft");
    expect(byDeveloper[0]?.match.type).toBe("developer");
    expect(byDeveloper[0]?.title).toContain("千恋");
  });
});

describe("StaticPlayRuntime", () => {
  it("creates a solo room, starts a round, and accepts a catalog guess", async () => {
    const runtime = new StaticPlayRuntime(memoryStorage());
    let created: {
      ok: boolean;
      session?: { playerId: string };
      room?: { code: string; phase: string };
    } = { ok: false };
    runtime.handleEmit(
      "room:create",
      { nickname: "测试员", mode: "solo", fameTier: "veteran" },
      (response) => {
        created = response as typeof created;
      },
    );
    expect(created.ok).toBe(true);
    expect(created.room?.phase).toBe("lobby");

    let started: { ok: boolean; game?: { status: string; guesses: unknown[] } } =
      { ok: false };
    runtime.handleEmit("room:start", {}, (response) => {
      started = response as typeof started;
    });
    expect(started.ok).toBe(true);
    expect(started.game?.status).toBe("active");

    const search = await runtime.handleFetch("/api/catalog/search?q=CLANNAD");
    const body = (await search.json()) as {
      items: Array<{ id: string; title: string }>;
    };
    expect(body.items[0]?.title).toBe("CLANNAD");

    let guessed: { ok: boolean; game?: { guesses: unknown[] } } = { ok: false };
    runtime.handleEmit(
      "game:guess",
      { visualNovelId: body.items[0]?.id },
      (response) => {
        guessed = response as typeof guessed;
      },
    );
    expect(guessed.ok).toBe(true);
    expect(guessed.game?.guesses).toHaveLength(1);
  });

  it("serves a daily puzzle and persists guesses in storage", async () => {
    const storage = memoryStorage();
    const runtime = new StaticPlayRuntime(storage);
    const first = await runtime.handleFetch("/api/daily");
    expect(first.ok).toBe(true);
    const token = first.headers.get("X-Daily-Player");
    expect(token).toBeTruthy();
    const payload = (await first.json()) as {
      date: string;
      session: { status: string };
    };
    expect(payload.session.status).toBe("active");

    const search = await runtime.handleFetch("/api/catalog/search?q=CLANNAD");
    const { items } = (await search.json()) as { items: Array<{ id: string }> };
    const guess = await runtime.handleFetch("/api/daily/guess", {
      method: "POST",
      body: JSON.stringify({ visualNovelId: items[0]?.id }),
    });
    expect(guess.ok).toBe(true);

    const again = new StaticPlayRuntime(storage);
    const resumed = await again.handleFetch("/api/daily");
    const resumedBody = (await resumed.json()) as {
      session: { guesses: unknown[] };
    };
    expect(resumedBody.session.guesses).toHaveLength(1);
  });

  it("rejects online matchmaking in static mode", () => {
    const runtime = new StaticPlayRuntime(memoryStorage());
    let response: { ok?: boolean; error?: string } = {};
    runtime.handleEmit(
      "matchmaking:join",
      { nickname: "x", fameTier: "veteran", bestOf: 1, featureCode: "ABCD" },
      (value) => {
        response = value as typeof response;
      },
    );
    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/静态演示/);
  });
});
