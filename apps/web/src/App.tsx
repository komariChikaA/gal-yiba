import { useEffect, useMemo, useRef, useState } from "react";
import { MusicPlayer } from "./MusicPlayer";
import {
  audioSrc,
  backendFetch,
  emit,
  isConnected,
  isStaticPlay,
  off,
  on,
} from "./backend";
import {
  defaultComparisonKeys,
  rankDefinitions,
  voteTierThresholds,
  type ComparisonKey,
  type ComparisonResult,
  type FameTier,
  type GameMode,
  type GameRules,
  type PlayerRank,
  type RankedBestOf,
  type RankedFameTier,
} from "@gal-yiba/shared";
import {
  comparisonSymbol,
  formatComparisonAriaLabel,
  formatComparisonValue,
  formatCountdown,
  formatGuessStars,
} from "./comparison-format";
import {
  featureCodeToPlayerId,
  loadFeatureCode,
  loadPlayerId,
  normalizeFeatureCode,
  resolvePlayerId,
  saveFeatureCode,
} from "./identity";

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
    description: "Bangumi 票数前 100 部",
  },
  {
    value: "standard",
    label: "入门",
    description: "Bangumi 票数前 250 部",
  },
  {
    value: "veteran",
    label: "标准",
    description: "Bangumi 票数前 500 部",
  },
  {
    value: "experienced",
    label: "小资历",
    description: "前 500 部按 Bangumi 票数，再扩充至 750 部",
  },
  {
    value: "master",
    label: "老资历",
    description: "前 500 部按 Bangumi 票数，再扩充至 1024 部",
  },
];

const rankedFameOptions: Array<{
  value: RankedFameTier;
  label: string;
  winRate: string;
}> = [
  { value: "novice", label: "萌新", winRate: "25% 胜率即可增长" },
  { value: "standard", label: "入门", winRate: "30% 胜率即可增长" },
  { value: "veteran", label: "标准", winRate: "40% 胜率即可增长" },
];

const rankPromotionRows = [
  { name: "初心", tier: "beginner" },
  { name: "旮士", tier: "ga_soldier" },
  { name: "旮杰", tier: "ga_elite" },
  { name: "旮豪", tier: "ga_master" },
  { name: "旮圣", tier: "ga_saint" },
] as const;

interface RoomPlayer {
  id: string;
  nickname: string;
  ready: boolean;
  connected: boolean;
  rankLabel: string | null;
}

interface RoomSnapshot {
  code: string;
  phase: string;
  hostPlayerId: string;
  players: RoomPlayer[];
  rules: GameRules;
  rulesLocked: boolean;
  rankedMatch: {
    fameTier: RankedFameTier;
    bestOf: RankedBestOf;
  } | null;
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
          status: "exact" | "partial" | "miss" | "unknown";
          hint: "more" | "fewer" | null;
          direction: "higher" | "lower" | null;
        }>;
      }>;
    }>;
  };
  winnerPlayerId: string | null;
  matchWinnerPlayerId: string | null;
  scores: Array<{ playerId: string; wins: number }>;
  intermissionDeadlineAt: string | null;
  revision: number;
}
interface GuessRecord {
  guessNumber: number;
  visualNovelId: string;
  title: string;
  displayTitle: string;
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
  deadlineAt: string;
  attemptsLeft: number;
  answer?: { id: string; title: string; displayTitle: string };
}

interface ChatMessage {
  playerId: string;
  nickname: string;
  text: string;
  at: string;
  audioId: string | null;
}

interface DailyGame {
  date: string;
  playerToken: string | null;
  game: PublicGameSession;
}

interface SearchItem {
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

interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  wins: number;
  matches: number;
  pt?: number;
  rank?: PlayerRank;
}

interface RealtimeStats {
  onlinePlayers: number;
  battlingPlayers: number;
  activeRooms: number;
  updatedAt: string;
}

interface MatchmakingStats {
  total: number;
  byFameTier: Record<RankedFameTier, number>;
  byQueue: Record<string, number>;
  updatedAt: string;
}

interface RankedProfile {
  playerId: string;
  pt: number;
  wins: number;
  matches: number;
  rank: PlayerRank;
}

interface MappingSuggestion {
  canonicalId: string;
  canonicalTitle: string;
  source: "vndb" | "bangumi";
  sourceId: string;
  sourceTitle: string;
  confidence: number;
  evidence: Record<string, unknown>;
}

interface MappingRebuildSummary {
  recordsSeen: number;
  suggestionsWritten: number;
}

const ADMIN_TOKEN_KEY = "gal-yiba-admin-token";

export function App() {
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => {
    return localStorage.getItem("gal-yiba-color-theme") === "night"
      ? "night"
      : "day";
  });
  const [connected, setConnected] = useState(() => isConnected());
  const [realtimeStats, setRealtimeStats] = useState<RealtimeStats | null>(
    null,
  );
  const [matchmakingStats, setMatchmakingStats] =
    useState<MatchmakingStats | null>(null);
  const [rankedProfile, setRankedProfile] = useState<RankedProfile | null>(
    null,
  );
  const [matchmakingPosition, setMatchmakingPosition] = useState<number | null>(
    null,
  );
  const [featureCode, setFeatureCode] = useState(() => loadFeatureCode());
  const [playerId, setPlayerId] = useState(() =>
    resolvePlayerId(loadFeatureCode()),
  );
  const [nickname, setNickname] = useState("");
  const [selectedMode, setSelectedMode] = useState<GameMode>("solo");
  const [selectedFameTier, setSelectedFameTier] = useState<FameTier>("veteran");
  const [matchmakingFameTier, setMatchmakingFameTier] =
    useState<RankedFameTier>("veteran");
  const [matchmakingBestOf, setMatchmakingBestOf] = useState<RankedBestOf>(1);
  const [fameCounts, setFameCounts] = useState<Record<FameTier, number> | null>(
    null,
  );
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardMode, setLeaderboardMode] = useState<
    "ranked" | "all" | GameMode
  >("ranked");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(
    null,
  );
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminToken, setAdminToken] = useState(
    () => sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "",
  );
  const [adminSuggestions, setAdminSuggestions] = useState<
    MappingSuggestion[] | null
  >(null);
  const [adminError, setAdminError] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminRebuild, setAdminRebuild] =
    useState<MappingRebuildSummary | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatOpen, setChatOpen] = useState(true);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const chatAudioRef = useRef<HTMLAudioElement | null>(null);
  const secondsTimerRef = useRef<number | null>(null);
  const [game, setGame] = useState<PublicGameSession | null>(null);
  const [daily, setDaily] = useState<DailyGame | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);
  const [availableTags, setAvailableTags] = useState<
    Array<{ name: string; count: number }>
  >([]);
  const [selected, setSelected] = useState<ComparisonKey[]>([
    ...defaultComparisonKeys,
  ]);
  const [includedTagInput, setIncludedTagInput] = useState("");
  const [customTag, setCustomTag] = useState("");

  const isHost = room != null && session?.playerId === room.hostPlayerId;
  const canEditRules = isHost && room?.rulesLocked !== true;
  const currentPlayer = room?.players.find(
    (player) => player.id === session?.playerId,
  );
  const currentRank = rankedProfile?.rank;
  const currentRankProgress = currentRank
    ? currentRank.nextMinPt === null
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            ((rankedProfile.pt - currentRank.minPt) /
              (currentRank.nextMinPt - currentRank.minPt)) *
              100,
          ),
        )
    : 0;
  const canEnter = nickname.trim().length > 0 && connected;
  const activeGame = daily?.game ?? (room?.round && game ? game : null);
  const roundEyebrow = daily
    ? `每日同题 · ${daily.date}`
    : `ROUND ${room?.round?.roundNumber ?? 1}`;
  const matchScorePlayers =
    room && room.rules.bestOf > 1 && room.scores.length > 0
      ? room.scores.map((score) => ({
          playerId: score.playerId,
          wins: score.wins,
          nickname:
            room.players.find((player) => player.id === score.playerId)
              ?.nickname ?? "玩家",
          isSelf: score.playerId === session?.playerId,
          isWinner:
            room.matchWinnerPlayerId === score.playerId &&
            room.phase === "finished",
          target: Math.ceil(room.rules.bestOf / 2),
        }))
      : [];
  const matchWon =
    room != null &&
    room.phase === "finished" &&
    room.matchWinnerPlayerId === session?.playerId;
  const remainingSeconds = activeGame
    ? Math.max(
        0,
        Math.ceil((Date.parse(activeGame.deadlineAt) - clockNow) / 1000),
      )
    : 0;
  /** 多人局中猜测次数用尽但本轮尚未结束：不揭晓答案，继续倒计时。 */
  const exhausted = activeGame?.status === "lost" && room?.phase === "active";

  /** 1v1 对手的猜测记录（颜色可见、文字留白）。 */
  const duelOpponent =
    room?.rules.mode === "duel"
      ? (room.round?.players.find(
          (player) => player.playerId !== session?.playerId,
        ) ?? null)
      : null;
  useEffect(() => {
    localStorage.setItem("gal-yiba-color-theme", colorTheme);
    document.documentElement.style.colorScheme =
      colorTheme === "night" ? "dark" : "light";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", colorTheme === "night" ? "#08152f" : "#dceefc");
  }, [colorTheme]);

  useEffect(() => {
    const ticking =
      (activeGame != null && activeGame.status === "active") ||
      room?.phase === "round_result" ||
      (activeGame?.status === "lost" && room?.phase === "active");
    if (!ticking) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [
    activeGame?.id,
    activeGame?.status,
    activeGame?.deadlineAt,
    room?.phase,
    room?.intermissionDeadlineAt,
  ]);

  useEffect(() => {
    void backendFetch("/api/catalog/fame-tiers")
      .then(
        (response) =>
          response.json() as Promise<{ counts: Record<FameTier, number> }>,
      )
      .then((body) => setFameCounts(body.counts))
      .catch(() => setFameCounts(null));
  }, []);

  useEffect(() => {
    if (featureCode.length < 4) {
      setRankedProfile(null);
      return;
    }
    const controller = new AbortController();
    void backendFetch("/api/matchmaking/stats", { signal: controller.signal })
      .then((response) => response.json() as Promise<MatchmakingStats>)
      .then(setMatchmakingStats)
      .catch((requestError: Error) => {
        if (requestError.name !== "AbortError") setMatchmakingStats(null);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void backendFetch(
      `/api/ranked/profile?featureCode=${encodeURIComponent(featureCode)}`,
      { signal: controller.signal },
    )
      .then(
        (response) => response.json() as Promise<{ profile: RankedProfile }>,
      )
      .then((body) => setRankedProfile(body.profile))
      .catch((requestError: Error) => {
        if (requestError.name !== "AbortError") setRankedProfile(null);
      });
    return () => controller.abort();
  }, [featureCode, playerId, room?.revision]);

  useEffect(() => {
    const controller = new AbortController();
    void backendFetch("/api/stats/realtime", { signal: controller.signal })
      .then((response) => response.json() as Promise<RealtimeStats>)
      .then(setRealtimeStats)
      .catch((requestError: Error) => {
        if (requestError.name !== "AbortError") setRealtimeStats(null);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!showLeaderboard) return;
    setLeaderboard(null);
    const controller = new AbortController();
    const endpoint =
      leaderboardMode === "ranked"
        ? "/api/leaderboard/ranked"
        : `/api/leaderboard${leaderboardMode === "all" ? "" : `?mode=${leaderboardMode}`}`;
    void backendFetch(endpoint, { signal: controller.signal })
      .then(
        (response) => response.json() as Promise<{ items: LeaderboardEntry[] }>,
      )
      .then((body) => setLeaderboard(body.items))
      .catch(() => setLeaderboard([]));
    return () => controller.abort();
  }, [showLeaderboard, leaderboardMode]);

  async function adminLoad() {
    if (!adminToken) return;
    setAdminBusy(true);
    setAdminError("");
    try {
      const response = await backendFetch("/api/admin/mappings", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = (await response.json()) as {
        suggestions?: MappingSuggestion[];
        error?: string;
      };
      if (!response.ok) {
        setAdminError(body.error ?? "ADMIN_LOAD_FAILED");
        setAdminSuggestions(null);
        return;
      }
      setAdminSuggestions(body.suggestions ?? []);
    } catch {
      setAdminError("管理接口加载失败");
    } finally {
      setAdminBusy(false);
    }
  }

  function openAdmin() {
    setShowAdmin(true);
    setAdminError("");
    setAdminRebuild(null);
    if (adminToken) void adminLoad();
  }

  async function adminDecide(
    suggestion: MappingSuggestion,
    decision: "approved" | "rejected",
  ) {
    setAdminBusy(true);
    try {
      const response = await backendFetch("/api/admin/mappings/decision", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          source: suggestion.source,
          sourceId: suggestion.sourceId,
          decision,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setAdminError(body.error ?? "DECISION_FAILED");
        return;
      }
      setAdminSuggestions(
        (current) =>
          current?.filter(
            (item) =>
              !(
                item.source === suggestion.source &&
                item.sourceId === suggestion.sourceId
              ),
          ) ?? null,
      );
    } catch {
      setAdminError("操作失败");
    } finally {
      setAdminBusy(false);
    }
  }

  async function adminRebuildSuggestions() {
    setAdminBusy(true);
    setAdminError("");
    try {
      const response = await backendFetch("/api/admin/mappings/rebuild", {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = (await response.json()) as {
        recordsSeen?: number;
        suggestionsWritten?: number;
        error?: string;
      };
      if (!response.ok) {
        setAdminError(body.error ?? "REBUILD_FAILED");
        return;
      }
      setAdminRebuild({
        recordsSeen: body.recordsSeen ?? 0,
        suggestionsWritten: body.suggestionsWritten ?? 0,
      });
      await adminLoad();
    } catch {
      setAdminError("重建失败");
    } finally {
      setAdminBusy(false);
    }
  }

  function saveAdminToken() {
    const trimmed = adminToken.trim();
    if (!trimmed) return;
    sessionStorage.setItem(ADMIN_TOKEN_KEY, trimmed);
    setAdminToken(trimmed);
    void adminLoad();
  }

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
        emit(
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
    const onDisconnect = () => {
      setConnected(false);
      setMatchmakingPosition(null);
    };
    const onRoomUpdated = (nextRoom: RoomSnapshot) => {
      setRoom(nextRoom);
      setSelected(nextRoom.rules.comparisonKeys);
      if (!nextRoom.round) setGame(null);
      if (nextRoom.players.length >= 2) {
        setError((current) =>
          current === "NOT_ENOUGH_PLAYERS" ? "" : current,
        );
      }
    };
    const onGameState = (nextGame: PublicGameSession) => setGame(nextGame);
    const onRealtimeStats = (nextStats: RealtimeStats) =>
      setRealtimeStats(nextStats);
    const onMatchmakingStats = (nextStats: MatchmakingStats) =>
      setMatchmakingStats(nextStats);
    const onMatchmakingPosition = (payload: { position: number | null }) =>
      setMatchmakingPosition(payload.position);
    const onMatchmakingMatched = (response: RoomSuccess) => {
      setMatchmakingPosition(null);
      handleRoomResponse(response);
    };
    on("connect", onConnect);
    on("disconnect", onDisconnect);
    on("room:updated", onRoomUpdated);
    on("game:state", onGameState);
    on("presence:updated", onRealtimeStats);
    on("matchmaking:stats", onMatchmakingStats);
    on("matchmaking:position", onMatchmakingPosition);
    on("matchmaking:matched", onMatchmakingMatched);

    on("room:chat", (message: ChatMessage) =>
      setChatMessages((current) => [...current, message].slice(-100)),
    );
    if (isConnected()) tryReconnect();
    return () => {
      off("connect", onConnect);
      off("disconnect", onDisconnect);
      off("room:updated", onRoomUpdated);
      off("game:state", onGameState);
      off("presence:updated", onRealtimeStats);
      off("matchmaking:stats", onMatchmakingStats);
      off("matchmaking:position", onMatchmakingPosition);
      off("matchmaking:matched", onMatchmakingMatched);
    };
  }, []);

  useEffect(() => {
    const list = chatListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chatMessages, chatOpen]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    if (!room || !canEditRules || room.phase !== "lobby") return;
    const controller = new AbortController();
    void backendFetch(
      `/api/catalog/tags?maxSpoilerLevel=${room.rules.pool.maxTagSpoilerLevel}&allAgesOnly=${room.rules.pool.allAgesOnly}&includeOtome=${room.rules.pool.includeOtome}&fameTier=${room.rules.pool.fameTier}`,
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
    room?.rules.pool.includeOtome,
    room?.rules.pool.fameTier,
    canEditRules,
  ]);

  useEffect(() => {
    if (
      !activeGame ||
      activeGame.status !== "active" ||
      searchQuery.trim().length < 1
    ) {
      setSearchItems([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await backendFetch(
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
  }, [activeGame, searchQuery]);

  async function toggleRecord() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      setError("无法访问麦克风（需要 HTTPS 与浏览器授权）");
      return;
    }
    if (mediaRecorderRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      setError("当前浏览器不支持录音");
      return;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      if (recordingTimerRef.current !== null) {
        window.clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (secondsTimerRef.current !== null) {
        window.clearInterval(secondsTimerRef.current);
        secondsTimerRef.current = null;
      }
      setRecording(false);
      setRecordingSeconds(0);
      const blob = new Blob(chunks, {
        type: recorder.mimeType || "audio/webm",
      });
      if (blob.size < 1500) {
        setError(`录音只有 ${blob.size} 字节，麦克风可能未工作，请检查后重试`);
        return;
      }
      sendAudioMessage(blob);
    };
    recorder.onerror = () => {
      stream.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      setRecording(false);
      setRecordingSeconds(0);
      setError("录音失败");
    };
    mediaRecorderRef.current = recorder;
    setRecording(true);
    setRecordingSeconds(0);
    recorder.start();
    secondsTimerRef.current = window.setInterval(() => {
      setRecordingSeconds((current) => current + 1);
    }, 1000);
    recordingTimerRef.current = window.setTimeout(() => {
      recorder.stop();
    }, 60_000);
  }

  function sendAudioMessage(blob: Blob) {
    emit(
      "room:chat-audio",
      { audio: blob, mimeType: blob.type },
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) setError(response.error ?? "语音发送失败");
      },
    );
  }

  function playChatAudio(audioId: string) {
    // 复用同一元素并保持引用，防止 Chrome 对未挂载音频做垃圾回收导致无声
    if (chatAudioRef.current) chatAudioRef.current.pause();
    const audio = new Audio(audioSrc(audioId));
    chatAudioRef.current = audio;
    audio.onerror = () => setError("语音播放失败");
    void audio.play().catch(() => setError("语音播放失败"));
  }

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
    emit(
      "room:chat-history",
      {},
      (historyResponse: { ok: boolean; messages?: ChatMessage[] }) => {
        if (historyResponse.ok) setChatMessages(historyResponse.messages ?? []);
      },
    );
  }

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
    };
  }, []);

  function sendChat() {
    const text = chatText.trim();
    if (!text) return;
    setChatText("");
    emit(
      "room:chat",
      { text },
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) setError(response.error ?? "CHAT_FAILED");
      },
    );
  }

  function applyFeatureCode(raw: string) {
    const normalized = normalizeFeatureCode(raw);
    setFeatureCode(normalized);
    if (normalized.length >= 4) {
      saveFeatureCode(normalized);
      setPlayerId(featureCodeToPlayerId(normalized));
    } else if (normalized.length === 0) {
      saveFeatureCode("");
      setPlayerId(loadPlayerId());
    }
  }

  function createRoom() {
    emit(
      "room:create",
      {
        nickname: nickname.trim(),
        mode: selectedMode,
        fameTier: selectedFameTier,
        playerId,
        featureCode: featureCode || undefined,
      },
      handleRoomResponse,
    );
  }

  function joinMatchmaking() {
    setError("");
    if (!nickname.trim()) {
      setError("请先输入昵称，再加入匹配池。");
      return;
    }
    if (featureCode.length < 4) {
      setError("段位与特征码绑定，请先输入至少 4 位特征码。");
      return;
    }
    emit(
      "matchmaking:join",
      {
        nickname: nickname.trim(),
        fameTier: matchmakingFameTier,
        bestOf: matchmakingBestOf,
        playerId,
        featureCode,
      },
      (response: {
        ok: boolean;
        status?: "waiting" | "matched";
        position?: number;
        error?: string;
      }) => {
        if (!response.ok) {
          setMatchmakingPosition(null);
          setError(response.error ?? "MATCHMAKING_FAILED");
          return;
        }
        if (response.status === "waiting") {
          setMatchmakingPosition(response.position ?? 1);
        }
      },
    );
  }

  function cancelMatchmaking() {
    emit(
      "matchmaking:cancel",
      {},
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) {
          setError(response.error ?? "MATCHMAKING_CANCEL_FAILED");
          return;
        }
        setMatchmakingPosition(null);
        setError("");
      },
    );
  }
  function leaveRoom() {
    emit(
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

  function rematchRoom() {
    emit(
      "room:rematch",
      {},
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) setError(response.error ?? "REMATCH_FAILED");
        else setError("");
      },
    );
  }

  function joinRoom() {
    emit(
      "room:join",
      {
        nickname: nickname.trim(),
        code: joinCode.trim().toUpperCase(),
        playerId,
        featureCode: featureCode || undefined,
      },
      handleRoomResponse,
    );
  }

  function toggleComparison(key: ComparisonKey) {
    if (!room || !session || !canEditRules) return;
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
    emit(
      "room:set-rules",
      { rules },
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) setError(response.error ?? "RULE_UPDATE_FAILED");
        else setError("");
      },
    );
  }

  function toggleIncludedTag(tag: string) {
    if (!room || !canEditRules) return;
    const normalized = tag.trim();
    if (!normalized) return;
    const exists = room.rules.pool.includeTags.includes(normalized);
    const includeTags = exists
      ? room.rules.pool.includeTags.filter((item) => item !== normalized)
      : [...room.rules.pool.includeTags, normalized];
    saveRules({ ...room.rules, pool: { ...room.rules.pool, includeTags } });
  }

  function addExcludedTag() {
    if (!room || !canEditRules) return;
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
    if (!room || !canEditRules) return;
    const tag = includedTagInput.trim();
    if (!tag || room.rules.pool.includeTags.includes(tag)) return;
    toggleIncludedTag(tag);
    setIncludedTagInput("");
  }

  function removeExcludedTag(tag: string) {
    if (!room || !canEditRules) return;
    saveRules({
      ...room.rules,
      pool: {
        ...room.rules.pool,
        excludeTags: room.rules.pool.excludeTags.filter((item) => item !== tag),
      },
    });
  }

  function toggleReady() {
    emit(
      "room:set-ready",
      { ready: !currentPlayer?.ready },
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) setError(response.error ?? "READY_UPDATE_FAILED");
        else setError("");
      },
    );
  }

  function startGame() {
    emit(
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

  async function enterDaily() {
    try {
      const saved = localStorage.getItem("gal-yiba-daily-player");
      const headers: Record<string, string> = {};
      if (saved) headers["X-Daily-Player"] = saved;
      const response = await backendFetch("/api/daily", { headers });
      const body = (await response.json()) as {
        date: string;
        session: PublicGameSession;
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "DAILY_LOAD_FAILED");
        return;
      }
      const token = response.headers.get("X-Daily-Player") ?? saved ?? null;
      if (token) localStorage.setItem("gal-yiba-daily-player", token);
      setError("");
      setSearchQuery("");
      setSearchItems([]);
      setDaily({ date: body.date, playerToken: token, game: body.session });
    } catch {
      setError("每日同题加载失败");
    }
  }

  function exitDaily() {
    setDaily(null);
    setSearchQuery("");
    setSearchItems([]);
    setError("");
  }

  async function submitDailyGuess(item: SearchItem) {
    const token = daily?.playerToken;
    if (!token) return;
    try {
      const response = await backendFetch("/api/daily/guess", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Daily-Player": token,
        },
        body: JSON.stringify({ visualNovelId: item.id }),
      });
      const body = (await response.json()) as {
        session: PublicGameSession;
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "GUESS_FAILED");
        return;
      }
      setError("");
      setSearchQuery("");
      setSearchItems([]);
      setDaily((current) =>
        current ? { ...current, game: body.session } : current,
      );
    } catch {
      setError("提交猜测失败");
    }
  }

  useEffect(() => {
    if (!daily?.game || daily.game.status !== "active") return;
    if (remainingSeconds > 0) return;
    const headers: Record<string, string> = {};
    if (daily.playerToken) headers["X-Daily-Player"] = daily.playerToken;
    const controller = new AbortController();
    void backendFetch("/api/daily", { headers, signal: controller.signal })
      .then(
        (response) =>
          response.json() as Promise<{ session: PublicGameSession }>,
      )
      .then((body) =>
        setDaily((current) =>
          current ? { ...current, game: body.session } : current,
        ),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [daily?.game?.id, daily?.game?.status, remainingSeconds <= 0]);

  function submitVisualNovel(item: SearchItem) {
    if (daily) {
      void submitDailyGuess(item);
      return;
    }
    emit(
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
          <a
            className="github-link"
            href="https://github.com/komariChikaA/gal-yiba"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
          <button
            className="nav-link"
            type="button"
            onClick={() => setShowLeaderboard(true)}
          >
            排行榜
          </button>
          <button className="nav-link" type="button" onClick={openAdmin}>
            管理
          </button>
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
            {isStaticPlay
              ? "静态演示"
              : connected
                ? "联机服务已连接"
                : "正在重连"}
          </span>
          <span
            className="live-stats"
            title={`活跃房间 ${realtimeStats?.activeRooms ?? 0} 个`}
            aria-live="polite"
          >
            <b>{realtimeStats?.battlingPlayers ?? "—"}</b> 人对战中
            <small>在线 {realtimeStats?.onlinePlayers ?? "—"}</small>
          </span>
        </nav>
      </header>

      <main id="top">
        <aside className="test-notice" role="status">
          {isStaticPlay ? (
            <>
              <b>GitHub Pages 临时站</b>
              <span>
                当前是无后端静态演示：内置 12 部作品，可玩单人房间和每日同题。联机房间、段位匹配和排行榜需要独立服务器。
              </span>
            </>
          ) : (
            <>
              <b>测试中</b>
              <span>本网站正在测试中，每天凌晨有可能会不定时更新内容。</span>
            </>
          )}
        </aside>
        {!activeGame && (
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
                  <label>
                    <span>
                      特征码
                      <small className="optional-hint">
                        （可选，≥4 位字母数字，跨设备同步战绩）
                      </small>
                    </span>
                    <input
                      value={featureCode}
                      maxLength={16}
                      onChange={(event) => applyFeatureCode(event.target.value)}
                      placeholder="留空则匿名统计"
                    />
                  </label>
                  <section className="entry-function-block room-entry-block">
                    <header>
                      <div>
                        <small>自定义玩法</small>
                        <h2>创建或加入房间</h2>
                      </div>
                      <span>房主可调整题池与判定标准</span>
                    </header>
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
                            disabled={matchmakingPosition !== null}
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
                              selectedFameTier === option.value
                                ? "selected"
                                : ""
                            }
                            onClick={() => setSelectedFameTier(option.value)}
                            disabled={matchmakingPosition !== null}
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
                    <div className="entry-actions room-entry-actions">
                      <button
                        className="daily-button"
                        disabled={!connected || matchmakingPosition !== null}
                        onClick={() => void enterDaily()}
                      >
                        每日同题 · 所有人同一天同一题
                      </button>
                      <button
                        className="primary"
                        disabled={!canEnter || matchmakingPosition !== null}
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
                          disabled={matchmakingPosition !== null}
                        />
                        <button
                          disabled={
                            !canEnter ||
                            joinCode.length !== 5 ||
                            matchmakingPosition !== null
                          }
                          onClick={joinRoom}
                        >
                          加入
                        </button>
                      </div>
                    </div>
                  </section>

                  <section className="entry-function-block ranked-match-block">
                    <header>
                      <div>
                        <small>竞技玩法</small>
                        <h2>1v1 段位匹配</h2>
                      </div>
                      <span>
                        {featureCode.length >= 4
                          ? `已绑定特征码 ${featureCode}`
                          : "需先绑定至少 4 位特征码"}
                      </span>
                    </header>
                    <div className="rank-profile-card">
                      <div>
                        <small>当前段位</small>
                        <strong>
                          {featureCode.length >= 4
                            ? (currentRank?.label ?? "初心★1")
                            : "未绑定"}
                        </strong>
                      </div>
                      <div>
                        <b>
                          {featureCode.length >= 4
                            ? `${rankedProfile?.pt ?? 0} PT`
                            : "— PT"}
                        </b>
                        <small>
                          {rankedProfile?.wins ?? 0} 胜 /{" "}
                          {rankedProfile?.matches ?? 0} 场
                        </small>
                      </div>
                      <div className="rank-progress" aria-label="段位进度">
                        <i style={{ width: `${currentRankProgress}%` }} />
                      </div>
                      <p>
                        {featureCode.length < 4
                          ? "输入特征码后读取对应段位；同一码可跨设备继续。"
                          : rankedProfile === null
                            ? "正在读取绑定段位……"
                            : currentRank?.nextMinPt == null
                              ? "已达到最高段位"
                              : `距下一段还需 ${Math.max(0, currentRank.nextMinPt - (rankedProfile?.pt ?? 0))} PT`}
                      </p>
                    </div>
                    <div className="entry-section ranked-match-settings">
                      <span>匹配难度与赛制</span>
                      <div className="ranked-setting-row">
                        <div
                          className="ranked-difficulty"
                          aria-label="匹配难度"
                        >
                          {rankedFameOptions.map((option) => (
                            <button
                              key={option.value}
                              className={
                                matchmakingFameTier === option.value
                                  ? "selected"
                                  : ""
                              }
                              disabled={matchmakingPosition !== null}
                              onClick={() =>
                                setMatchmakingFameTier(option.value)
                              }
                            >
                              <b>{option.label}</b>
                              <small>{option.winRate}</small>
                            </button>
                          ))}
                        </div>
                        <div className="ranked-best-of" aria-label="匹配赛制">
                          {([1, 3] as const).map((bestOf) => (
                            <button
                              key={bestOf}
                              className={
                                matchmakingBestOf === bestOf ? "selected" : ""
                              }
                              disabled={matchmakingPosition !== null}
                              onClick={() => setMatchmakingBestOf(bestOf)}
                            >
                              BO{bestOf}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="tier-description">
                        平局不计有效局数；BO3 的 PT 奖励与扣分均高于 BO1。
                      </p>
                    </div>
                    <div className="ranked-match-action">
                      {matchmakingPosition === null ? (
                        <button
                          className="matchmaking-button"
                          disabled={!connected}
                          onClick={joinMatchmaking}
                        >
                          加入匹配池 · 当前队列{" "}
                          {matchmakingStats?.byQueue[
                            `${matchmakingFameTier}:bo${matchmakingBestOf}`
                          ] ?? 0}{" "}
                          人
                          <small>池中 0 人也可加入 · 点击后进入等待队列</small>
                        </button>
                      ) : (
                        <button
                          className="matchmaking-button waiting"
                          onClick={cancelMatchmaking}
                        >
                          匹配中 · 当前第 {matchmakingPosition} 位
                          <small>点击取消匹配</small>
                        </button>
                      )}
                    </div>
                    <details className="rank-promotion-table">
                      <summary>查看段位晋级表</summary>
                      <div>
                        {rankPromotionRows.map((row) => (
                          <p key={row.tier}>
                            <b>{row.name}</b>
                            {rankDefinitions
                              .filter((rank) => rank.tier === row.tier)
                              .map((rank) => `★${rank.level} ${rank.minPt} PT`)
                              .join(" · ")}
                          </p>
                        ))}
                        <p>
                          <b>魂天</b>
                          Lv1 6750 PT · 每级 +800 PT · Lv20 21950 PT
                        </p>
                      </div>
                    </details>
                  </section>
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
                        <span>
                          {player.rankLabel && (
                            <em className="rank-badge">{player.rankLabel}</em>
                          )}
                          {player.nickname}
                        </span>
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
                  ? room.rulesLocked
                    ? "快速匹配固定使用系统默认判定标准。"
                    : isHost
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
                      disabled={!canEditRules}
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
                          disabled={!canEditRules}
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
                        disabled={!canEditRules}
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
                        disabled={!canEditRules}
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
                          disabled={!canEditRules}
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
                      disabled={!canEditRules}
                      onChange={(event) =>
                        setIncludedTagInput(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") addIncludedTag();
                      }}
                      placeholder="自定义包含标签"
                    />
                    <button
                      disabled={!canEditRules || !includedTagInput.trim()}
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
                          disabled={!canEditRules}
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
                        disabled={!canEditRules}
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
                      <span>乙游（女性向恋爱）</span>
                      <input
                        type="checkbox"
                        checked={room.rules.pool.includeOtome}
                        disabled={!canEditRules}
                        onChange={(event) =>
                          saveRules({
                            ...room.rules,
                            pool: {
                              ...room.rules.pool,
                              includeOtome: event.target.checked,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>国旮（中国作品）</span>
                      <input
                        type="checkbox"
                        checked={room.rules.pool.includeChina}
                        disabled={!canEditRules}
                        onChange={(event) =>
                          saveRules({
                            ...room.rules,
                            pool: {
                              ...room.rules.pool,
                              includeChina: event.target.checked,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>欧美旮（非日非中）</span>
                      <input
                        type="checkbox"
                        checked={room.rules.pool.includeWest}
                        disabled={!canEditRules}
                        onChange={(event) =>
                          saveRules({
                            ...room.rules,
                            pool: {
                              ...room.rules.pool,
                              includeWest: event.target.checked,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>标签剧透上限</span>
                      <select
                        value={room.rules.pool.maxTagSpoilerLevel}
                        disabled={!canEditRules}
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
                    <label>
                      <span>每局时间</span>
                      <select
                        value={room.rules.roundTimeSeconds}
                        disabled={!canEditRules}
                        onChange={(event) =>
                          saveRules({
                            ...room.rules,
                            roundTimeSeconds: Number(event.target.value),
                          })
                        }
                      >
                        <option value={180}>3 分钟</option>
                        <option value={300}>5 分钟</option>
                        <option value={600}>10 分钟</option>
                      </select>
                    </label>
                    {room.rules.mode !== "solo" && (
                      <label>
                        <span>赛制</span>
                        <select
                          value={room.rules.bestOf}
                          disabled={!canEditRules}
                          onChange={(event) =>
                            saveRules({
                              ...room.rules,
                              bestOf: Number(event.target.value) as
                                1 | 3 | 5 | 7,
                            })
                          }
                        >
                          <option value={1}>单局决胜</option>
                          <option value={3}>三局两胜</option>
                          <option value={5}>五局三胜</option>
                          <option value={7}>七局四胜</option>
                        </select>
                      </label>
                    )}
                    {room.rules.mode !== "solo" && (
                      <label className="checkbox-option">
                        <span>平局不计有效局数</span>
                        <input
                          type="checkbox"
                          checked={room.rules.replayTiedRounds}
                          disabled={!canEditRules}
                          onChange={(event) =>
                            saveRules({
                              ...room.rules,
                              replayTiedRounds: event.target.checked,
                            })
                          }
                        />
                        <small>
                          开启后必须有人达到胜场目标，比赛才会结束。
                        </small>
                      </label>
                    )}
                  </div>

                  <p className="exclude-label">排除标签</p>
                  <div className="tag-entry">
                    <input
                      value={customTag}
                      disabled={!canEditRules}
                      onChange={(event) => setCustomTag(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") addExcludedTag();
                      }}
                      placeholder="例如：猎奇"
                    />
                    <button
                      disabled={!canEditRules || !customTag.trim()}
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
                          disabled={!canEditRules}
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

        {activeGame && (
          <section className="game-stage">
            <div className="game-stage-head">
              <div>
                <p className="eyebrow">{roundEyebrow}</p>
                <h2>
                  {activeGame.status === "active"
                    ? "搜一部作品，开始排除答案。"
                    : "本轮已经结算。"}
                </h2>
              </div>
              <div className="attempt-counter">
                <b>{activeGame.attemptsLeft}</b>
                <span>剩余猜测</span>
              </div>
              {activeGame.status === "active" && (
                <div
                  className={`round-countdown ${remainingSeconds <= 30 ? "urgent" : ""}`}
                  role="timer"
                  aria-live={remainingSeconds <= 30 ? "polite" : "off"}
                >
                  <span>剩余时间</span>
                  <b>{formatCountdown(remainingSeconds)}</b>
                </div>
              )}
              <button
                className="game-exit"
                onClick={daily ? exitDaily : leaveRoom}
              >
                退出游戏
              </button>
            </div>

            {matchScorePlayers.length > 0 && (
              <div className="match-score" aria-label="比赛比分">
                {matchScorePlayers.map((score) => (
                  <span
                    key={score.playerId}
                    className={`${score.isSelf ? "self" : ""} ${score.isWinner ? "winner" : ""}`}
                  >
                    <small>{score.isSelf ? "自己" : score.nickname}</small>
                    <b>
                      {score.wins}
                      <i> / {score.target} 胜</i>
                    </b>
                  </span>
                ))}
              </div>
            )}

            {room?.phase === "round_result" &&
              room?.intermissionDeadlineAt != null && (
                <div className="intermission-bar">
                  <span>中场休息 · 答案已揭晓，可交流战术</span>
                  <b>
                    {formatCountdown(
                      Math.max(
                        0,
                        Math.ceil(
                          (Date.parse(room.intermissionDeadlineAt) - clockNow) /
                            1000,
                        ),
                      ),
                    )}
                  </b>
                  <button
                    className={currentPlayer?.ready ? "ready" : ""}
                    onClick={toggleReady}
                  >
                    {currentPlayer?.ready ? "已准备" : "我准备好了"}
                  </button>
                  <small>全员准备可提前开始下一轮</small>
                </div>
              )}
            {activeGame.status === "active" ? (
              remainingSeconds > 0 ? (
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
                          <b>
                            {item.displayTitle}
                            {item.displayTitle !== item.title && (
                              <small className="original-title">
                                {item.title}
                              </small>
                            )}
                          </b>
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
                <div className="timer-settling">
                  {daily
                    ? "时间到，正在获取今日结果……"
                    : "时间到，正在等待本轮结算……"}
                </div>
              )
            ) : exhausted ? (
              <div className="exhausted-wait">
                <p>猜测次数用完，答案仍隐藏，等待本轮结束……</p>
                <b>{formatCountdown(remainingSeconds)}</b>
              </div>
            ) : (
              <>
                <div className="answer-banner">
                  <span>
                    {matchWon
                      ? "你赢得了整场比赛"
                      : activeGame.status === "won"
                        ? "你抢先猜中了"
                        : "本轮答案"}
                  </span>
                  <strong>
                    {activeGame.answer?.displayTitle ??
                      activeGame.answer?.title ??
                      room?.round?.answer?.title ??
                      "等待结算"}
                  </strong>
                </div>
                {room?.phase === "finished" &&
                (room.rankedMatch ||
                  room.hostPlayerId === session?.playerId) ? (
                  <button
                    className="rematch-button"
                    onClick={rematchRoom}
                    disabled={
                      room.rankedMatch !== null &&
                      room.rematchVotes.includes(session?.playerId ?? "")
                    }
                  >
                    {room.rankedMatch
                      ? room.rematchVotes.includes(session?.playerId ?? "")
                        ? "已申请 · 等待对手同意"
                        : "申请再来一把 · 仍计入段位"
                      : "再来一局 · 同房间继续"}
                  </button>
                ) : null}
              </>
            )}

            {room?.rules.mode === "duel" ? (
              <div className="duel-progress" aria-label="1v1 答题进度">
                {(room.round?.players ?? [])
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
                    const isWinner =
                      room.phase !== "active" &&
                      (room.matchWinnerPlayerId ?? room.winnerPlayerId) ===
                        playerProgress.playerId;
                    return (
                      <div
                        key={playerProgress.playerId}
                        className={`${isSelf ? "self" : "opponent"} ${isWinner ? "winner" : ""}`}
                      >
                        <small>{isSelf ? "自己" : "对手"}</small>
                        <span className="duel-nickname">
                          {player?.rankLabel && (
                            <em className="rank-badge">{player.rankLabel}</em>
                          )}
                          {player?.nickname ?? "玩家"}
                        </span>
                        <i>
                          {playerProgress.guessCount} / {room.rules.maxGuesses}{" "}
                          次
                        </i>
                      </div>
                    );
                  })}
              </div>
            ) : room?.rules.mode === "race" ? (
              <div className="race-progress">
                {(room.round?.players ?? []).map((playerProgress) => {
                  const player = room.players.find(
                    (item) => item.id === playerProgress.playerId,
                  );
                  const isWinner =
                    room.phase !== "active" &&
                    (room.matchWinnerPlayerId ?? room.winnerPlayerId) ===
                      playerProgress.playerId;
                  return (
                    <div
                      key={playerProgress.playerId}
                      className={isWinner ? "winner" : undefined}
                    >
                      <span>
                        {player?.rankLabel && (
                          <em className="rank-badge">{player.rankLabel}</em>
                        )}
                        {player?.nickname ?? "玩家"}
                      </span>
                      <b>{playerProgress.guessCount} 次</b>
                      <i>
                        {playerProgress.status === "won"
                          ? "胜利"
                          : playerProgress.status === "lost"
                            ? "本轮结束"
                            : playerProgress.status === "expired"
                              ? "已超时"
                              : "答题中"}
                      </i>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div
              className={
                duelOpponent ? "guess-history duel-history" : "guess-history"
              }
            >
              {activeGame.guesses.length === 0 ? (
                <p>第一次猜测后，比较结果会出现在这里。</p>
              ) : (
                <>
                  <div className="duel-column">
                    {activeGame.guesses
                      .slice()
                      .reverse()
                      .map((guess) => (
                        <article key={guess.visualNovelId}>
                          <header className={`title-${guess.titleStatus}`}>
                            <b>{guess.displayTitle ?? guess.title}</b>
                            <span>
                              {guess.titleStatus === "partial" && "同系列 · "}
                              {guess.titleStatus === "exact" &&
                                "答案 · "}第 {guess.guessNumber} 次
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
                                  className={`comparison-verdict ${result.status}`}
                                  aria-label={formatComparisonAriaLabel(result)}
                                >
                                  {comparisonSymbol(result)}
                                </span>
                              </span>
                            ))}
                          </div>
                        </article>
                      ))}
                  </div>
                  {duelOpponent && (
                    <div className="duel-column opponent">
                      {duelOpponent.guessDetails
                        .slice()
                        .reverse()
                        .map((detail) => (
                          <article key={detail.guessNumber}>
                            <header className={`title-${detail.titleStatus}`}>
                              <b aria-hidden="true">　</b>
                              <span>对手 · 第 {detail.guessNumber} 次</span>
                            </header>
                            <div>
                              {detail.comparisons.map((comparison, index) => (
                                <span
                                  key={index}
                                  className={`comparison-card ${comparison.status}`}
                                >
                                  <small>
                                    {room?.rules.comparisonKeys[index] !==
                                    undefined
                                      ? (comparisonLabels[
                                          room.rules.comparisonKeys[index]!
                                        ] ?? "")
                                      : ""}
                                  </small>
                                  <strong
                                    className="comparison-value"
                                    aria-hidden="true"
                                  >
                                    　
                                  </strong>
                                  <span
                                    className={`comparison-verdict ${comparison.status}`}
                                    aria-label="对手的比较结果（内容隐藏）"
                                  >
                                    {comparisonSymbol({
                                      status: comparison.status,
                                      hint: comparison.hint ?? undefined,
                                      direction:
                                        comparison.direction ?? undefined,
                                    })}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </article>
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {!activeGame && (
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

        {!activeGame && (
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
        <div className="footer-copy">
          <span>
            <a
              href="https://github.com/komariChikaA/gal-yiba/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
            >
              MIT License
            </a>
            {" · 数据与规则均可追踪 · "}
            <a
              href="https://github.com/komariChikaA/gal-yiba"
              target="_blank"
              rel="noreferrer"
            >
              GitHub 项目源码 ↗
            </a>
          </span>
          <small className="footer-legal">
            Contains information from{" "}
            <a href="https://vndb.org/" target="_blank" rel="noreferrer">
              VNDB
            </a>
            , which is made available here under the{" "}
            <a
              href="https://opendatacommons.org/licenses/odbl/1-0/"
              target="_blank"
              rel="noreferrer"
            >
              Open Database License (ODbL)
            </a>
            . Bangumi 条目数据遵循
            <a
              href="https://bgm.tv/about/copyright"
              target="_blank"
              rel="noreferrer"
            >
              开发者平台使用协议
            </a>
            。
          </small>
        </div>
      </footer>

      {showLeaderboard && (
        <div className="leaderboard-overlay" role="dialog" aria-label="排行榜">
          <div className="leaderboard-panel">
            <header>
              <h2>排行榜</h2>
              <button
                type="button"
                className="panel-close"
                onClick={() => setShowLeaderboard(false)}
                aria-label="关闭排行榜"
              >
                ×
              </button>
            </header>
            <p className="leaderboard-identity">
              {featureCode.length >= 4 ? (
                <>
                  我的特征码：<b>{featureCode}</b>（跨设备同步战绩）
                </>
              ) : (
                <>当前为匿名玩家，输入特征码后战绩可跨设备同步</>
              )}
            </p>
            <div className="leaderboard-filters">
              {(["ranked", "all", "solo", "duel", "race"] as const).map(
                (mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={leaderboardMode === mode ? "active" : ""}
                    onClick={() => setLeaderboardMode(mode)}
                  >
                    {mode === "ranked"
                      ? "匹配段位"
                      : mode === "all"
                        ? "全部"
                        : mode === "solo"
                          ? "单人"
                          : mode === "duel"
                            ? "1v1"
                            : "多人"}
                  </button>
                ),
              )}
            </div>
            {leaderboard === null ? (
              <p className="leaderboard-empty">加载中……</p>
            ) : leaderboard.length === 0 ? (
              <p className="leaderboard-empty">还没有对战记录——去开一局吧。</p>
            ) : (
              <ol className="leaderboard-list">
                {leaderboard.map((entry, index) => (
                  <li
                    key={entry.playerId}
                    className={entry.playerId === playerId ? "self" : undefined}
                  >
                    <i>{index + 1}</i>
                    <b>
                      {leaderboardMode === "ranked" && entry.rank && (
                        <em className="rank-badge">{entry.rank.label}</em>
                      )}
                      {entry.nickname}
                    </b>
                    <span>{entry.wins} 胜</span>
                    <small>
                      {entry.matches} 场
                      {leaderboardMode === "ranked" && entry.pt != null
                        ? ` · ${entry.pt} PT`
                        : ""}
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      {showAdmin && (
        <div
          className="leaderboard-overlay"
          role="dialog"
          aria-label="映射审核"
        >
          <div className="leaderboard-panel admin-panel">
            <header>
              <h2>映射审核</h2>
              <button
                type="button"
                className="panel-close"
                onClick={() => setShowAdmin(false)}
                aria-label="关闭管理面板"
              >
                ×
              </button>
            </header>

            {!adminToken && (
              <div className="admin-token-gate">
                <label htmlFor="admin-token-input">管理员令牌</label>
                <input
                  id="admin-token-input"
                  type="password"
                  value={adminToken}
                  onChange={(event) => setAdminToken(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveAdminToken();
                  }}
                  placeholder="ADMIN_TOKEN"
                />
                <button type="button" onClick={saveAdminToken}>
                  解锁
                </button>
              </div>
            )}

            {adminToken && (
              <>
                {adminError && <p className="admin-error">{adminError}</p>}
                {adminSuggestions === null ? (
                  <p className="leaderboard-empty">
                    {adminBusy
                      ? "加载中……"
                      : "尚未加载，点下方按钮拉取待审映射。"}
                  </p>
                ) : adminSuggestions.length === 0 ? (
                  <p className="leaderboard-empty">没有待审核的映射建议。</p>
                ) : (
                  <ul className="admin-suggestion-list">
                    {adminSuggestions.map((suggestion) => (
                      <li key={`${suggestion.source}:${suggestion.sourceId}`}>
                        <div className="admin-titles">
                          <b>{suggestion.canonicalTitle}</b>
                          <small>
                            {suggestion.source === "bangumi"
                              ? "Bangumi"
                              : "VNDB"}{" "}
                            · {suggestion.sourceTitle}
                          </small>
                          <i>
                            置信度 {Math.round(suggestion.confidence * 100)}%
                          </i>
                        </div>
                        <div className="admin-evidence">
                          {Object.entries(suggestion.evidence)
                            .map(
                              ([key, value]) =>
                                `${key}: ${JSON.stringify(value)}`,
                            )
                            .join(" · ")}
                        </div>
                        <div className="admin-actions">
                          <button
                            type="button"
                            disabled={adminBusy}
                            onClick={() => adminDecide(suggestion, "rejected")}
                          >
                            拒绝
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="admin-toolbar">
                  <button
                    type="button"
                    disabled={adminBusy}
                    onClick={() => void adminLoad()}
                  >
                    刷新待审
                  </button>
                  <button
                    type="button"
                    disabled={adminBusy}
                    onClick={() => void adminRebuildSuggestions()}
                  >
                    重建 Bangumi 建议
                  </button>
                  {adminRebuild && (
                    <span className="admin-rebuild-note">
                      扫描 {adminRebuild.recordsSeen} 条，新增建议{" "}
                      {adminRebuild.suggestionsWritten} 条
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {room && (
        <div className="room-chat">
          <button
            type="button"
            className="chat-fab"
            onClick={() => setChatOpen((current) => !current)}
          >
            对话
          </button>
          {chatOpen && (
            <div className="chat-panel" aria-label="房间对话">
              <div className="chat-messages" ref={chatListRef}>
                {chatMessages.length === 0 ? (
                  <p className="chat-empty">房间内还没有消息</p>
                ) : (
                  chatMessages.map((message, index) => (
                    <div
                      key={`${message.at}-${index}`}
                      className={
                        message.playerId === session?.playerId ? "self" : ""
                      }
                    >
                      <b>{message.nickname}</b>
                      {message.audioId ? (
                        <button
                          type="button"
                          className="chat-audio-play"
                          onClick={() => playChatAudio(message.audioId!)}
                        >
                          ▶ 语音
                        </button>
                      ) : (
                        <span>{message.text}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
              <form
                className="chat-input"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendChat();
                }}
              >
                <button
                  type="button"
                  className={`chat-voice ${recording ? "listening" : ""}`}
                  aria-label={recording ? "停止录音并发送" : "录音并发送语音"}
                  onClick={() => void toggleRecord()}
                >
                  🎤
                </button>
                <input
                  value={chatText}
                  maxLength={200}
                  placeholder={
                    recording
                      ? `正在录音 ${recordingSeconds}s…`
                      : "对房间内所有人说…"
                  }
                  onChange={(event) => setChatText(event.target.value)}
                />
                <button type="submit">发送</button>
              </form>
            </div>
          )}
        </div>
      )}
      <MusicPlayer />
    </div>
  );
}
