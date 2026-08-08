import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  defaultComparisonKeys,
  voteTierThresholds,
  type ComparisonKey,
  type ComparisonResult,
  type FameTier,
  type GameMode,
  type GameRules,
} from "@gal-yiba/shared";
import {
  formatComparisonAriaLabel,
  formatComparisonMarker,
  formatComparisonValue,
  formatGuessStars,
} from "./comparison-format";

const socket = io({ autoConnect: true });

const comparisonLabels: Record<ComparisonKey, string> = {
  developer: "开发会社",
  publisher: "发行商",
  scenarioWriter: "脚本家",
  heroineHairColor: "女主发色",
  releaseYear: "首发年份",
  playtime: "游戏时长",
  vndbRating: "VNDB 综合评分",
  bangumiRating: "Bangumi 评分",
  vndbVoteCount: "VNDB 票数",
  bangumiVoteCount: "Bangumi 票数",
  animeAdaptation: "动漫化",
  ageRating: "全年龄",
  platforms: "平台",
  languages: "本地化语言",
  tags: "作品标签",
};

function formatTierRanges(thresholds: readonly number[]): string {
  return thresholds
    .map((threshold, index) => {
      const start = index === 0 ? 0 : thresholds[index - 1]!;
      return `${start.toLocaleString("zh-CN")}–${(threshold - 1).toLocaleString("zh-CN")}`;
    })
    .concat(`${thresholds.at(-1)?.toLocaleString("zh-CN")}+`)
    .join(" / ");
}

const comparisonRuleNotes = [
  "作品名：有可靠的 VNDB 官方关系且属于同系列时为黄色。",
  "会社：父子品牌为黄色；有会社交集时，答案会社更多显示 +，更少显示 −。",
  "脚本家、女主发色：有交集时为黄色，并用 + / − 表示答案的登记人数或主要女角色发色数更多/更少；VNDB 脚本担当不区分主次。",
  "年份：只采用官方 complete 正式版的最早年份；相差 5 年以内为黄色，并用 ↑ / ↓ 指向答案年份。",
  "时长：相邻一个时长级别为黄色，并显示 ↑ / ↓。",
  "评分：VNDB 与 Bangumi 分开比较，相差不超过 1.0 分为黄色。",
  `VNDB 热度档：${formatTierRanges(voteTierThresholds.vndbVoteCount)}；处于同一档为绿色、只差一档为黄色。`,
  `Bangumi 热度档：${formatTierRanges(voteTierThresholds.bangumiVoteCount)}；处于同一档为绿色、只差一档为黄色。`,
  "动画化：已宣布但尚未播出的作品显示黄色；没有可靠播出状态时不会猜测。",
  "全年龄：相同为绿色、不同为灰色，不使用黄色；非成人内容的 15+ 发行版按全年龄侧处理。",
  "平台：有共同平台时为黄色；答案还有更多主要平台时显示 +。标签有交集时为黄色。",
];

const modeOptions: Array<{
  value: GameMode;
  label: string;
  description: string;
}> = [
  {
    value: "solo",
    label: "单人模式",
    description: "独自推理，不用等待其他玩家",
  },
  {
    value: "duel",
    label: "1v1 模式",
    description: "左右对阵，实时查看星号进度",
  },
  { value: "race", label: "多人竞技", description: "2–8 人同时竞猜同一答案" },
];

const fameOptions: Array<{
  value: FameTier;
  label: string;
  description: string;
}> = [
  {
    value: "novice",
    label: "萌新",
    description: "高知名度：VNDB ≥ 1000 票或 Bangumi ≥ 3000 票",
  },
  {
    value: "standard",
    label: "标准",
    description: "中等知名度：VNDB ≥ 250 票或 Bangumi ≥ 300 票",
  },
  {
    value: "veteran",
    label: "老资历",
    description: "偏冷门：低于标准档票数门槛",
  },
];

interface RoomPlayer {
  id: string;
  nickname: string;
  ready: boolean;
  connected: boolean;
}

interface RoomSnapshot {
  code: string;
  phase: string;
  hostPlayerId: string;
  players: RoomPlayer[];
  rules: GameRules;
  round: {
    roundNumber: number;
    startedAt: string;
    deadlineAt: string;
    answer: { id: string; title: string } | null;
    players: Array<{
      playerId: string;
      status: string;
      guessCount: number;
      finishedAt: string | null;
    }>;
  } | null;
  winnerPlayerId: string | null;
  revision: number;
}

interface GuessRecord {
  guessNumber: number;
  visualNovelId: string;
  title: string;
  titleStatus: "exact" | "partial" | "miss";
  comparison: ComparisonResult[];
  isCorrect: boolean;
  guessedAt: string;
}

interface PublicGameSession {
  id: string;
  status: "active" | "won" | "lost" | "expired";
  rules: GameRules;
  guesses: GuessRecord[];
  attemptsLeft: number;
  answer?: { id: string; title: string };
}

interface SearchItem {
  id: string;
  title: string;
  aliases: string[];
  developers: string[];
  match: { type: "title" | "developer"; value: string };
}

interface Session {
  playerId: string;
  reconnectToken: string;
}

interface RoomSuccess {
  ok: true;
  room: RoomSnapshot;
  session: Session;
  game?: PublicGameSession;
}

interface RoomFailure {
  ok: false;
  error: string;
}

type RoomResponse = RoomSuccess | RoomFailure;
type ColorTheme = "day" | "night";

export function App() {
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => {
    return localStorage.getItem("gal-yiba-color-theme") === "night"
      ? "night"
      : "day";
  });
  const [connected, setConnected] = useState(socket.connected);
  const [nickname, setNickname] = useState("");
  const [selectedMode, setSelectedMode] = useState<GameMode>("solo");
  const [selectedFameTier, setSelectedFameTier] =
    useState<FameTier>("standard");
  const [fameCounts, setFameCounts] = useState<Record<FameTier, number> | null>(
    null,
  );
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [selected, setSelected] = useState<ComparisonKey[]>([
    ...defaultComparisonKeys,
  ]);
  const [error, setError] = useState("");
  const [game, setGame] = useState<PublicGameSession | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [availableTags, setAvailableTags] = useState<
    Array<{ name: string; count: number }>
  >([]);
  const [includedTagInput, setIncludedTagInput] = useState("");
  const [customTag, setCustomTag] = useState("");

  const isHost = room != null && session?.playerId === room.hostPlayerId;
  const currentPlayer = room?.players.find(
    (player) => player.id === session?.playerId,
  );
  const canEnter = nickname.trim().length > 0 && connected;

  useEffect(() => {
    localStorage.setItem("gal-yiba-color-theme", colorTheme);
    document.documentElement.style.colorScheme =
      colorTheme === "night" ? "dark" : "light";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", colorTheme === "night" ? "#625044" : "#fff7e8");
  }, [colorTheme]);

  useEffect(() => {
    void fetch("/api/catalog/fame-tiers")
      .then(
        (response) =>
          response.json() as Promise<{ counts: Record<FameTier, number> }>,
      )
      .then((body) => setFameCounts(body.counts))
      .catch(() => setFameCounts(null));
  }, []);

  useEffect(() => {
    if (room?.round && game) window.scrollTo({ top: 0, behavior: "instant" });
  }, [room?.round?.roundNumber, game?.id]);

  useEffect(() => {
    const tryReconnect = () => {
      setConnected(true);
      const code = localStorage.getItem("gal-yiba-last-room");
      if (!code) return;
      const saved = localStorage.getItem(`gal-yiba-session-${code}`);
      if (!saved) return;
      try {
        const previous = JSON.parse(saved) as Session;
        socket.emit(
          "room:reconnect",
          { code, reconnectToken: previous.reconnectToken },
          handleRoomResponse,
        );
      } catch {
        localStorage.removeItem(`gal-yiba-session-${code}`);
        localStorage.removeItem("gal-yiba-last-room");
      }
    };
    const onConnect = () => tryReconnect();
    const onDisconnect = () => setConnected(false);
    const onRoomUpdated = (nextRoom: RoomSnapshot) => {
      setRoom(nextRoom);
      setSelected(nextRoom.rules.comparisonKeys);
      if (nextRoom.players.length >= 2) {
        setError((current) =>
          current === "NOT_ENOUGH_PLAYERS" ? "" : current,
        );
      }
    };
    const onGameState = (nextGame: PublicGameSession) => setGame(nextGame);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:updated", onRoomUpdated);
    socket.on("game:state", onGameState);
    if (socket.connected) tryReconnect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:updated", onRoomUpdated);
      socket.off("game:state", onGameState);
    };
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    if (!room || !isHost || room.phase !== "lobby") return;
    const controller = new AbortController();
    void fetch(
      `/api/catalog/tags?maxSpoilerLevel=${room.rules.pool.maxTagSpoilerLevel}&allAgesOnly=${room.rules.pool.allAgesOnly}&fameTier=${room.rules.pool.fameTier}`,
      {
        signal: controller.signal,
      },
    )
      .then(
        (response) =>
          response.json() as Promise<{
            items: Array<{ name: string; count: number }>;
          }>,
      )
      .then((body) => setAvailableTags(body.items))
      .catch((requestError: Error) => {
        if (requestError.name !== "AbortError") setAvailableTags([]);
      });
    return () => controller.abort();
  }, [
    room?.code,
    room?.phase,
    room?.rules.pool.maxTagSpoilerLevel,
    room?.rules.pool.allAgesOnly,
    room?.rules.pool.fameTier,
    isHost,
  ]);

  useEffect(() => {
    if (!game || game.status !== "active" || searchQuery.trim().length < 1) {
      setSearchItems([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/catalog/search?q=${encodeURIComponent(searchQuery.trim())}`,
          {
            signal: controller.signal,
          },
        );
        const body = (await response.json()) as { items: SearchItem[] };
        setSearchItems(body.items);
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError")
          setError("题库搜索暂时不可用");
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [game, searchQuery]);

  function handleRoomResponse(response: RoomResponse) {
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setError("");
    setRoom(response.room);
    setSession(response.session);
    if (response.game) setGame(response.game);
    setSelected(response.room.rules.comparisonKeys);
    localStorage.setItem(
      `gal-yiba-session-${response.room.code}`,
      JSON.stringify(response.session),
    );
    localStorage.setItem("gal-yiba-last-room", response.room.code);
  }

  function createRoom() {
    socket.emit(
      "room:create",
      {
        nickname: nickname.trim(),
        mode: selectedMode,
        fameTier: selectedFameTier,
      },
      handleRoomResponse,
    );
  }

  function leaveRoom() {
    socket.emit(
      "room:leave",
      {},
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) {
          setError(response.error ?? "LEAVE_FAILED");
          return;
        }
        if (room) {
          localStorage.removeItem(`gal-yiba-session-${room.code}`);
          localStorage.removeItem("gal-yiba-last-room");
        }
        setRoom(null);
        setSession(null);
        setGame(null);
        setSearchQuery("");
        setSearchItems([]);
        setError("");
      },
    );
  }

  function joinRoom() {
    socket.emit(
      "room:join",
      { nickname: nickname.trim(), code: joinCode.trim().toUpperCase() },
      handleRoomResponse,
    );
  }

  function toggleComparison(key: ComparisonKey) {
    if (!room || !session || !isHost) return;
    const next = selectedSet.has(key)
      ? selected.filter((item) => item !== key)
      : [...selected, key];
    if (next.length < 3) {
      setError("至少保留 3 个比较项");
      return;
    }
    setSelected(next);
    saveRules({ ...room.rules, comparisonKeys: next });
  }

  function saveRules(rules: GameRules) {
    socket.emit(
      "room:set-rules",
      { rules },
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) setError(response.error ?? "RULE_UPDATE_FAILED");
        else setError("");
      },
    );
  }

  function toggleIncludedTag(tag: string) {
    if (!room || !isHost) return;
    const normalized = tag.trim();
    if (!normalized) return;
    const exists = room.rules.pool.includeTags.includes(normalized);
    const includeTags = exists
      ? room.rules.pool.includeTags.filter((item) => item !== normalized)
      : [...room.rules.pool.includeTags, normalized];
    saveRules({ ...room.rules, pool: { ...room.rules.pool, includeTags } });
  }

  function addExcludedTag() {
    if (!room || !isHost) return;
    const tag = customTag.trim();
    if (!tag || room.rules.pool.excludeTags.includes(tag)) return;
    saveRules({
      ...room.rules,
      pool: {
        ...room.rules.pool,
        excludeTags: [...room.rules.pool.excludeTags, tag],
      },
    });
    setCustomTag("");
  }

  function addIncludedTag() {
    if (!room || !isHost) return;
    const tag = includedTagInput.trim();
    if (!tag || room.rules.pool.includeTags.includes(tag)) return;
    toggleIncludedTag(tag);
    setIncludedTagInput("");
  }

  function removeExcludedTag(tag: string) {
    if (!room || !isHost) return;
    saveRules({
      ...room.rules,
      pool: {
        ...room.rules.pool,
        excludeTags: room.rules.pool.excludeTags.filter((item) => item !== tag),
      },
    });
  }

  function toggleReady() {
    socket.emit(
      "room:set-ready",
      { ready: !currentPlayer?.ready },
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) setError(response.error ?? "READY_UPDATE_FAILED");
        else setError("");
      },
    );
  }

  function startGame() {
    socket.emit(
      "room:start",
      {},
      (response: { ok: boolean; error?: string; game?: PublicGameSession }) => {
        if (!response.ok) setError(response.error ?? "ROOM_START_FAILED");
        else {
          setError("");
          if (response.game) setGame(response.game);
        }
      },
    );
  }

  function submitVisualNovel(item: SearchItem) {
    socket.emit(
      "game:guess",
      { visualNovelId: item.id },
      (response: { ok: boolean; error?: string; game?: PublicGameSession }) => {
        if (!response.ok) setError(response.error ?? "GUESS_FAILED");
        else {
          setError("");
          setSearchQuery("");
          setSearchItems([]);
          if (response.game) setGame(response.game);
        }
      },
    );
  }

  return (
    <div className="app-shell" data-theme={colorTheme}>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="旮一把首页">
          <span className="brand-dice">旮</span>
          <span>
            旮一把<small>GUESS THE GALGAME</small>
          </span>
        </a>
        <nav>
          <a href="#modes">玩法</a>
          <a href="#data">数据</a>
          <button
            className="theme-toggle"
            type="button"
            aria-label={
              colorTheme === "day" ? "切换到柔和夜色" : "切换到明亮日光"
            }
            aria-pressed={colorTheme === "night"}
            onClick={() =>
              setColorTheme((current) => (current === "day" ? "night" : "day"))
            }
          >
            <span aria-hidden="true">{colorTheme === "day" ? "☾" : "☀"}</span>
            {colorTheme === "day" ? "夜色" : "日光"}
          </button>
          <span className={`connection ${connected ? "online" : "offline"}`}>
            {connected ? "联机服务已连接" : "正在重连"}
          </span>
        </nav>
      </header>

      <main id="top">
        {(!room?.round || !game) && (
          <section className="hero">
            <div className="hero-copy">
              <p className="eyebrow">PICK · COMPARE · OUTPLAY</p>
              <h1>
                不止猜中，
                <br />
                还要比对手<span>更快一步。</span>
              </h1>
              <p className="hero-lead">
                从 VNDB 与 Bangumi
                构建题库。房主决定这局看会社、年份、评分还是作品标签，所有玩家同题竞速。
              </p>

              {!room ? (
                <div className="entry-card">
                  <label>
                    <span>你的昵称</span>
                    <input
                      value={nickname}
                      maxLength={20}
                      onChange={(event) => setNickname(event.target.value)}
                      placeholder="输入 1–20 个字符"
                    />
                  </label>
                  <div className="entry-section">
                    <span>选择玩法</span>
                    <div className="mode-picker">
                      {modeOptions.map((option) => (
                        <button
                          key={option.value}
                          className={
                            selectedMode === option.value ? "selected" : ""
                          }
                          onClick={() => setSelectedMode(option.value)}
                        >
                          <b>{option.label}</b>
                          <small>{option.description}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="entry-section">
                    <span>作品知名度</span>
                    <div className="fame-picker">
                      {fameOptions.map((option) => (
                        <button
                          key={option.value}
                          className={
                            selectedFameTier === option.value ? "selected" : ""
                          }
                          onClick={() => setSelectedFameTier(option.value)}
                          title={option.description}
                        >
                          <b>{option.label}</b>
                          <small>
                            {fameCounts
                              ? `${fameCounts[option.value]} 部`
                              : option.description}
                          </small>
                        </button>
                      ))}
                    </div>
                    <p className="tier-description">
                      {
                        fameOptions.find(
                          (option) => option.value === selectedFameTier,
                        )?.description
                      }
                    </p>
                  </div>
                  <div className="entry-actions">
                    <button
                      className="primary"
                      disabled={!canEnter}
                      onClick={createRoom}
                    >
                      {selectedMode === "solo" ? "进入单人准备" : "创建房间"}
                    </button>
                    <div className="join-control">
                      <input
                        value={joinCode}
                        maxLength={5}
                        onChange={(event) =>
                          setJoinCode(event.target.value.toUpperCase())
                        }
                        placeholder="房间码"
                      />
                      <button
                        disabled={!canEnter || joinCode.length !== 5}
                        onClick={joinRoom}
                      >
                        加入
                      </button>
                    </div>
                  </div>
                  {error && <p className="error-message">{error}</p>}
                </div>
              ) : (
                <section className="room-card" aria-live="polite">
                  <div className="room-heading">
                    <div>
                      <small>ROOM CODE</small>
                      <strong>{room.code}</strong>
                    </div>
                    <span>
                      {room.rules.mode === "solo"
                        ? "单人模式"
                        : `${room.players.length} / ${room.rules.mode === "duel" ? 2 : 8} 人`}
                    </span>
                  </div>
                  <div className="player-list">
                    {room.players.map((player) => (
                      <div key={player.id}>
                        <i>{player.nickname.slice(0, 1).toUpperCase()}</i>
                        <span>{player.nickname}</span>
                        {player.id === room.hostPlayerId && <b>房主</b>}
                        {player.ready && <b className="ready-mark">已准备</b>}
                        {!player.connected && (
                          <b className="offline-mark">离线</b>
                        )}
                      </div>
                    ))}
                  </div>
                  {room.phase === "lobby" && (
                    <div className="lobby-actions">
                      {isHost ? (
                        <button className="primary" onClick={startGame}>
                          {room.rules.mode === "solo"
                            ? "开始单人游戏"
                            : "开始同题竞速"}
                        </button>
                      ) : (
                        <button
                          className={currentPlayer?.ready ? "ready" : ""}
                          onClick={toggleReady}
                        >
                          {currentPlayer?.ready ? "取消准备" : "我准备好了"}
                        </button>
                      )}
                      <p className="room-note">
                        {isHost
                          ? room.rules.mode === "solo"
                            ? "确认规则后即可开局。"
                            : "其他在线玩家准备后即可开局。"
                          : "准备后等待房主开始。"}
                      </p>
                      <button className="leave-button" onClick={leaveRoom}>
                        退出房间
                      </button>
                    </div>
                  )}
                  {room.phase !== "lobby" && (
                    <div className="lobby-actions">
                      <p className="room-note">
                        本轮状态：
                        {room.phase === "active" ? "游戏中" : "已结算"}
                      </p>
                      <button className="leave-button" onClick={leaveRoom}>
                        退出游戏
                      </button>
                    </div>
                  )}
                  {error && <p className="error-message">{error}</p>}
                </section>
              )}
            </div>

            <aside className="rule-builder">
              <div className="rule-builder-head">
                <div>
                  <small>ROOM RULES</small>
                  <h2>这把比较什么？</h2>
                </div>
                <b>{selected.length} 项</b>
              </div>
              <p>
                {room
                  ? isHost
                    ? "点击切换，房间内即时同步。"
                    : "本局由房主选择。"
                  : "创建房间后即可自选，至少保留 3 项。"}
              </p>
              <div className="comparison-grid">
                {(Object.keys(comparisonLabels) as ComparisonKey[]).map(
                  (key, index) => (
                    <button
                      key={key}
                      className={selectedSet.has(key) ? "selected" : ""}
                      disabled={!isHost}
                      onClick={() => toggleComparison(key)}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      {comparisonLabels[key]}
                      <i>{selectedSet.has(key) ? "✓" : "+"}</i>
                    </button>
                  ),
                )}
              </div>
              <details className="comparison-notes">
                <summary>黄色判定与符号说明</summary>
                <ul>
                  {comparisonRuleNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </details>
              {room && (
                <section className="pool-builder">
                  <div className="fame-rule-picker">
                    <small>作品知名度</small>
                    <div className="fame-picker">
                      {fameOptions.map((option) => (
                        <button
                          key={option.value}
                          className={
                            room.rules.pool.fameTier === option.value
                              ? "selected"
                              : ""
                          }
                          disabled={!isHost}
                          onClick={() =>
                            saveRules({
                              ...room.rules,
                              pool: {
                                ...room.rules.pool,
                                fameTier: option.value,
                              },
                            })
                          }
                          title={option.description}
                        >
                          <b>{option.label}</b>
                          <small>
                            {fameCounts ? `${fameCounts[option.value]} 部` : ""}
                          </small>
                        </button>
                      ))}
                    </div>
                    <p>
                      {
                        fameOptions.find(
                          (option) => option.value === room.rules.pool.fameTier,
                        )?.description
                      }
                    </p>
                  </div>
                  <div className="pool-builder-head">
                    <div>
                      <small>ANSWER POOL</small>
                      <h3>答案题池标签</h3>
                    </div>
                    <div className="tag-mode" aria-label="标签匹配方式">
                      <button
                        className={
                          room.rules.pool.tagMode === "all" ? "selected" : ""
                        }
                        disabled={!isHost}
                        onClick={() =>
                          saveRules({
                            ...room.rules,
                            pool: { ...room.rules.pool, tagMode: "all" },
                          })
                        }
                      >
                        全部满足
                      </button>
                      <button
                        className={
                          room.rules.pool.tagMode === "any" ? "selected" : ""
                        }
                        disabled={!isHost}
                        onClick={() =>
                          saveRules({
                            ...room.rules,
                            pool: { ...room.rules.pool, tagMode: "any" },
                          })
                        }
                      >
                        任一满足
                      </button>
                    </div>
                  </div>

                  <p>选择答案必须包含的标签；留空表示不限制。</p>
                  {availableTags.length > 0 && (
                    <div className="tag-cloud">
                      {availableTags.slice(0, 18).map((tag) => (
                        <button
                          key={tag.name}
                          className={
                            room.rules.pool.includeTags.includes(tag.name)
                              ? "selected"
                              : ""
                          }
                          disabled={!isHost}
                          onClick={() => toggleIncludedTag(tag.name)}
                        >
                          {tag.name}
                          <small>{tag.count}</small>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="tag-entry">
                    <input
                      value={includedTagInput}
                      disabled={!isHost}
                      onChange={(event) =>
                        setIncludedTagInput(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") addIncludedTag();
                      }}
                      placeholder="自定义包含标签"
                    />
                    <button
                      disabled={!isHost || !includedTagInput.trim()}
                      onClick={addIncludedTag}
                    >
                      加入
                    </button>
                  </div>
                  {room.rules.pool.includeTags.length > 0 && (
                    <div className="selected-tags">
                      {room.rules.pool.includeTags.map((tag) => (
                        <button
                          key={tag}
                          disabled={!isHost}
                          onClick={() => toggleIncludedTag(tag)}
                        >
                          {tag}
                          <span>×</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="pool-options">
                    <label>
                      <span>只要全年龄游戏</span>
                      <input
                        type="checkbox"
                        checked={room.rules.pool.allAgesOnly}
                        disabled={!isHost}
                        onChange={(event) =>
                          saveRules({
                            ...room.rules,
                            pool: {
                              ...room.rules.pool,
                              allAgesOnly: event.target.checked,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>标签剧透上限</span>
                      <select
                        value={room.rules.pool.maxTagSpoilerLevel}
                        disabled={!isHost}
                        onChange={(event) =>
                          saveRules({
                            ...room.rules,
                            pool: {
                              ...room.rules.pool,
                              maxTagSpoilerLevel: Number(event.target.value) as
                                0 | 1 | 2,
                            },
                          })
                        }
                      >
                        <option value={0}>0 · 无剧透</option>
                        <option value={1}>1 · 轻微剧透</option>
                        <option value={2}>2 · 全部标签</option>
                      </select>
                    </label>
                  </div>

                  <p className="exclude-label">排除标签</p>
                  <div className="tag-entry">
                    <input
                      value={customTag}
                      disabled={!isHost}
                      onChange={(event) => setCustomTag(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") addExcludedTag();
                      }}
                      placeholder="例如：猎奇"
                    />
                    <button
                      disabled={!isHost || !customTag.trim()}
                      onClick={addExcludedTag}
                    >
                      排除
                    </button>
                  </div>
                  {room.rules.pool.excludeTags.length > 0 && (
                    <div className="selected-tags excluded-tags">
                      {room.rules.pool.excludeTags.map((tag) => (
                        <button
                          key={tag}
                          disabled={!isHost}
                          onClick={() => removeExcludedTag(tag)}
                        >
                          {tag}
                          <span>×</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </aside>
          </section>
        )}

        {room?.round && game && (
          <section className="game-stage">
            <div className="game-stage-head">
              <div>
                <p className="eyebrow">ROUND {room.round.roundNumber}</p>
                <h2>
                  {game.status === "active"
                    ? "搜一部作品，开始排除答案。"
                    : "本轮已经结算。"}
                </h2>
              </div>
              <div className="attempt-counter">
                <b>{game.attemptsLeft}</b>
                <span>剩余猜测</span>
              </div>
              <button className="game-exit" onClick={leaveRoom}>
                退出游戏
              </button>
            </div>

            {game.status === "active" ? (
              <div className="game-search">
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="作品名 / 别名 / 开发会社"
                />
                {searchItems.length > 0 && (
                  <div className="game-suggestions">
                    {searchItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => submitVisualNovel(item)}
                      >
                        <b>{item.title}</b>
                        <span>
                          {item.match.type === "developer"
                            ? `会社 · ${item.match.value}`
                            : item.aliases.slice(0, 2).join(" · ") ||
                              `标题 · ${item.match.value}`}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="answer-banner">
                <span>
                  {game.status === "won" ? "你抢先猜中了" : "本轮答案"}
                </span>
                <strong>
                  {game.answer?.title ?? room.round.answer?.title ?? "等待结算"}
                </strong>
              </div>
            )}

            {room.rules.mode === "duel" ? (
              <div className="duel-progress" aria-label="1v1 答题进度">
                {room.round.players
                  .slice()
                  .sort((left, right) =>
                    left.playerId === session?.playerId
                      ? -1
                      : right.playerId === session?.playerId
                        ? 1
                        : 0,
                  )
                  .map((playerProgress) => {
                    const player = room.players.find(
                      (item) => item.id === playerProgress.playerId,
                    );
                    const isSelf =
                      playerProgress.playerId === session?.playerId;
                    return (
                      <div
                        key={playerProgress.playerId}
                        className={isSelf ? "self" : "opponent"}
                      >
                        <small>{isSelf ? "自己" : "对手"}</small>
                        <span>{player?.nickname ?? "玩家"}</span>
                        <b>
                          {formatGuessStars(
                            playerProgress.guessCount,
                            room.rules.maxGuesses,
                          )}
                        </b>
                        <i>
                          {playerProgress.guessCount} / {room.rules.maxGuesses}{" "}
                          次
                        </i>
                      </div>
                    );
                  })}
              </div>
            ) : room.rules.mode === "race" ? (
              <div className="race-progress">
                {room.round.players.map((playerProgress) => {
                  const player = room.players.find(
                    (item) => item.id === playerProgress.playerId,
                  );
                  return (
                    <div key={playerProgress.playerId}>
                      <span>{player?.nickname ?? "玩家"}</span>
                      <b>{playerProgress.guessCount} 次</b>
                      <i>{playerProgress.status}</i>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="guess-history">
              {game.guesses.length === 0 ? (
                <p>第一次猜测后，比较结果会出现在这里。</p>
              ) : (
                game.guesses
                  .slice()
                  .reverse()
                  .map((guess) => (
                    <article key={guess.visualNovelId}>
                      <header className={`title-${guess.titleStatus}`}>
                        <b>{guess.title}</b>
                        <span>
                          {guess.titleStatus === "partial" && "同系列 · "}
                          {guess.titleStatus === "exact" && "答案 · "}第{" "}
                          {guess.guessNumber} 次
                        </span>
                      </header>
                      <div>
                        {guess.comparison.map((result) => (
                          <span
                            key={result.key}
                            className={`comparison-card ${result.status}`}
                          >
                            <small>{comparisonLabels[result.key]}</small>
                            <strong
                              className="comparison-value"
                              title={formatComparisonValue(result)}
                            >
                              {formatComparisonValue(result)}
                            </strong>
                            <span
                              className="comparison-verdict"
                              aria-label={formatComparisonAriaLabel(result)}
                            >
                              {formatComparisonMarker(result)}
                              {result.direction && (
                                <i>
                                  {result.direction === "higher" ? "↑" : "↓"}
                                </i>
                              )}
                            </span>
                          </span>
                        ))}
                      </div>
                    </article>
                  ))
              )}
            </div>
          </section>
        )}

        {(!room?.round || !game) && (
          <section id="modes" className="feature-strip">
            <article>
              <b>01</b>
              <h2>单人推理</h2>
              <p>随机题与每日同题，猜错也会缩小范围。</p>
            </article>
            <article>
              <b>02</b>
              <h2>同题竞速</h2>
              <p>房间同步开局，按猜中速度与尝试次数结算。</p>
            </article>
            <article>
              <b>03</b>
              <h2>规则自己定</h2>
              <p>比较列、题池标签、剧透等级与全年龄筛选由房间规则保存。</p>
            </article>
          </section>
        )}

        {(!room?.round || !game) && (
          <section id="data" className="data-note">
            <p className="eyebrow">SOURCE-AWARE DATABASE</p>
            <h2>两套资料库，不做含糊拼接。</h2>
            <p>
              VNDB 与 Bangumi
              原始记录分开同步，每个展示字段保留来源；同名、重制、FD
              和合集冲突会进入映射审核。
            </p>
            <div>
              <span>VNDB</span>
              <i>规范标签 · 制作人员 · 语言平台</i>
              <span>BANGUMI</span>
              <i>中文社区标题 · 公共标签 · 评分统计</i>
            </div>
          </section>
        )}
      </main>

      <footer>
        <b>旮一把</b>
        <span>第一阶段原型 · 数据与规则均可追踪</span>
      </footer>
    </div>
  );
}
