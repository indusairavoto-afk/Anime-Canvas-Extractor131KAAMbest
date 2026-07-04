import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link, useParams, useLocation } from "wouter";
import HlsPlayer, { getEpisodeProgressPct, type HlsSyncCommand } from "@/components/HlsPlayer";
import DashPlayer from "@/components/DashPlayer";
import {
  ArrowLeft, Search, Grid3X3, List, Play, Pause, SkipForward, SkipBack,
  RotateCcw, RotateCw, Scissors, Bookmark, BookmarkCheck, ChevronDown, Maximize2, Minimize2,
  MessageSquare, Eye, Flag, CheckCircle2,
  Volume2, VolumeX, Maximize, Minimize, Users,
} from "lucide-react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import { apiUrl } from "@/lib/api";
import { EpisodeRatingMeter } from "@/components/EpisodeRatingMeter";
import { useWatchTogether } from "@/hooks/useWatchTogether";
import { WatchTogetherPanel } from "@/components/WatchTogetherPanel";
import { useAuth } from "@/contexts/auth-context";

interface StreamEpisode {
  title: string;
  thumbnail: string;
  url: string;
  site: string;
}

interface RelationNode {
  id: number;
  title: { romaji: string; english?: string | null };
  coverImage: { large?: string };
  format?: string | null;
  seasonYear?: number | null;
  relationType: string;
}

interface JikanEpisode {
  mal_id: number;
  title: string | null;
  title_romanji: string | null;
  aired: string | null;
  score: number | null;
  filler: boolean;
  recap: boolean;
}

interface AniMedia {
  id: number;
  idMal?: number | null;
  nextAiringEpisode?: { episode: number; airingAt: number } | null;
  title: { romaji: string; english?: string | null; native?: string | null };
  coverImage: { extraLarge?: string; large?: string };
  bannerImage?: string | null;
  episodes?: number | null;
  duration?: number | null;
  averageScore?: number | null;
  score?: number | null;
  popularity?: number | null;
  status: string;
  seasonYear?: number | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null };
  countryOfOrigin?: string | null;
  format?: string | null;
  studios?: { nodes: { name: string }[] };
  streamingEpisodes: StreamEpisode[];
  externalLinks?: { url: string; site: string }[];
  relations?: {
    edges: {
      relationType: string;
      node: {
        id: number;
        title: { romaji: string; english?: string | null };
        coverImage: { large?: string };
        format?: string | null;
        seasonYear?: number | null;
      };
    }[];
  };
}

async function fetchJikanEpisodesProgressive(
  malId: number,
  totalEps: number,
  onPage: (all: JikanEpisode[]) => void,
): Promise<void> {
  const all: JikanEpisode[] = [];
  const maxPages = Math.ceil(Math.max(totalEps, 1) / 25) || 4;
  for (let page = 1; page <= Math.min(maxPages, 8); page++) {
    try {
      const r = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`);
      const json = await r.json();
      const batch: JikanEpisode[] = json?.data ?? [];
      all.push(...batch);
      onPage([...all]);
      if (!json?.pagination?.has_next_page) break;
      await new Promise((res) => setTimeout(res, 350));
    } catch { break; }
  }
}

const STATUS_MAP: Record<string, string> = {
  FINISHED: "FINISHED",
  RELEASING: "RELEASING",
  NOT_YET_RELEASED: "UPCOMING",
  CANCELLED: "CANCELLED",
  HIATUS: "ON HIATUS",
};

const WATCH_QUERY = `
query ($id: Int!) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    title { romaji english native }
    coverImage { extraLarge large }
    bannerImage
    episodes
    duration
    averageScore
    popularity
    status
    seasonYear
    startDate { year month day }
    countryOfOrigin
    format
    studios(isMain: true) { nodes { name } }
    nextAiringEpisode { episode airingAt }
    streamingEpisodes { title thumbnail url site }
    externalLinks { url site }
    relations {
      edges {
        relationType
        node {
          id
          title { romaji english }
          coverImage { large }
          format
          seasonYear
        }
      }
    }
  }
}`;

export default function WatchAniList() {
  const params = useParams<{ animeId: string; episode: string }>();
  const animeId = parseInt(params.animeId ?? "0");
  const currentEp = parseInt((params.episode ?? "1").replace(/^ep-?/i, ""));
  const [, navigate] = useLocation();

  // Read ?lang=DUB from query string so dubbed page can pre-select DUB mode
  const initialLang = (() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      return qs.get("lang") === "DUB" ? "DUB" : "SUB";
    } catch { return "SUB"; }
  })();

  const [anime, setAnime] = useState<AniMedia | null>(null);
  const [jikanEps, setJikanEps] = useState<JikanEpisode[]>([]);
  const [jikanLoading, setJikanLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<"SUB" | "DUB">(initialLang as "SUB" | "DUB");
  const [actualLang, setActualLang] = useState<"SUB" | "DUB" | null>(null);
  const [server, setServer] = useState<"GOGO" | "KOTO" | "ANIZONE" | "MIRURO" | "NEXUS" | "ANIMEONSEN" | "ANINEKO" | "SHIROKO" | "CUSTOM">("GOGO");
  const [anizoneSlug, setAnizoneSlug] = useState("");
  const [anizoneSlugInput, setAnizoneSlugInput] = useState("");
  const [anizoneSearching, setAnizoneSearching] = useState(false);
  const [anizoneSearchDone, setAnizoneSearchDone] = useState(false);
  const [anizoneSearchResults, setAnizoneSearchResults] = useState<{ slug: string; title: string; thumbnail: string }[]>([]);
  const [customUrl, setCustomUrl] = useState("");
  const [urlTemplate, setUrlTemplate] = useState("");
  const [templateInput, setTemplateInput] = useState("");
  const [gogoSlug, setGogoSlug] = useState("");
  const [gogoSlugInput, setGogoSlugInput] = useState("");
  const [gogoStreamError, setGogoStreamError] = useState(false);
  const [epSearch, setEpSearch] = useState("");
  const [epGridView, setEpGridView] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const epListRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const serverDropRef = useRef<HTMLDivElement>(null);
  const aoProxyPopupRef = useRef<Window | null>(null);
  const [cdnUrl, setCdnUrl] = useState<string | null>(null);
  const [gogoHlsUrl, setGogoHlsUrl] = useState<string | null>(null);
  const [cdnLoading, setCdnLoading] = useState(false);
  const [cdnNotFound, setCdnNotFound] = useState(false);
  const [kotoSlug, setKotoSlug] = useState("");
  const [kotoSlugInput, setKotoSlugInput] = useState("");
  const [kotoSearchResults, setKotoSearchResults] = useState<{ slug: string; title: string; thumbnail: string }[]>([]);
  const [kotoSearching, setKotoSearching] = useState(false);
  const [kotoSearchDone, setKotoSearchDone] = useState(false);
  const [kotoPlayerUrl, setKotoPlayerUrl] = useState<string | null>(null);
  const [kotoHlsUrl, setKotoHlsUrl] = useState<string | null>(null);
  const [kotoPlayerLoading, setKotoPlayerLoading] = useState(false);
  const [kotoPlayerError, setKotoPlayerError] = useState<string | null>(null);
  const [miruroIframeUrl, setMiruroIframeUrl] = useState<string | null>(null);
  const [miruroLoading, setMiruroLoading] = useState(false);
  const [miruroError, setMiruroError] = useState<string | null>(null);
  const [miruroUsingPopup, setMiruroUsingPopup] = useState(false);
  /** URL shown inside the player as an in-page fallback iframe when the inline proxy is unavailable */
  const [miruroInPageUrl, setMiruroInPageUrl] = useState<string | null>(null);
  /** Increments on every retry so the iframe key always changes, forcing a full remount
   *  and preventing the browser from serving a stale bfcache document. */
  const [miruroInPageNonce, setMiruroInPageNonce] = useState(0);
  /** True when the in-page proxy iframe received a CF/upstream-blocked error; shows inline retry CTA */
  const [miruroProxyBlocked, setMiruroProxyBlocked] = useState(false);
  /** Ref mirror of miruroInPageUrl — readable inside postMessage handlers without closure staleness */
  const miruroInPageUrlRef = useRef<string | null>(null);
  const [nexusIframeUrl, setNexusIframeUrl] = useState<string | null>(null);
  const [nexusLoading, setNexusLoading] = useState(false);
  const [nexusError, setNexusError] = useState<string | null>(null);
  const [animeonsenIframeUrl, setAnimeonsenIframeUrl] = useState<string | null>(null);
  const [animeonsenStreamUrl, setAnimeonsenStreamUrl] = useState<string | null>(null);
  const [animeonsenSubtitleUrl, setAnimeonsenSubtitleUrl] = useState<string | null>(null);
  const [animeonsenLoading, setAnimeonsenLoading] = useState(false);
  const [animeonsenError, setAnimeonsenError] = useState<string | null>(null);
  const [animeonsenContentId, setAnimeonsenContentId] = useState<string>("");
  const [aninekoSlug, setAninekoSlug] = useState("");
  const [aninekoSlugInput, setAninekoSlugInput] = useState("");
  const [aninekoIframeUrl, setAninekoIframeUrl] = useState<string | null>(null);
  const [aninekoLoading, setAninekoLoading] = useState(false);
  const [aninekoError, setAninekoError] = useState<string | null>(null);
  const [shirokoIframeUrl, setShirokoIframeUrl] = useState<string | null>(null);
  const [shirokoLoading, setShirokoLoading] = useState(false);
  const [shirokoError, setShirokoError] = useState<string | null>(null);
  const [shirokoProvider, setShirokoProvider] = useState("zen");
  const [serverDropOpen, setServerDropOpen] = useState(false);
  const [animeonsenIdInput, setAnimeonsenIdInput] = useState<string>("");
  // When true, a popup is open establishing Cloudflare clearance — show a connecting overlay
  const [animeonsenInitializing, setAnimeonsenInitializing] = useState(false);
  const [animeonsenCountdown, setAnimeonsenCountdown] = useState(0);
  const [aoCfReady, setAoCfReady] = useState(() => !!sessionStorage.getItem("ao_cf_ready"));
  // Incrementing this triggers the post-popup HLS retry useEffect
  const [aoHlsRetry, setAoHlsRetry] = useState(0);
  // Incrementing this forces the AnimeonSen iframe to remount after CF popup clears cookies
  const [aoIframeReloadKey, setAoIframeReloadKey] = useState(0);
  const [anizoneHlsUrl, setAnizoneHlsUrl] = useState<string | null>(null);
  const [anizoneSubtitles, setAnizoneSubtitles] = useState<{ src: string; label: string; srclang: string; isDefault: boolean }[]>([]);
  const [anizoneStreamLoading, setAnizoneStreamLoading] = useState(false);
  const [anizoneStreamError, setAnizoneStreamError] = useState<string | null>(null);
  const [gogoSearchResults, setGogoSearchResults] = useState<{ slug: string; title: string; thumbnail: string }[]>([]);
  const [gogoSearching, setGogoSearching] = useState(false);
  const [gogoSearchDone, setGogoSearchDone] = useState(false);
  const [videoState, setVideoState] = useState({ paused: true, time: 0, duration: 0, buffered: 0, volume: 1, muted: false });
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const bridgeLiveRef = useRef(false);
  const [bridgeLive, setBridgeLive] = useState(false);
  const userPickedRef = useRef(false);
  const raceCache = useRef<{
    gogo?: { cdnUrl: string; hlsUrl?: string | null; resolvedSlug?: string; pageTitle?: string | null; streamOk?: boolean } | null;
    koto?: { url?: string; hlsUrl?: string | null } | null;
    anizone?: { hlsUrl?: string; subtitles?: { src: string; label: string; srclang: string; isDefault: boolean }[] } | null;
    miruro?: { iframeUrl?: string } | null;
    nexus?: { iframeUrl?: string } | null;
    animeonsen?: { iframeUrl?: string; contentId?: string } | null;
    anineko?: { iframeUrl?: string; slug?: string } | null;
    shiroko?: { iframeUrl?: string } | null;
  }>({});
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoSwitchMsg, setAutoSwitchMsg] = useState<string | null>(null);
  const [gogoMaybeBroken, setGogoMaybeBroken] = useState(false);
  const [gogoMaybeCountdown, setGogoMaybeCountdown] = useState<number | null>(null);
  const [serverHealth, setServerHealth] = useState<{ GOGO: "unknown" | "checking" | "ok" | "fail"; KOTO: "unknown" | "checking" | "ok" | "fail"; ANIZONE: "unknown" | "checking" | "ok" | "fail"; MIRURO: "unknown" | "checking" | "ok" | "fail"; NEXUS: "unknown" | "checking" | "ok" | "fail"; ANIMEONSEN: "unknown" | "checking" | "ok" | "fail"; ANINEKO: "unknown" | "checking" | "ok" | "fail"; SHIROKO: "unknown" | "checking" | "ok" | "fail" }>({ GOGO: "unknown", KOTO: "unknown", ANIZONE: "unknown", MIRURO: "unknown", NEXUS: "unknown", ANIMEONSEN: "unknown", ANINEKO: "unknown", SHIROKO: "unknown" });
  const [sourcePageTitle, setSourcePageTitle] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ correct: boolean; confidence: "high" | "medium" | "low"; reason: string; extractedEpisode: number | null } | null>(null);
  const [newEpNotice, setNewEpNotice] = useState<number | null>(null);
  const prevNextAiringEpRef = useRef<number | null>(null);
  const [countdownSecs, setCountdownSecs] = useState<number | null>(null);
  const [liveViewers, setLiveViewers] = useState<number>(0);
  const [voteCounts, setVoteCounts] = useState({ skip: 0, timepass: 0, go_for_it: 0, perfection: 0 });
  const [myVote, setMyVote] = useState<string | null>(null);
  const [voteSubmitting, setVoteSubmitting] = useState(false);

  // ── Smart server suggestion system ──────────────────────────────────────
  const SERVER_META: Record<string, { label: string; colorCls: string; borderCls: string; hoverCls: string }> = {
    GOGO:       { label: "GogoAnimeS", colorCls: "text-orange-400", borderCls: "border-orange-400/70", hoverCls: "hover:bg-orange-400/10" },
    KOTO:       { label: "AniKoto",    colorCls: "text-teal-400",   borderCls: "border-teal-400/70",   hoverCls: "hover:bg-teal-400/10" },
    ANIZONE:    { label: "AniZone",    colorCls: "text-blue-400",   borderCls: "border-blue-400/70",   hoverCls: "hover:bg-blue-400/10" },
    MIRURO:     { label: "Miruro",     colorCls: "text-purple-400", borderCls: "border-purple-400/70", hoverCls: "hover:bg-purple-400/10" },
    ANIMEONSEN: { label: "AnimeonSen", colorCls: "text-green-400",  borderCls: "border-green-400/70",  hoverCls: "hover:bg-green-400/10" },
    ANINEKO:    { label: "AniNeko",    colorCls: "text-pink-400",   borderCls: "border-pink-400/70",   hoverCls: "hover:bg-pink-400/10" },
    SHIROKO:    { label: "Shiroko",    colorCls: "text-sky-400",    borderCls: "border-sky-400/70",    hoverCls: "hover:bg-sky-400/10" },
  };

  const suggestedServer = useMemo(() => {
    const priority = ["GOGO", "KOTO", "ANIZONE", "MIRURO", "ANINEKO", "ANIMEONSEN", "SHIROKO"] as const;
    return priority.find(s => s !== server && serverHealth[s] === "ok") ?? null;
  }, [server, serverHealth]);

  const switchToServer = useCallback((key: string) => {
    userPickedRef.current = true;
    setIframeLoaded(false);
    if (key === "GOGO") { setCdnNotFound(false); setGogoStreamError(false); bridgeLiveRef.current = false; setBridgeLive(false); }
    if (key === "ANIMEONSEN" && aoCfReady) setAnimeonsenInitializing(false);
    setServer(key as Parameters<typeof setServer>[0]);
  }, [aoCfReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Race winner tracking (fastest server in auto-detect) ─────────────────
  const [raceWinnerServer, setRaceWinnerServer] = useState<string | null>(null);

  // ── Auto-switch countdown when current server has an error ───────────────
  const [failCountdown, setFailCountdown] = useState<number | null>(null);

  // Close server dropdown on click outside
  useEffect(() => {
    if (!serverDropOpen) return;
    const handler = (e: MouseEvent) => {
      if (serverDropRef.current && !serverDropRef.current.contains(e.target as Node)) {
        setServerDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [serverDropOpen]);

  useEffect(() => {
    const hasError =
      (server === "ANINEKO" && !!aninekoError) ||
      (server === "KOTO" && !!kotoPlayerError) ||
      // Miruro in popup mode = intentional, not a failure — never auto-switch away.
      (server === "MIRURO" && !!miruroError && !miruroUsingPopup) ||
      (server === "ANIMEONSEN" && !!animeonsenError) ||
      (server === "SHIROKO" && !!shirokoError);

    if (!hasError || !suggestedServer) { setFailCountdown(null); return; }

    setFailCountdown(5);
    const iv = setInterval(() => setFailCountdown(n => (n !== null && n > 1 ? n - 1 : n)), 1000);
    const t = setTimeout(() => { switchToServer(suggestedServer); setFailCountdown(null); }, 5000);
    return () => { clearInterval(iv); clearTimeout(t); };
  }, [server, aninekoError, kotoPlayerError, miruroError, miruroUsingPopup, animeonsenError, suggestedServer]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Watch Together sync command for HlsPlayer ───────────────────────────
  const [wtSyncCmd, setWtSyncCmd] = useState<HlsSyncCommand | null>(null);
  const playerTimeRef = useRef<number>(0);

  const handleWtPlay = useCallback((time: number, fromSelf: boolean) => {
    if (fromSelf) return;
    setWtSyncCmd({ type: "play", time, nonce: crypto.randomUUID() });
  }, []);
  const handleWtPause = useCallback((time: number, fromSelf: boolean) => {
    if (fromSelf) return;
    setWtSyncCmd({ type: "pause", time, nonce: crypto.randomUUID() });
  }, []);
  const handleWtSeek = useCallback((time: number, fromSelf: boolean) => {
    if (fromSelf) return;
    setWtSyncCmd({ type: "seek", time, nonce: crypto.randomUUID() });
  }, []);
  const handleWtSync = useCallback((time: number, fromSelf: boolean) => {
    if (fromSelf) return;
    setWtSyncCmd({ type: "seek", time, nonce: crypto.randomUUID() });
  }, []);

  const { user: authUser } = useAuth();

  const wt = useWatchTogether({
    animeId,
    episode: currentEp,
    authUser,
    onPlay: handleWtPlay,
    onPause: handleWtPause,
    onSeek: handleWtSeek,
    onSync: handleWtSync,
  });

  const { toggle, isInList } = useWatchlist();
  const { markWatched, isWatched } = useWatchProgress();
  const { markProgress } = useContinueWatching();
  const saved = isInList(animeId);


  useEffect(() => {
    if (!animeId) return;
    setLoading(true);
    setJikanEps([]);
    setNewEpNotice(null);
    prevNextAiringEpRef.current = null;
    fetch(apiUrl("/api/anilist"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: WATCH_QUERY, variables: { id: animeId } }),
    })
      .then((r) => r.json())
      .then((json) => {
        const media: AniMedia | null = json?.data?.Media ?? null;
        if (media) {
          setAnime(media);
          prevNextAiringEpRef.current = media.nextAiringEpisode?.episode ?? null;
          if (media.idMal) {
            setJikanLoading(true);
            fetchJikanEpisodesProgressive(media.idMal, media.episodes ?? 0, setJikanEps)
              .finally(() => setJikanLoading(false));
          }
        }
      })
      .finally(() => setLoading(false));
  }, [animeId]);

  // ── Auto-update episode list for currently-airing shows ──────────────────
  // Polls AniList every 5 min. Also schedules a precise fetch right after the
  // next episode's broadcast time so users watching live see it immediately.
  useEffect(() => {
    if (!animeId || !anime || anime.status !== "RELEASING") return;

    async function pollForNewEp() {
      try {
        const r = await fetch(apiUrl("/api/anilist"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: WATCH_QUERY, variables: { id: animeId } }),
        });
        const json = await r.json();
        const media: AniMedia | null = json?.data?.Media ?? null;
        if (!media) return;

        const newNextEp = media.nextAiringEpisode?.episode ?? null;
        const oldNextEp = prevNextAiringEpRef.current;

        // nextAiringEpisode.episode incremented → a new episode just aired
        if (oldNextEp !== null && newNextEp !== null && newNextEp > oldNextEp) {
          const newlyAiredEp = newNextEp - 1;
          setNewEpNotice(newlyAiredEp);
          setAnime(media);
          prevNextAiringEpRef.current = newNextEp;
          // Refresh Jikan episode metadata for the new episode
          if (media.idMal) {
            setJikanLoading(true);
            fetchJikanEpisodesProgressive(media.idMal, media.episodes ?? 0, setJikanEps)
              .finally(() => setJikanLoading(false));
          }
        } else {
          // No new ep yet — still update nextAiring ref in case it changed
          prevNextAiringEpRef.current = newNextEp;
        }
      } catch { /* ignore network errors during background polling */ }
    }

    // Regular 5-minute poll
    const interval = setInterval(pollForNewEp, 5 * 60 * 1000);

    // Precise scheduled fetch: fire 2 min after the next episode's airing time
    let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
    if (anime.nextAiringEpisode?.airingAt) {
      const msUntilAir = (anime.nextAiringEpisode.airingAt * 1000 + 2 * 60 * 1000) - Date.now();
      if (msUntilAir > 0 && msUntilAir < 7 * 24 * 60 * 60 * 1000) {
        scheduledTimer = setTimeout(pollForNewEp, msUntilAir);
      }
    }

    return () => {
      clearInterval(interval);
      if (scheduledTimer) clearTimeout(scheduledTimer);
    };
  }, [animeId, anime?.status, anime?.nextAiringEpisode?.airingAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!anime || !currentEp || !animeId) return;
    const t = anime.title.english || anime.title.romaji || "";
    const c = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
    const b = anime.bannerImage || c;
    markWatched(currentEp, animeId, { animeTitle: t, coverImage: c, episodeNumber: currentEp });
    markProgress({
      animeId,
      episodeNumber: currentEp,
      title: t,
      cover: c,
      banner: b,
      totalEpisodes: anime.episodes ?? undefined,
    });
  }, [anime, currentEp, animeId, markWatched, markProgress]);

  useEffect(() => {
    setIframeLoaded(false);
    setVideoState({ paused: true, time: 0, duration: 0, buffered: 0, volume: 1, muted: false });
    setCdnUrl(null);
    setCdnLoading(false);
    setGogoStreamError(false);
    bridgeLiveRef.current = false;
    setBridgeLive(false);
    // Reset KOTO player state so stale errors don't persist across episodes/server switches
    setKotoPlayerUrl(null);
    setKotoHlsUrl(null);
    setKotoPlayerLoading(false);
    setKotoPlayerError(null);
    // Reset AniZone stream state
    setAnizoneHlsUrl(null);
    setAnizoneSubtitles([]);
    setAnizoneStreamLoading(false);
    setAnizoneStreamError(null);
    // Reset AnimeonSen state
    setAnimeonsenIframeUrl(null);
    setAnimeonsenStreamUrl(null);
    setAnimeonsenSubtitleUrl(null);
    setAnimeonsenLoading(false);
    setAnimeonsenError(null);
    // Reset AniNeko state
    setAninekoIframeUrl(null);
    setAninekoLoading(false);
    setAninekoError(null);
  }, [animeId, currentEp, lang, server]);

  // Reset auto-detect state whenever the episode or anime changes
  useEffect(() => {
    userPickedRef.current = false;
    raceCache.current = {};
    setAutoDetecting(false);
    setServerHealth({ GOGO: "unknown", KOTO: "unknown", ANIZONE: "unknown", MIRURO: "unknown", NEXUS: "unknown", ANIMEONSEN: "unknown", ANINEKO: "unknown", SHIROKO: "unknown" });
    setSourcePageTitle(null);
    setVerifyResult(null);
  }, [animeId, currentEp]);

  // Load saved GogoAnimes slug from localStorage; derive suggestion from title if none saved
  useEffect(() => {
    if (!animeId) return;
    const saved = localStorage.getItem(`na_gogo_${animeId}`) ?? "";
    setGogoSlug(saved);
    setGogoSlugInput(saved);
  }, [animeId]);

  // Load saved AniZone slug from localStorage; if none saved, try to derive from externalLinks
  useEffect(() => {
    if (!animeId) return;
    const saved = localStorage.getItem(`na_anizone3_${animeId}`);
    if (saved) {
      setAnizoneSlug(saved);
      setAnizoneSlugInput(saved);
      return;
    }
    // Try to extract slug from AniList externalLinks (anizone.to/anime/{slug})
    if (anime?.externalLinks) {
      const link = anime.externalLinks.find(
        (l) => l.url && l.url.includes("anizone.to/anime/")
      );
      if (link) {
        const slug = link.url.replace(/.*anizone\.to\/anime\//, "").replace(/[/?#].*/, "").trim();
        if (slug) {
          setAnizoneSlug(slug);
          setAnizoneSlugInput(slug);
          localStorage.setItem(`na_anizone3_${animeId}`, slug);
          return;
        }
      }
    }
    setAnizoneSlug("");
    setAnizoneSlugInput("");
  }, [animeId, anime]);

  // Reset AniZone search state when switching away or anime changes
  useEffect(() => {
    setAnizoneSearchResults([]);
    setAnizoneSearchDone(false);
    setAnizoneSearching(false);
  }, [server, animeId]);

  // Load saved URL template from localStorage when anime changes
  useEffect(() => {
    if (!animeId) return;
    const saved = localStorage.getItem(`na_template_${animeId}`) ?? "";
    setUrlTemplate(saved);
    setTemplateInput(saved);
  }, [animeId]);

  // When template or episode changes, auto-fill customUrl
  useEffect(() => {
    if (urlTemplate && urlTemplate.includes("{ep}")) {
      const filled = urlTemplate.replace(/\{ep\}/g, String(currentEp));
      setCustomUrl(filled);
      if (server !== "CUSTOM") setServer("CUSTOM");
    }
  }, [urlTemplate, currentEp]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveTemplate = () => {
    const t = templateInput.trim();
    setUrlTemplate(t);
    localStorage.setItem(`na_template_${animeId}`, t);
    if (t && t.includes("{ep}")) {
      const filled = t.replace(/\{ep\}/g, String(currentEp));
      setCustomUrl(filled);
      setServer("CUSTOM");
      setIframeLoaded(false);
    }
  };

  const clearTemplate = () => {
    setUrlTemplate("");
    setTemplateInput("");
    setCustomUrl("");
    localStorage.removeItem(`na_template_${animeId}`);
  };

  function deriveGogoSlug(rawTitle: string): string {
    return rawTitle
      .toLowerCase()
      // Remove special chars WITHOUT inserting a space — so "Re:ZERO" → "rezero" not "re zero"
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  const activateGogo = (slug?: string) => {
    const s = (slug ?? deriveGogoSlug(title)).trim();
    setGogoSlug(s);
    setGogoSlugInput(s);
    localStorage.setItem(`na_gogo_${animeId}`, s);
    setServer("GOGO");
    setIframeLoaded(false);
  };

  useEffect(() => {
    if (epListRef.current) {
      const active = epListRef.current.querySelector("[data-active='true']");
      active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [anime, currentEp]);

  const totalEps = anime?.episodes ?? 0;
  const title = anime?.title.english || anime?.title.romaji || "";
  const romajiTitle = anime?.title.romaji || "";

  // Once title is known, auto-activate GOGO with derived slug (or user-saved slug)
  useEffect(() => {
    if (!title || !animeId) return;
    const saved = localStorage.getItem(`na_gogo_${animeId}`) ?? "";
    const derived = deriveGogoSlug(title);
    // If saved slug matches what the OLD algorithm would have produced
    // (special chars → space → hyphen), replace it with the corrected derivation.
    const oldDerived = title
      .toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim()
      .replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const slug = !saved || saved === oldDerived ? derived : saved;
    setGogoSlug(slug);
    setGogoSlugInput(slug);
    localStorage.setItem(`na_gogo_${animeId}`, slug);
  }, [title, animeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detect: race all 3 servers; preferred server (saved from last visit) gets 800ms head start
  useEffect(() => {
    if (!title || !animeId || !anime) return;
    let cancelled = false;
    let won = false;
    setAutoDetecting(true);

    const preferred = localStorage.getItem(`na_preferred_${animeId}`) as "GOGO" | "KOTO" | "ANIZONE" | "MIRURO" | "NEXUS" | "ANIMEONSEN" | "ANINEKO" | "SHIROKO" | null;
    // Non-preferred servers wait this long before their fetch fires, giving preferred a head start
    const HEAD_START = preferred ? 800 : 0;

    setRaceWinnerServer(null);
    const tryWin = (srv: "GOGO" | "KOTO" | "ANIZONE" | "MIRURO" | "NEXUS" | "ANIMEONSEN" | "ANINEKO" | "SHIROKO") => {
      if (cancelled || won || userPickedRef.current) return;
      won = true;
      setRaceWinnerServer(srv);
      localStorage.setItem(`na_preferred_${animeId}`, srv);
      setAutoDetecting(false);
      setServer(srv);
      setIframeLoaded(false);
      bridgeLiveRef.current = false;
      setBridgeLive(false);
      setActualLang(null);
    };

    const baseGSlug = (localStorage.getItem(`na_gogo_${animeId}`) || deriveGogoSlug(title)).replace(/-dub$/i, "");
    const gSlug = lang === "DUB" ? baseGSlug + "-dub" : baseGSlug;
    const aSlug = localStorage.getItem(`na_anizone3_${animeId}`) || "";
    const malId = anime?.idMal ?? null;

    const timers: ReturnType<typeof setTimeout>[] = [];

    const schedule = (delay: number, fn: () => void) => {
      if (delay === 0) { fn(); return; }
      timers.push(setTimeout(() => { if (!cancelled && !won) fn(); }, delay));
    };

    // GOGO — try cdn-url (slug variants) first; if all fail, auto-resolve via resolve-slug (no user action)
    setServerHealth(h => ({ ...h, GOGO: "checking" }));
    schedule(preferred === "GOGO" ? 0 : HEAD_START, () => {
      const gogoTitle = title;
      const firstFetch = gSlug
        ? fetch(apiUrl(`/api/gogo/cdn-url?slug=${encodeURIComponent(gSlug)}&ep=${currentEp}`), { cache: "no-store" }).then(r => r.json())
        : Promise.resolve({});
      firstFetch
        .then((data: { cdnUrl?: string; hlsUrl?: string | null; resolvedSlug?: string; pageTitle?: string | null; streamOk?: boolean }) => {
          if (cancelled) return;
          if (data.cdnUrl) {
            raceCache.current.gogo = { cdnUrl: data.cdnUrl, hlsUrl: data.hlsUrl ?? null, resolvedSlug: data.resolvedSlug, pageTitle: data.pageTitle, streamOk: data.streamOk };
            if (data.streamOk === false) {
              // Stream is DMCA'd/broken — don't win the race; let other servers compete
              setServerHealth(h => ({ ...h, GOGO: "fail" }));
              setGogoStreamError(true);
            } else {
              setServerHealth(h => ({ ...h, GOGO: "ok" }));
              tryWin("GOGO");
            }
            return;
          }
          // Slug variants all failed — silently try resolve-slug (server searches GoGo by title)
          return fetch(apiUrl(`/api/gogo/resolve-slug?title=${encodeURIComponent(gogoTitle)}&ep=${currentEp}&dub=${lang === "DUB" ? "1" : "0"}`), { cache: "no-store" })
            .then(r => r.json())
            .then((resolveData: { cdnUrl?: string; hlsUrl?: string | null; resolvedSlug?: string; pageTitle?: string | null; streamOk?: boolean }) => {
              if (cancelled) return;
              if (resolveData.cdnUrl) {
                raceCache.current.gogo = { cdnUrl: resolveData.cdnUrl, hlsUrl: resolveData.hlsUrl ?? null, resolvedSlug: resolveData.resolvedSlug, pageTitle: resolveData.pageTitle, streamOk: resolveData.streamOk };
                if (resolveData.streamOk === false) {
                  setServerHealth(h => ({ ...h, GOGO: "fail" }));
                  setGogoStreamError(true);
                } else {
                  setServerHealth(h => ({ ...h, GOGO: "ok" }));
                  tryWin("GOGO");
                }
              } else {
                raceCache.current.gogo = null;
                setServerHealth(h => ({ ...h, GOGO: "fail" }));
              }
            });
        })
        .catch(() => { if (!cancelled) { raceCache.current.gogo = null; setServerHealth(h => ({ ...h, GOGO: "fail" })); } });
    });

    // KOTO
    if (malId) {
      setServerHealth(h => ({ ...h, KOTO: "checking" }));
      schedule(preferred === "KOTO" ? 0 : HEAD_START, () => {
        const params = new URLSearchParams({ ep: String(currentEp), malId: String(malId), ...(lang === "DUB" ? { preferDub: "1" } : {}) });
        fetch(apiUrl(`/api/koto/stream?${params}`))
          .then(r => r.json())
          .then((data: { url?: string; hlsUrl?: string | null; error?: string }) => {
            if (cancelled) return;
            if (data.url || data.hlsUrl) {
              raceCache.current.koto = data;
              setServerHealth(h => ({ ...h, KOTO: "ok" }));
              setActualLang(lang === "DUB" ? "DUB" : "SUB");
              tryWin("KOTO");
            } else {
              raceCache.current.koto = null;
              setServerHealth(h => ({ ...h, KOTO: "fail" }));
            }
          })
          .catch(() => { if (!cancelled) { raceCache.current.koto = null; setServerHealth(h => ({ ...h, KOTO: "fail" })); } });
      });
    } else {
      raceCache.current.koto = null;
      setServerHealth(h => ({ ...h, KOTO: "fail" }));
    }

    // ANIZONE
    if (aSlug) {
      setServerHealth(h => ({ ...h, ANIZONE: "checking" }));
      schedule(preferred === "ANIZONE" ? 0 : HEAD_START, () => {
        fetch(apiUrl(`/api/anizone/stream?slug=${encodeURIComponent(aSlug)}&ep=${currentEp}`))
          .then(r => r.json())
          .then((data: { hlsUrl?: string; subtitles?: { src: string; label: string; srclang: string; isDefault: boolean }[]; error?: string }) => {
            if (cancelled) return;
            if (data.hlsUrl) {
              raceCache.current.anizone = data;
              setServerHealth(h => ({ ...h, ANIZONE: "ok" }));
              setActualLang("SUB"); // AniZone is sub-only
              tryWin("ANIZONE");
            } else {
              raceCache.current.anizone = null;
              setServerHealth(h => ({ ...h, ANIZONE: "fail" }));
            }
          })
          .catch(() => { if (!cancelled) { raceCache.current.anizone = null; setServerHealth(h => ({ ...h, ANIZONE: "fail" })); } });
      });
    } else {
      raceCache.current.anizone = null;
      setServerHealth(h => ({ ...h, ANIZONE: "fail" }));
    }

    // MIRURO — constructs an iframe URL via miruro.to using the AniList ID + romaji slug
    setServerHealth(h => ({ ...h, MIRURO: "checking" }));
    schedule(preferred === "MIRURO" ? 0 : HEAD_START, () => {
      fetch(apiUrl(`/api/miruro/stream?anilistId=${animeId}&ep=${currentEp}&romajiTitle=${encodeURIComponent(romajiTitle)}&dub=${lang === "DUB" ? "1" : "0"}`))
        .then(r => r.json())
        .then((data: { iframeUrl?: string; error?: string }) => {
          if (cancelled) return;
          if (data.iframeUrl) {
            raceCache.current.miruro = { iframeUrl: data.iframeUrl };
            setServerHealth(h => ({ ...h, MIRURO: "ok" }));
            setActualLang(lang === "DUB" ? "DUB" : "SUB");
            tryWin("MIRURO");
          } else {
            raceCache.current.miruro = null;
            setServerHealth(h => ({ ...h, MIRURO: "fail" }));
          }
        })
        .catch(() => { if (!cancelled) { raceCache.current.miruro = null; setServerHealth(h => ({ ...h, MIRURO: "fail" })); } });
    });

    // ANIMEONSEN — search by title, return direct iframe URL (no X-Frame-Options)
    setServerHealth(h => ({ ...h, ANIMEONSEN: "checking" }));
    schedule(preferred === "ANIMEONSEN" ? 0 : HEAD_START, () => {
      const cachedContentId = localStorage.getItem(`na_animeonsen_${animeId}`) ?? "";
      const params = new URLSearchParams({ ep: String(currentEp), title });
      if (romajiTitle) params.set("romajiTitle", romajiTitle);
      if (cachedContentId) params.set("contentId", cachedContentId);
      fetch(apiUrl(`/api/animeonsen/stream?${params}`))
        .then(r => r.json())
        .then((data: { iframeUrl?: string; contentId?: string; error?: string }) => {
          if (cancelled) return;
          if (data.iframeUrl) {
            if (data.contentId) localStorage.setItem(`na_animeonsen_${animeId}`, data.contentId);
            raceCache.current.animeonsen = { iframeUrl: data.iframeUrl, contentId: data.contentId };
            setServerHealth(h => ({ ...h, ANIMEONSEN: "ok" }));
            tryWin("ANIMEONSEN");
          } else {
            raceCache.current.animeonsen = null;
            setServerHealth(h => ({ ...h, ANIMEONSEN: "fail" }));
          }
        })
        .catch(() => { if (!cancelled) { raceCache.current.animeonsen = null; setServerHealth(h => ({ ...h, ANIMEONSEN: "fail" })); } });
    });

    // ANINEKO — searches anineko.to by title, returns direct watch page URL (no X-Frame-Options)
    setServerHealth(h => ({ ...h, ANINEKO: "checking" }));
    const cachedAninekoSlug = localStorage.getItem(`na_anineko_${animeId}`) ?? "";
    schedule(preferred === "ANINEKO" ? 0 : HEAD_START, () => {
      const params = new URLSearchParams({ ep: String(currentEp), title });
      if (romajiTitle) params.set("romajiTitle", romajiTitle);
      if (cachedAninekoSlug) params.set("slug", cachedAninekoSlug);
      fetch(apiUrl(`/api/anineko/find?${params}`))
        .then(r => r.json())
        .then((data: { slug?: string; watchUrl?: string; embedUrl?: string; error?: string }) => {
          if (cancelled) return;
          const iframeUrl = data.embedUrl || data.watchUrl || null;
          if (iframeUrl) {
            if (data.slug) localStorage.setItem(`na_anineko_${animeId}`, data.slug);
            raceCache.current.anineko = { iframeUrl, slug: data.slug };
            setServerHealth(h => ({ ...h, ANINEKO: "ok" }));
            tryWin("ANINEKO");
          } else {
            raceCache.current.anineko = null;
            setServerHealth(h => ({ ...h, ANINEKO: "fail" }));
          }
        })
        .catch(() => { if (!cancelled) { raceCache.current.anineko = null; setServerHealth(h => ({ ...h, ANINEKO: "fail" })); } });
    });

    // SHIROKO — uses AniList ID directly, no slug resolution needed
    setServerHealth(h => ({ ...h, SHIROKO: "checking" }));
    schedule(preferred === "SHIROKO" ? 0 : HEAD_START + 200, () => {
      const params = new URLSearchParams({ anilistId: String(animeId), ep: String(currentEp), dub: String(lang === "DUB"), provider: "zen" });
      fetch(apiUrl(`/api/shiroko/stream?${params}`))
        .then(r => r.json())
        .then((data: { iframeUrl?: string; error?: string }) => {
          if (cancelled) return;
          if (data.iframeUrl) {
            raceCache.current.shiroko = { iframeUrl: data.iframeUrl };
            setServerHealth(h => ({ ...h, SHIROKO: "ok" }));
            tryWin("SHIROKO");
          } else {
            raceCache.current.shiroko = null;
            setServerHealth(h => ({ ...h, SHIROKO: "fail" }));
          }
        })
        .catch(() => { if (!cancelled) { raceCache.current.shiroko = null; setServerHealth(h => ({ ...h, SHIROKO: "fail" })); } });
    });

    // If nothing wins after 15s, stop the spinner and stay on current server
    const fallback = setTimeout(() => {
      if (!cancelled && !won && !userPickedRef.current) {
        won = true;
        setAutoDetecting(false);
      }
    }, 15000);

    return () => { cancelled = true; timers.forEach(clearTimeout); clearTimeout(fallback); };
  }, [animeId, currentEp, title, anime?.idMal, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // When GOGO server is selected, fetch the CDN player iframe URL from the gogoanimes.cv page
  // so we can embed only the CDN player (with our control bridge) instead of the full site.
  // Also extracts the direct HLS URL when available so we can drive our own player.
  useEffect(() => {
    if (server !== "GOGO" || !gogoSlug) { setCdnUrl(null); setGogoHlsUrl(null); setCdnLoading(false); setCdnNotFound(false); return; }
    // Use race-cached result if available (avoids double network call)
    const cached = raceCache.current.gogo;
    if (cached !== undefined) {
      if (cached?.cdnUrl) {
        if (cached.pageTitle) setSourcePageTitle(cached.pageTitle);
        if (cached.resolvedSlug && cached.resolvedSlug !== gogoSlug) {
          setGogoSlug(cached.resolvedSlug);
          setGogoSlugInput(cached.resolvedSlug);
          localStorage.setItem(`na_gogo_${animeId}`, cached.resolvedSlug);
        }
        raceCache.current.gogo = undefined;
        if (cached.streamOk === false) {
          setCdnUrl(cached.cdnUrl);
          setGogoHlsUrl(null);
          setCdnLoading(false);
          setCdnNotFound(false);
          setGogoStreamError(true);
        } else {
          setCdnUrl(cached.cdnUrl);
          setGogoHlsUrl(cached.hlsUrl ?? null);
          setCdnLoading(false);
          setCdnNotFound(false);
        }
        return;
      }
      raceCache.current.gogo = undefined;
    }
    setCdnUrl(null);
    setGogoHlsUrl(null);
    setCdnLoading(true);
    setCdnNotFound(false);
    setGogoSearchResults([]);
    setGogoSearchDone(false);
    // When DUB is selected, append -dub to the GoGo slug (GogoAnime hosts dubbed
    // content under "{slug}-dub" paths, e.g. demon-slayer-kimetsu-no-yaiba-dub)
    const effectiveGogoSlug = lang === "DUB"
      ? gogoSlug.replace(/-dub$/i, "") + "-dub"
      : gogoSlug.replace(/-dub$/i, "");
    let cancelled = false;
    fetch(apiUrl(`/api/gogo/cdn-url?slug=${encodeURIComponent(effectiveGogoSlug)}&ep=${currentEp}`), { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { cdnUrl?: string; hlsUrl?: string | null; resolvedSlug?: string; pageTitle?: string | null; streamOk?: boolean }) => {
        if (cancelled) return;

        // Save auto-resolved slug from variant probe (strip -dub before saving base slug)
        if (data.resolvedSlug && data.resolvedSlug !== effectiveGogoSlug) {
          const baseResolved = data.resolvedSlug.replace(/-dub$/i, "");
          setGogoSlug(baseResolved);
          setGogoSlugInput(baseResolved);
          localStorage.setItem(`na_gogo_${animeId}`, baseResolved);
        }

        if (data.cdnUrl) {
          setCdnUrl(data.cdnUrl);
          setGogoHlsUrl(data.hlsUrl ?? null);
          setActualLang(effectiveGogoSlug.includes("-dub") ? "DUB" : "SUB");
          if (data.pageTitle) setSourcePageTitle(data.pageTitle);
          if (data.streamOk === false) setGogoStreamError(true);
          return;
        }

        // All slug variants exhausted — automatically resolve server-side via title search+scoring.
        return fetch(apiUrl(`/api/gogo/resolve-slug?title=${encodeURIComponent(title)}&ep=${currentEp}&dub=${lang === "DUB" ? "1" : "0"}`), { cache: "no-store" })
          .then((r) => r.json())
          .then((resolveData: { cdnUrl?: string; hlsUrl?: string | null; resolvedSlug?: string; pageTitle?: string | null; streamOk?: boolean }) => {
            if (cancelled) return;
            if (resolveData.cdnUrl) {
              setCdnUrl(resolveData.cdnUrl);
              setGogoHlsUrl(resolveData.hlsUrl ?? null);
              setCdnNotFound(false);
              setActualLang((resolveData.resolvedSlug ?? effectiveGogoSlug).includes("-dub") ? "DUB" : "SUB");
              if (resolveData.pageTitle) setSourcePageTitle(resolveData.pageTitle);
              if (resolveData.resolvedSlug) {
                setGogoSlug(resolveData.resolvedSlug);
                setGogoSlugInput(resolveData.resolvedSlug);
                localStorage.setItem(`na_gogo_${animeId}`, resolveData.resolvedSlug);
              }
              if (resolveData.streamOk === false) setGogoStreamError(true);
            } else {
              setCdnNotFound(true);
            }
          })
          .catch(() => { if (!cancelled) setCdnNotFound(true); });
      })
      .catch(() => { if (!cancelled) setCdnNotFound(true); })
      .finally(() => { if (!cancelled) setCdnLoading(false); });
    return () => { cancelled = true; };
  }, [server, gogoSlug, currentEp, animeId, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset search results when switching away from GOGO or when anime changes
  useEffect(() => {
    setGogoSearchResults([]);
    setGogoSearchDone(false);
    setGogoSearching(false);
  }, [server, animeId]);

  function triggerGogoSearch(query: string) {
    if (!query) return;
    setGogoSearching(true);
    setGogoSearchDone(false);
    const q = query.replace(/\s*season\s*\d+/i, "").replace(/\s*\d+(st|nd|rd|th)\s*season/i, "").trim();
    fetch(apiUrl(`/api/gogo/search?q=${encodeURIComponent(q)}&limit=8`))
      .then((r) => r.json())
      .then((data: { results?: { slug: string; title: string; thumbnail: string }[] }) => {
        setGogoSearchResults(data.results ?? []);
      })
      .catch(() => { setGogoSearchResults([]); })
      .finally(() => { setGogoSearching(false); setGogoSearchDone(true); });
  }

  /**
   * Extract season number from a title string. Returns null if no season found.
   * Handles: "Season 4", "4th Season", "2nd Season", "3rd Season", etc.
   */
  function extractSeasonNumber(title: string): number | null {
    const m =
      title.match(/\bseason\s+(\d+)\b/i) ??
      title.match(/\b(\d+)(st|nd|rd|th)\s+season\b/i);
    if (m) return parseInt(m[1]);
    return null;
  }

  /**
   * Given a season number, return an array of text patterns that indicate
   * that season in a slug or title (e.g. season 2 → ["2nd", "second", "ii"]).
   */
  function seasonIndicators(n: number): string[] {
    const ordinals: Record<number, string> = {
      1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th",
      6: "6th", 7: "7th", 8: "8th", 9: "9th", 10: "10th",
    };
    const words: Record<number, string> = {
      1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth",
      6: "sixth", 7: "seventh", 8: "eighth", 9: "ninth", 10: "tenth",
    };
    const roman: Record<number, string> = {
      1: "i", 2: "ii", 3: "iii", 4: "iv", 5: "v",
      6: "vi", 7: "vii", 8: "viii", 9: "ix", 10: "x",
    };
    const indicators: string[] = [`season ${n}`, `season${n}`];
    if (ordinals[n]) indicators.push(ordinals[n]);
    if (words[n]) indicators.push(words[n]);
    if (roman[n]) indicators.push(roman[n]);
    return indicators;
  }

  /**
   * Score-based auto-slug selection.
   * Prefers results whose title closely matches the query.
   * Penalises spin-offs ("rewrite", "movie", "film", "special", etc.) that
   * appear in the result title but NOT in the original query.
   * When a season number is provided, strongly boosts matching season results
   * and penalises results that contain a different season number.
   * Returns null if no result is a confident enough match.
   */

  function reportBrokenStream() {
    if (reportSent) return;
    setReportSent(true);
    const payload = {
      animeId,
      animeTitle: title ?? "Unknown",
      episode: currentEp,
      server,
      lang,
      gogoSlug: gogoSlug || undefined,
      anizoneSlug: anizoneSlug || undefined,
      kotoSlug: kotoSlug || undefined,
      miruroUrl: miruroIframeUrl || undefined,
    };
    fetch(apiUrl("/api/report-stream"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
    setTimeout(() => setReportSent(false), 4000);
  }

  function bestAutoSlug(
    results: { slug: string; title: string }[],
    query: string,
    seasonNumber: number | null = null,
    seasonYear: number | null = null,
  ): string | null {
    if (results.length === 0) return null;
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
    const SPINOFF_WORDS = ["rewrite", "movie", "film", "special", "ova", "recap", "compilation", "live action", "live-action"];
    const qNorm = norm(query);

    const scored = results.map((r) => {
      const tNorm = norm(r.title);
      const slugNorm = r.slug.toLowerCase();
      let score = 0;

      if (tNorm === qNorm) {
        score = 1000;
      } else if (tNorm.startsWith(qNorm)) {
        score = 500 - (tNorm.length - qNorm.length) * 3;
      } else if (tNorm.includes(qNorm)) {
        score = 200 - (tNorm.length - qNorm.length) * 2;
      } else {
        // Partial word overlap — use space-split AND individual character normalization
        // so "Re:Zero" (→ "rezero" in tNorm) also matches "re" + "zero" from qNorm
        const splitWords = (s: string) =>
          s.toLowerCase().replace(/[^\w]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
        const qWords2 = splitWords(query);
        const tWords2 = new Set(splitWords(r.title));
        const overlap = qWords2.filter((w) => tWords2.has(w)).length;
        score = overlap > 0 ? (overlap / qWords2.length) * 80 - 50 : -999;
      }

      for (const word of SPINOFF_WORDS) {
        if (tNorm.includes(word) && !qNorm.includes(word)) {
          score -= 400;
        }
      }

      // Season year-based boost: AniZone appends "(YYYY)" to multi-season shows
      if (seasonYear != null) {
        const yearStr = String(seasonYear);
        const rawTitle = r.title.toLowerCase();
        if (rawTitle.includes(`(${yearStr})`) || rawTitle.includes(yearStr)) {
          score += 500;
        } else if (/\(\d{4}\)/.test(r.title)) {
          // Has a different year suffix
          score -= 300;
        }
      }

      // Season-aware scoring: boost correct season, penalise wrong ones
      if (seasonNumber !== null) {
        const correctIndicators = seasonIndicators(seasonNumber);
        const combined = `${tNorm} ${slugNorm}`;
        const hasCorrectSeason = correctIndicators.some((ind) => combined.includes(ind));

        if (hasCorrectSeason) {
          score += 400;
        } else {
          const otherSeasonMatch = combined.match(/\b(\d+)(st|nd|rd|th)\s*season\b|\bseason\s*(\d+)\b|\b(second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i);
          if (otherSeasonMatch) {
            score -= 350;
          } else if (seasonNumber > 1) {
            score -= 200;
          }
        }
      }

      return { ...r, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    return best.score >= 100 ? best.slug : null;
  }

  function triggerKotoSearch(query: string) {
    if (!query) return;
    setKotoSearching(true);
    setKotoSearchDone(false);
    const seasonNum = extractSeasonNumber(query);
    const seasonYear = anime?.seasonYear ?? null;
    const q = query.replace(/\s*season\s*\d+/i, "").replace(/\s*\d+(st|nd|rd|th)\s*season/i, "").trim();
    fetch(apiUrl(`/api/koto/search?q=${encodeURIComponent(q)}&limit=8`))
      .then((r) => r.json())
      .then((data: { results?: { slug: string; title: string; thumbnail: string }[] }) => {
        const results = data.results ?? [];
        setKotoSearchResults(results);
        if (results.length > 0 && !kotoSlug) {
          const slug = bestAutoSlug(results, q, seasonNum, seasonYear);
          if (slug) {
            setKotoSlug(slug);
            setKotoSlugInput(slug);
            localStorage.setItem(`na_koto3_${animeId}`, slug);
          }
        }
      })
      .catch(() => { setKotoSearchResults([]); })
      .finally(() => { setKotoSearching(false); setKotoSearchDone(true); });
  }

  function triggerAnizoneSearch(query: string, currentSlug?: string) {
    if (!query) return;
    setAnizoneSearching(true);
    setAnizoneSearchDone(false);
    const seasonNum = extractSeasonNumber(query);
    const seasonYear = anime?.seasonYear ?? null;
    const baseQ = query
      .replace(/\s*season\s*\d+/i, "")
      .replace(/\s*\d+(st|nd|rd|th)\s*season/i, "")
      .trim();

    // Build a cascade of progressively shorter search queries:
    // 1. Full base title, 2. Alphanumeric-only version, 3. First 3 words, 4. First word only
    const alphaQ = baseQ.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const words = alphaQ.split(/\s+/).filter((w) => w.length > 1);
    const candidateQueries = [
      baseQ,
      alphaQ !== baseQ ? alphaQ : null,
      words.length > 3 ? words.slice(0, 3).join(" ") : null,
      // For shows where the first "word" is a short prefix (e.g. "Re" from "Re:Zero"),
      // joining the first two words gives a workable search term ("rezero")
      words.length >= 2 && words[0].length <= 3 ? (words[0] + words[1]).toLowerCase() : null,
      words.length > 0 ? words[0] : null,
    ].filter((v, i, arr): v is string => !!v && arr.indexOf(v) === i);

    const tryQuery = (qIdx: number) => {
      if (qIdx >= candidateQueries.length) {
        setAnizoneSearchResults([]);
        setAnizoneSearching(false);
        setAnizoneSearchDone(true);
        return;
      }
      const q = candidateQueries[qIdx];
      fetch(apiUrl(`/api/anizone/search?q=${encodeURIComponent(q)}&limit=8`))
        .then((r) => r.json())
        .then((data: { results?: { slug: string; title: string; thumbnail: string }[] }) => {
          const results = data.results ?? [];
          if (results.length === 0 && qIdx < candidateQueries.length - 1) {
            tryQuery(qIdx + 1);
            return;
          }
          setAnizoneSearchResults(results);
          if (results.length > 0 && !currentSlug) {
            // If AniZone returns exactly 1 result, auto-select it unconditionally:
            // AniZone uses Japanese titles internally, so an English query that
            // matches exactly 1 entry is almost certainly the right anime — word-
            // overlap scoring will always fail for Japanese-titled shows.
            const slug =
              results.length === 1
                ? results[0].slug
                : bestAutoSlug(results, baseQ, seasonNum, seasonYear);
            if (slug) {
              setAnizoneSlug(slug);
              setAnizoneSlugInput(slug);
              localStorage.setItem(`na_anizone3_${animeId}`, slug);
            }
          }
          setAnizoneSearching(false);
          setAnizoneSearchDone(true);
        })
        .catch(() => { tryQuery(qIdx + 1); });
    };

    tryQuery(0);
  }

  // Pre-search KOTO as soon as the title is known (regardless of current server)
  // so the slug is ready instantly when KOTO is selected or is the default.
  useEffect(() => {
    if (!title || !animeId) return;
    const saved = localStorage.getItem(`na_koto3_${animeId}`) ?? "";
    if (saved) { setKotoSlug(saved); setKotoSlugInput(saved); return; }
    triggerKotoSearch(title);
  }, [title, animeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-search AniZone as soon as the title is known so the slug is ready
  // instantly when AniZone is selected, without requiring user interaction.
  useEffect(() => {
    if (!title || !animeId) return;
    const saved = localStorage.getItem(`na_anizone3_${animeId}`) ?? "";
    if (saved) { setAnizoneSlug(saved); setAnizoneSlugInput(saved); return; }
    // Also skip if slug already set from externalLinks
    if (anizoneSlug) return;
    triggerAnizoneSearch(title, "");
  }, [title, animeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When KOTO server is selected, ensure slug is loaded (handles server switch)
  useEffect(() => {
    if (server !== "KOTO" || !title) return;
    const saved = localStorage.getItem(`na_koto3_${animeId}`) ?? "";
    if (saved && !kotoSlug) { setKotoSlug(saved); setKotoSlugInput(saved); return; }
    if (!kotoSlug && !kotoSearching) triggerKotoSearch(title);
  }, [server, title, animeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset KOTO search state when switching away or anime changes
  useEffect(() => {
    setKotoSearchResults([]);
    setKotoSearchDone(false);
    setKotoSearching(false);
  }, [server, animeId]);

  // Fetch CDN player URL via mapper.nekostream.site (requires malId)
  useEffect(() => {
    if (server !== "KOTO") return;
    const slug = kotoSlug;
    // Wait for koto search to complete before giving up on the slug
    if (!slug && kotoSearching) return;
    // Wait for anime data to load — malId is required for the mapper (page scraping doesn't work)
    if (anime === null) return;
    const malId = anime?.idMal ?? null;
    if (!malId) {
      setKotoPlayerError("No MAL ID for this anime — KOTO unavailable");
      return;
    }
    // Use race-cached result if available
    const cached = raceCache.current.koto;
    if (cached !== undefined) {
      if (cached?.url || cached?.hlsUrl) {
        setKotoPlayerUrl(cached.url ?? null);
        setKotoHlsUrl(cached.hlsUrl ?? null);
        setKotoPlayerLoading(false);
        setKotoPlayerError(null);
        raceCache.current.koto = undefined;
        return;
      }
      raceCache.current.koto = undefined;
    }
    setKotoPlayerUrl(null);
    setKotoPlayerLoading(true);
    setKotoPlayerError(null);
    const params = new URLSearchParams({ ep: String(currentEp), malId: String(malId) });
    if (slug) params.set("slug", slug);
    if (lang === "DUB") params.set("preferDub", "1");
    let cancelled = false;
    fetch(apiUrl(`/api/koto/stream?${params}`))
      .then((r) => r.json())
      .then((data: { url?: string; hlsUrl?: string | null; error?: string; sourceTitle?: string | null; isDub?: boolean }) => {
        if (cancelled) return;
        if (data.url) {
          setKotoPlayerUrl(data.url);
          setKotoHlsUrl(data.hlsUrl ?? null);
          if (data.sourceTitle) setSourcePageTitle(data.sourceTitle);
          setActualLang(data.isDub ? "DUB" : "SUB");
        } else {
          setKotoPlayerError(data.error ?? "No player URL found");
        }
      })
      .catch((e: Error) => { if (!cancelled) setKotoPlayerError(e.message); })
      .finally(() => { if (!cancelled) setKotoPlayerLoading(false); });
    return () => { cancelled = true; };
  }, [server, kotoSlug, kotoSearching, anime, currentEp, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch HLS stream JSON for AniZone when server is selected with a valid slug
  useEffect(() => {
    if (server !== "ANIZONE" || !anizoneSlug) {
      setAnizoneHlsUrl(null);
      setAnizoneSubtitles([]);
      setAnizoneStreamError(null);
      return;
    }
    // Use race-cached result if available
    const cached = raceCache.current.anizone;
    if (cached !== undefined) {
      if (cached?.hlsUrl) {
        setAnizoneHlsUrl(cached.hlsUrl);
        setAnizoneSubtitles(cached.subtitles ?? []);
        setAnizoneStreamLoading(false);
        setAnizoneStreamError(null);
        raceCache.current.anizone = undefined;
        return;
      }
      raceCache.current.anizone = undefined;
    }
    let cancelled = false;
    setAnizoneHlsUrl(null);
    setAnizoneSubtitles([]);
    setAnizoneStreamLoading(true);
    setAnizoneStreamError(null);
    fetch(apiUrl(`/api/anizone/stream?slug=${encodeURIComponent(anizoneSlug)}&ep=${currentEp}`))
      .then((r) => r.json())
      .then((data: { hlsUrl?: string; subtitles?: { src: string; label: string; srclang: string; isDefault: boolean }[]; error?: string }) => {
        if (cancelled) return;
        if (data.hlsUrl) {
          setAnizoneHlsUrl(data.hlsUrl);
          setAnizoneSubtitles(data.subtitles ?? []);
        } else {
          setAnizoneStreamError(data.error ?? "No stream found for this episode");
        }
      })
      .catch((e: Error) => { if (!cancelled) setAnizoneStreamError(e.message); })
      .finally(() => { if (!cancelled) setAnizoneStreamLoading(false); });
    return () => { cancelled = true; };
  }, [server, anizoneSlug, currentEp]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Opens Miruro as an in-page iframe inside the player area (never a
   * separate OS window). Fetches the direct miruro URL, then routes it
   * through our proxy so it can render inline. If the lookup itself fails,
   * miruroInPageUrl stays null and the overlay below shows an inline error
   * with a retry button — no external window is ever opened.
   */
  const openMiruroDirect = useCallback(() => {
    setMiruroProxyBlocked(false);
    setMiruroUsingPopup(true);
    setMiruroInPageUrl("loading");
    // Bump nonce so the iframe key always changes on retry, forcing a full
    // React remount — this prevents the browser from serving a stale bfcache
    // document even if the URL's _t timestamp is somehow reused.
    setMiruroInPageNonce(n => n + 1);

    fetch(apiUrl(`/api/miruro/direct-url?anilistId=${animeId}&ep=${currentEp}&romajiTitle=${encodeURIComponent(romajiTitle)}&dub=${lang === "DUB" ? "1" : "0"}`))
      .then((r) => r.json())
      .then((data: { url?: string; error?: string }) => {
        if (data.url) {
          // Cache-bust with a nonce so every retry is guaranteed a genuinely
          // fresh iframe load — never a stale/stuck document left over from
          // a prior attempt (the src string always changes, forcing a remount).
          setMiruroInPageUrl(apiUrl(`/api/miruro/proxy?url=${encodeURIComponent(data.url)}&_t=${Date.now()}`));
        } else {
          setMiruroInPageUrl(null);
          setMiruroError(data.error ?? "Couldn't find a Miruro link for this episode.");
        }
      })
      .catch(() => {
        setMiruroInPageUrl(null);
        setMiruroError("Failed to reach the server. Please try again.");
      });
  }, [animeId, currentEp, romajiTitle, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Kept as the single entry point used by all "retry" buttons in the
   * overlay below. Always resolves in-page — never opens a separate browser
   * window/tab, so Miruro always stays embedded inside the app.
   */
  const openMiruroOsPopup = useCallback(() => {
    openMiruroDirect();
  }, [openMiruroDirect]);

  // Keep miruroInPageUrlRef in sync so postMessage handlers can read the current
  // value without needing it in their own closure/dependency array.
  useEffect(() => { miruroInPageUrlRef.current = miruroInPageUrl; }, [miruroInPageUrl]);

  // Fetch Miruro iframe URL when server is MIRURO
  useEffect(() => {
    if (server !== "MIRURO") {
      setMiruroIframeUrl(null);
      setMiruroError(null);
      setMiruroUsingPopup(false);
      setMiruroInPageUrl(null);
      setMiruroProxyBlocked(false);
      return;
    }
    const cached = raceCache.current.miruro;
    if (cached !== undefined) {
      if (cached?.iframeUrl) {
        setMiruroIframeUrl(cached.iframeUrl);
        setMiruroLoading(false);
        setMiruroError(null);
        setMiruroUsingPopup(false);
        setMiruroInPageUrl(null);
        setMiruroProxyBlocked(false);
        raceCache.current.miruro = undefined;
        return;
      }
      raceCache.current.miruro = undefined;
    }
    let cancelled = false;
    setMiruroIframeUrl(null);
    setMiruroLoading(true);
    setMiruroError(null);
    setMiruroUsingPopup(false);
    setMiruroInPageUrl(null);
    setMiruroProxyBlocked(false);
    fetch(apiUrl(`/api/miruro/stream?anilistId=${animeId}&ep=${currentEp}&romajiTitle=${encodeURIComponent(romajiTitle)}&dub=${lang === "DUB" ? "1" : "0"}`))
      .then((r) => r.json())
      .then((data: { iframeUrl?: string; error?: string }) => {
        if (cancelled) return;
        if (data.iframeUrl) {
          // Inline proxy works — dismiss in-page fallback and show inline iframe
          setMiruroIframeUrl(data.iframeUrl);
          setActualLang(lang === "DUB" ? "DUB" : "SUB");
          setMiruroInPageUrl(null);
          setMiruroProxyBlocked(false);
        } else {
          // Server-side proxy unavailable (relay blocked, CF issue, etc.).
          // Set miruroError so the auto-switch countdown triggers, and also
          // enable in-page fallback mode so the user can retry loading it inline.
          setMiruroError(data.error ?? "Miruro is currently unavailable. Please try another server.");
          setMiruroUsingPopup(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMiruroError("Miruro is currently unavailable. Please try another server.");
          setMiruroUsingPopup(true);
        }
      })
      .finally(() => { if (!cancelled) setMiruroLoading(false); });
    return () => { cancelled = true; };
  }, [server, animeId, currentEp, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved AniNeko slug from localStorage
  useEffect(() => {
    if (!animeId) return;
    const saved = localStorage.getItem(`na_anineko_${animeId}`) ?? "";
    setAninekoSlug(saved);
    setAninekoSlugInput(saved);
  }, [animeId]);

  // Fetch AniNeko iframe URL when server is ANINEKO
  useEffect(() => {
    if (server !== "ANINEKO") {
      setAninekoIframeUrl(null);
      setAninekoError(null);
      return;
    }
    const cached = raceCache.current.anineko;
    if (cached !== undefined) {
      if (cached?.iframeUrl) {
        if (cached.slug) { setAninekoSlug(cached.slug); setAninekoSlugInput(cached.slug); }
        setAninekoIframeUrl(cached.iframeUrl);
        setAninekoLoading(false);
        setAninekoError(null);
        raceCache.current.anineko = undefined;
        return;
      }
      raceCache.current.anineko = undefined;
    }
    let cancelled = false;
    setAninekoIframeUrl(null);
    setAninekoLoading(true);
    setAninekoError(null);
    const params = new URLSearchParams({ ep: String(currentEp), title });
    if (romajiTitle) params.set("romajiTitle", romajiTitle);
    const slug = localStorage.getItem(`na_anineko_${animeId}`) ?? aninekoSlug;
    if (slug) params.set("slug", slug);
    fetch(apiUrl(`/api/anineko/find?${params}`))
      .then(r => r.json())
      .then((data: { slug?: string; watchUrl?: string; embedUrl?: string; error?: string }) => {
        if (cancelled) return;
        if (data.embedUrl || data.watchUrl) {
          if (data.slug) {
            setAninekoSlug(data.slug);
            setAninekoSlugInput(data.slug);
            localStorage.setItem(`na_anineko_${animeId}`, data.slug);
          }
          setAninekoIframeUrl(data.embedUrl || data.watchUrl || null);
        } else {
          setAninekoError(data.error ?? "Anime not found on AniNeko");
        }
      })
      .catch((e: Error) => { if (!cancelled) setAninekoError(e.message); })
      .finally(() => { if (!cancelled) setAninekoLoading(false); });
    return () => { cancelled = true; };
  }, [server, animeId, currentEp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch Shiroko iframe URL when server is SHIROKO
  useEffect(() => {
    if (server !== "SHIROKO") {
      setShirokoIframeUrl(null);
      setShirokoError(null);
      return;
    }
    const cached = raceCache.current.shiroko;
    if (cached !== undefined) {
      if (cached?.iframeUrl) {
        setShirokoIframeUrl(cached.iframeUrl);
        setShirokoLoading(false);
        setShirokoError(null);
        raceCache.current.shiroko = undefined;
        return;
      }
      raceCache.current.shiroko = undefined;
    }
    let cancelled = false;
    setShirokoIframeUrl(null);
    setShirokoLoading(true);
    setShirokoError(null);
    const params = new URLSearchParams({ anilistId: String(animeId), ep: String(currentEp), dub: String(lang === "DUB"), provider: shirokoProvider });
    fetch(apiUrl(`/api/shiroko/stream?${params}`))
      .then(r => r.json())
      .then((data: { iframeUrl?: string; error?: string }) => {
        if (cancelled) return;
        if (data.iframeUrl) {
          setShirokoIframeUrl(data.iframeUrl);
        } else {
          setShirokoError(data.error ?? "Anime not found on Shiroko");
        }
      })
      .catch((e: Error) => { if (!cancelled) setShirokoError(e.message); })
      .finally(() => { if (!cancelled) setShirokoLoading(false); });
    return () => { cancelled = true; };
  }, [server, animeId, currentEp, shirokoProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved AnimeonSen content ID from localStorage
  useEffect(() => {
    if (!animeId) return;
    const saved = localStorage.getItem(`na_animeonsen_${animeId}`) ?? "";
    setAnimeonsenContentId(saved);
    setAnimeonsenIdInput(saved);
  }, [animeId]);

  /**
   * Server derives the ao.session Bearer token (www is not IP-blocked), browser
   * makes the actual api.animeonsen.xyz call (user's IP is not blocked either).
   * This is the working bypass for the CF iframe + server IP block problem.
   */
  const tryTokenExtract = useCallback(async (contentId: string, ep: number): Promise<string | null> => {
    try {
      const tr = await fetch(apiUrl(`/api/animeonsen/token?contentId=${encodeURIComponent(contentId)}`));
      if (!tr.ok) { console.warn("[AO] token endpoint failed:", tr.status); return null; }
      const { bearerToken } = await tr.json() as { bearerToken?: string };
      if (!bearerToken) { console.warn("[AO] no bearerToken in response"); return null; }
      console.log("[AO] got token, calling api.animeonsen.xyz…");
      type VideoData = { uri?: { streaming?: { hls?: string }; hls?: string }; hls?: string; stream?: { hls?: string }; data?: { uri?: { streaming?: { hls?: string } } } };
      const vr = await fetch(
        `https://api.animeonsen.xyz/v4/content/${contentId}/video/${ep}`,
        { headers: { Authorization: `Bearer ${bearerToken}`, Accept: "application/json" } }
      );
      console.log("[AO] api.animeonsen.xyz status:", vr.status);
      if (!vr.ok) return null;
      const d = await vr.json() as VideoData;
      const hls = d?.uri?.streaming?.hls ?? d?.uri?.hls ?? d?.hls ?? d?.stream?.hls ?? d?.data?.uri?.streaming?.hls ?? null;
      console.log("[AO] HLS URL:", hls, "| full keys:", Object.keys(d));
      return hls;
    } catch (e) {
      console.error("[AO] tryTokenExtract error:", e);
      return null;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Browser-side HLS extraction using its own CF session cookies — fallback after token extract */
  const tryBrowserExtract = useCallback(async (contentId: string, ep: number): Promise<string | null> => {
    try {
      const r = await fetch(
        `https://api.animeonsen.xyz/v4/content/${contentId}/video/${ep}`,
        { credentials: "include", headers: { Accept: "application/json" } }
      );
      if (!r.ok) return null;
      const d = await r.json();
      return d?.uri?.streaming?.hls || d?.uri?.hls || d?.hls || d?.stream?.hls || d?.data?.uri?.streaming?.hls || null;
    } catch {
      return null;
    }
  }, []);

  /**
   * Listen for HLS URL postMessage from the proxy-watch popup.
   * The popup runs the AnimeonSen player with our injected fetch interceptor.
   * When the player calls api.animeonsen.xyz and gets the video URL, the interceptor
   * postMessages it here → we set it as the native HLS stream URL.
   */
  useEffect(() => {
    const handler = (evt: MessageEvent) => {
      if (evt.data?.type === "ao_hls" && evt.data?.hls && server === "ANIMEONSEN") {
        console.log("[AO] received HLS from proxy iframe:", evt.data.hls);
        setAnimeonsenStreamUrl(evt.data.hls);
        sessionStorage.setItem("ao_cf_ready", "1");
        setAoCfReady(true);
      }
      // Miruro proxy iframe sends this when upstream is blocked (CF/IP block).
      // Only handle if there's an active in-page iframe (ref guard) to prevent
      // stale messages from old episodes/iframes from poisoning the current session.
      if (evt.data?.type === "miruro-proxy-error" && server === "MIRURO" && miruroInPageUrlRef.current !== null) {
        setMiruroIframeUrl(null);
        setMiruroLoading(false);
        setMiruroInPageUrl(null);
        miruroInPageUrlRef.current = null;
        setMiruroProxyBlocked(true);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [server]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Warn user before leaving / refreshing the watch page */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  /**
   * Post-popup HLS retry: after the CF popup closes the user's browser has CF clearance
   * for api.animeonsen.xyz. Retry token-extract (now with user's unblocked IP) then
   * browser-direct as fallback. On success, switches to native HLS player.
   */
  useEffect(() => {
    if (aoHlsRetry === 0 || !animeonsenContentId || server !== "ANIMEONSEN") return;
    let alive = true;
    tryTokenExtract(animeonsenContentId, currentEp)
      .then(hls => hls ?? tryBrowserExtract(animeonsenContentId, currentEp))
      .then(hls => { if (alive && hls) setAnimeonsenStreamUrl(hls); });
    return () => { alive = false; };
  }, [aoHlsRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch AnimeonSen stream URL when server is ANIMEONSEN
  useEffect(() => {
    if (server !== "ANIMEONSEN") {
      setAnimeonsenIframeUrl(null);
      setAnimeonsenStreamUrl(null);
      setAnimeonsenSubtitleUrl(null);
      setAnimeonsenError(null);
      return;
    }

    // Token-based extraction: server derives JWT from ao.session, browser calls the API.
    // Cascade: tryTokenExtract → tryBrowserExtract (fallback with user's own CF cookies).
    async function extractHls(contentId: string, ep: number): Promise<string | null> {
      return (await tryTokenExtract(contentId, ep)) ?? (await tryBrowserExtract(contentId, ep));
    }

    // Cancellation flag — shared across all async branches in this effect run.
    let cancelled = false;

    // Check raceCache first (set during auto-detect race)
    const cached = raceCache.current.animeonsen;
    if (cached !== undefined) {
      if (cached?.iframeUrl) {
        setAnimeonsenIframeUrl(cached.iframeUrl);
        if (cached.contentId) {
          setAnimeonsenContentId(cached.contentId);
          setAnimeonsenIdInput(cached.contentId);
          localStorage.setItem(`na_animeonsen_${animeId}`, cached.contentId);
        }
        setAnimeonsenLoading(false);
        setAnimeonsenError(null);
        raceCache.current.animeonsen = undefined;
        // Try HLS extraction in background (server-side first, browser fallback)
        if (cached.contentId) {
          extractHls(cached.contentId, currentEp).then(hls => {
            if (!cancelled && hls) setAnimeonsenStreamUrl(hls);
          });
        }
      } else {
        raceCache.current.animeonsen = undefined;
      }
    }

    const localContentId = animeonsenContentId || (localStorage.getItem(`na_animeonsen_${animeId}`) ?? "");

    if (localContentId) {
      setAnimeonsenIframeUrl(`https://www.animeonsen.xyz/watch/${localContentId}?episode=${currentEp}`);
      setAnimeonsenLoading(false);
      setAnimeonsenError(null);
      // Try server-side HLS extraction — plays natively without iframe if it works
      extractHls(localContentId, currentEp).then(hls => {
        if (!cancelled && hls) setAnimeonsenStreamUrl(hls);
      });
      return () => { cancelled = true; };
    }

    // No cached ID — search by title via our backend
    setAnimeonsenIframeUrl(null);
    setAnimeonsenStreamUrl(null);
    setAnimeonsenSubtitleUrl(null);
    setAnimeonsenLoading(true);
    setAnimeonsenError(null);
    const params = new URLSearchParams({ ep: String(currentEp), title });
    if (romajiTitle) params.set("romajiTitle", romajiTitle);
    fetch(apiUrl(`/api/animeonsen/stream?${params}`))
      .then((r) => r.json())
      .then(async (data: { iframeUrl?: string; contentId?: string; error?: string }) => {
        if (cancelled) return;
        if (data.iframeUrl && data.contentId) {
          setAnimeonsenContentId(data.contentId);
          setAnimeonsenIdInput(data.contentId);
          localStorage.setItem(`na_animeonsen_${animeId}`, data.contentId);
          setAnimeonsenIframeUrl(data.iframeUrl);
          // Try server-side HLS extraction (then browser fallback)
          const hls = await extractHls(data.contentId, currentEp);
          if (!cancelled && hls) setAnimeonsenStreamUrl(hls);
        } else {
          setAnimeonsenError(data.error ?? "Anime not found on AnimeonSen");
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setAnimeonsenError(e.message);
      })
      .finally(() => { if (!cancelled) setAnimeonsenLoading(false); });
    return () => { cancelled = true; };
  }, [server, animeId, currentEp]); // eslint-disable-line react-hooks/exhaustive-deps

  // AI episode verification: when a source page title arrives, verify the episode matches
  useEffect(() => {
    if (!sourcePageTitle || !title || !currentEp) return;
    const jikanEp = jikanEps?.find((e) => e.mal_id === currentEp);
    const body = {
      animeTitle: title,
      episodeNumber: currentEp,
      sourceTitle: sourcePageTitle,
      jikanEpTitle: jikanEp?.title ?? jikanEp?.title_romanji ?? null,
    };
    fetch(apiUrl("/api/verify-episode"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => setVerifyResult(data))
      .catch(() => {});
  }, [sourcePageTitle, title, currentEp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for video state updates from the proxied CDN player via postMessage bridge
  useEffect(() => {
    const handler = (evt: MessageEvent) => {
      if (evt.data?.type !== "na_video_state") return;
      // Only mark bridge alive when there's real content (duration>0 or time>0).
      // JWPlayer inserts a <video> element even for 410/"We're Sorry" streams —
      // the bridge fires immediately with duration=0. Real streams fire again
      // after loadedmetadata with a positive duration.
      if ((evt.data.duration ?? 0) > 0 || (evt.data.time ?? 0) > 0) {
        bridgeLiveRef.current = true;
        setBridgeLive(true);
      }
      setVideoState({
        paused: evt.data.paused ?? true,
        time: evt.data.time ?? 0,
        duration: evt.data.duration ?? 0,
        buffered: evt.data.buffered ?? 0,
        volume: evt.data.volume ?? 1,
        muted: evt.data.muted ?? false,
      });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // GoGo stream health is now checked server-side in probeCdnUrl (probeStreamUrl).
  // If the API returns streamOk=false, gogoStreamError is set immediately before
  // the iframe loads — no need for a client-side postMessage bridge timeout here.
  // (GoGo iframes load megaplay.buzz directly without a proxy, so the bridge
  //  script is never injected and bridgeLiveRef never fires for GoGo.)

  // Client-side GoGo broken-stream heuristic: megaplay.buzz 410 errors are
  // JS-rendered inside the iframe — undetectable via postMessage or server probe.
  // However, when a user clicks inside an iframe, window.blur fires in the parent.
  // A working GoGo player shows a play button the user will click within ~10s.
  // A broken stream shows an error page — the user won't click the player area.
  // If window.blur never fires within 10s of the iframe loading, flag as broken.
  useEffect(() => {
    if (server !== "GOGO" || !iframeLoaded || gogoStreamError || !cdnUrl) {
      setGogoMaybeBroken(false);
      setGogoMaybeCountdown(null);
      return;
    }
    setGogoMaybeBroken(false);
    setGogoMaybeCountdown(null);
    let interacted = false;
    const onBlur = () => { interacted = true; };
    window.addEventListener("blur", onBlur);
    const timer = setTimeout(() => {
      if (!interacted) setGogoMaybeBroken(true);
    }, 10000);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("blur", onBlur);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, iframeLoaded, gogoStreamError, cdnUrl, currentEp, lang]);

  // Countdown tick when gogoMaybeBroken — auto-switch after 7s
  useEffect(() => {
    if (!gogoMaybeBroken || server !== "GOGO") { setGogoMaybeCountdown(null); return; }
    setGogoMaybeCountdown(7);
    const iv = setInterval(() => {
      setGogoMaybeCountdown(prev => (prev !== null && prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(iv);
  }, [gogoMaybeBroken, server]);

  // When countdown hits 0, switch to best available server
  useEffect(() => {
    if (gogoMaybeCountdown !== 0 || server !== "GOGO") return;
    const fallbackOrder = ["KOTO", "ANIZONE", "MIRURO"] as const;
    const nextServer = fallbackOrder.find(s => serverHealth[s] === "ok") ?? "KOTO";
    setGogoMaybeBroken(false);
    setGogoMaybeCountdown(null);
    setGogoStreamError(false);
    setIframeLoaded(false);
    bridgeLiveRef.current = false;
    setBridgeLive(false);
    setServer(nextServer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gogoMaybeCountdown, server, serverHealth]);

  // Auto-switch: when GoGo stream error is detected, immediately switch to the
  // best available working server (KOTO → ANIZONE → MIRURO).
  useEffect(() => {
    if (!gogoStreamError || server !== "GOGO") return;
    const fallbackOrder = ["KOTO", "ANIZONE", "MIRURO"] as const;
    const nextServer = fallbackOrder.find(s => serverHealth[s] === "ok");
    if (!nextServer) return; // no working alternative yet — let user pick manually
    const label = nextServer === "KOTO" ? "AniKoto" : nextServer === "ANIZONE" ? "AniZone" : "Miruro";
    setAutoSwitchMsg(`GoGo unavailable — switching to ${label}…`);
    const timer = setTimeout(() => {
      setServer(nextServer);
      setGogoStreamError(false);
      setIframeLoaded(false);
      bridgeLiveRef.current = false;
      setBridgeLive(false);
      setAutoSwitchMsg(null);
    }, 600);
    return () => { clearTimeout(timer); setAutoSwitchMsg(null); };
  }, [gogoStreamError, server, serverHealth]); // eslint-disable-line react-hooks/exhaustive-deps

  // Send a command to the CDN player iframe via postMessage
  const sendCmd = (cmd: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(cmd, "*");
  };
  // Optimistic toggle: flip icon immediately, bridge will confirm via next state message
  const togglePlay = () => {
    setVideoState((prev) => ({ ...prev, paused: !prev.paused }));
    sendCmd({ na_cmd: "toggle" });
  };
  const skip10Back = () => sendCmd({ na_cmd: "skip", delta: -10 });
  const skip10Fwd = () => sendCmd({ na_cmd: "skip", delta: 10 });
  const seekTo = (time: number) => sendCmd({ na_cmd: "seek", time });

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const fmtCountdown = (secs: number): string => {
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };
  const resetControlsTimer = () => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  };
  const handleVolumeChange = (vol: number) => {
    setVideoState((prev) => ({ ...prev, volume: vol, muted: vol === 0 }));
    sendCmd({ na_cmd: "volume", vol });
  };
  const toggleMute = () => {
    setVideoState((prev) => ({ ...prev, muted: !prev.muted }));
    sendCmd({ na_cmd: "mute" });
  };
  const handleFullscreen = () => {
    const el = playerContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  };

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      switch (e.key) {
        case "t":
        case "T":
          e.preventDefault();
          setTheaterMode(prev => !prev);
          break;
        case "f":
        case "F":
          e.preventDefault();
          handleFullscreen();
          break;
        case "m":
        case "M":
          e.preventDefault();
          toggleMute();
          break;
        case " ":
          e.preventDefault();
          sendCmd({ na_cmd: "toggle" });
          break;
        case "ArrowLeft":
          if (currentEp > 1) {
            e.preventDefault();
            navigate(`/watch/al/${animeId}/${currentEp - 1}`);
          }
          break;
        case "ArrowRight":
          if (totalEps === 0 || currentEp < totalEps) {
            e.preventDefault();
            navigate(`/watch/al/${animeId}/${currentEp + 1}`);
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEp, animeId, totalEps, theaterMode]);

  // Periodic sync: query the bridge every 2 s so videoState stays accurate for ANY server
  useEffect(() => {
    if (!iframeLoaded) return;
    const id = setInterval(() => sendCmd({ na_cmd: "query" }), 2000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeLoaded]);

  // Always show controls when paused
  useEffect(() => {
    if (videoState.paused) {
      setShowControls(true);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    }
  }, [videoState.paused]);

  // Track fullscreen state changes
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Live countdown to next episode airing time
  useEffect(() => {
    if (!anime?.nextAiringEpisode) { setCountdownSecs(null); return; }
    const airingAt = anime.nextAiringEpisode.airingAt;
    const tick = () => {
      const s = airingAt - Math.floor(Date.now() / 1000);
      setCountdownSecs(s > 0 ? s : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [anime?.nextAiringEpisode?.airingAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real live viewer counter — heartbeat to backend every 25 s
  const viewerSessionId = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  );
  useEffect(() => {
    if (!animeId || !currentEp) return;
    const sid = viewerSessionId.current;

    const beat = async () => {
      try {
        const res = await fetch(apiUrl("/api/viewers/heartbeat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ animeId, episode: currentEp, sessionId: sid }),
        });
        if (res.ok) {
          const { count } = await res.json() as { count: number };
          setLiveViewers(count);
        }
      } catch {
        // network error — keep showing last known count
      }
    };

    beat();
    const interval = setInterval(beat, 25_000);

    return () => {
      clearInterval(interval);
      // Fire-and-forget leave
      navigator.sendBeacon?.(
        apiUrl("/api/viewers/leave"),
        new Blob(
          [JSON.stringify({ animeId, episode: currentEp, sessionId: sid })],
          { type: "application/json" }
        )
      );
    };
  }, [animeId, currentEp]);

  // Fetch episode vote counts + restore my saved vote
  useEffect(() => {
    if (!animeId || !currentEp) return;
    setVoteCounts({ skip: 0, timepass: 0, go_for_it: 0, perfection: 0 });
    const stored = localStorage.getItem(`na_vote_${animeId}_${currentEp}`);
    setMyVote(stored);
    fetch(apiUrl(`/api/votes/${animeId}/${currentEp}`))
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setVoteCounts(data as typeof voteCounts); })
      .catch(() => {});
  }, [animeId, currentEp]); // eslint-disable-line react-hooks/exhaustive-deps

  const native = anime?.title.native ?? "";
  const cover = anime?.coverImage.extraLarge || anime?.coverImage.large || "";
  const banner = anime?.bannerImage || cover;
  const studio = anime?.studios?.nodes[0]?.name ?? "";
  const status = STATUS_MAP[anime?.status ?? ""] ?? anime?.status ?? "";

  const streamEps = anime?.streamingEpisodes ?? [];

  const jikanMap = new Map<number, JikanEpisode>();
  for (const ep of jikanEps) jikanMap.set(ep.mal_id, ep);

  // Cap to aired episodes only: for airing shows use nextAiringEpisode.episode-1, for finished use totalEps
  const airedCount = anime?.nextAiringEpisode
    ? anime.nextAiringEpisode.episode - 1
    : totalEps > 0
    ? totalEps
    : jikanEps.filter((e) => e.aired && new Date(e.aired) <= new Date()).length || currentEp;
  const epCount = Math.max(airedCount, currentEp);
  const episodeNumbers = Array.from({ length: epCount }, (_, i) => i + 1);

  const filteredEps = episodeNumbers.filter((n) => {
    if (!epSearch.trim()) return true;
    const q = epSearch.trim().toLowerCase();
    const jep = jikanMap.get(n);
    const titleMatch = (jep?.title ?? "").toLowerCase().includes(q)
      || (jep?.title_romanji ?? "").toLowerCase().includes(q);
    return String(n).includes(q) || titleMatch;
  });

  const getEpThumb = (n: number) => {
    const s = streamEps[n - 1];
    return s?.thumbnail || cover;
  };

  const getEpTitle = (n: number): string => {
    const jep = jikanMap.get(n);
    if (jep?.title) return jep.title;
    if (jep?.title_romanji) return jep.title_romanji;
    const s = streamEps[n - 1];
    if (s?.title && s.title !== `Episode ${n}`) return s.title;
    return `Episode ${n}`;
  };

  const getEpAired = (n: number): string | null => {
    const jep = jikanMap.get(n);
    if (!jep?.aired) return null;
    try {
      return new Date(jep.aired).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    } catch { return null; }
  };

  const getEpScore = (n: number): number | null => jikanMap.get(n)?.score ?? null;
  const isEpFiller = (n: number): boolean => jikanMap.get(n)?.filler ?? false;
  const isEpRecap = (n: number): boolean => jikanMap.get(n)?.recap ?? false;

  const relatedAnime: RelationNode[] = (anime?.relations?.edges ?? [])
    .map((e) => ({ ...e.node, relationType: e.relationType }))
    .filter((n) => n.id !== animeId)
    .slice(0, 8);

  const startDateStr = anime?.startDate?.year
    ? [anime.startDate.year, anime.startDate.month, anime.startDate.day]
        .filter(Boolean).join(".")
    : null;

  const castVote = async (cat: string) => {
    if (voteSubmitting) return;
    setVoteSubmitting(true);
    // Optimistic update
    const prev = myVote;
    setMyVote(cat);
    setVoteCounts(c => {
      const next = { ...c };
      if (prev && prev in next) next[prev as keyof typeof next] = Math.max(0, next[prev as keyof typeof next] - 1);
      next[cat as keyof typeof next] = (next[cat as keyof typeof next] ?? 0) + 1;
      return next;
    });
    try {
      let voterKey = localStorage.getItem("na_voter_key");
      if (!voterKey) { voterKey = crypto.randomUUID(); localStorage.setItem("na_voter_key", voterKey); }
      const res = await fetch(apiUrl(`/api/votes/${animeId}/${currentEp}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: cat, voterKey }),
      });
      if (res.ok) {
        const data = await res.json() as typeof voteCounts;
        setVoteCounts(data);
        localStorage.setItem(`na_vote_${animeId}_${currentEp}`, cat);
      } else {
        // rollback
        setMyVote(prev);
        fetch(apiUrl(`/api/votes/${animeId}/${currentEp}`)).then(r => r.ok ? r.json() : null).then(d => { if (d) setVoteCounts(d as typeof voteCounts); }).catch(() => {});
      }
    } catch {
      setMyVote(prev);
    } finally {
      setVoteSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center">
        <div className="w-8 h-8 border border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white">
      {/* Mobile: back button bar */}
      <div className="flex md:hidden items-center gap-3 px-3 py-2.5 border-b border-white/[0.06]">
        <Link href={`/anime/al/${animeId}`}>
          <button className="p-1.5 -ml-1 text-white/60 active:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-white truncate leading-tight">{title}</p>
          <p className="text-[10px] text-white/35 font-mono">Episode {currentEp}{epCount > 0 ? ` / ${epCount}` : ""}</p>
        </div>
        {liveViewers > 0 && (
          <div className="flex items-center gap-1.5 px-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
            </span>
            <span className="text-[10px] font-mono text-white/45 tabular-nums whitespace-nowrap">
              {liveViewers.toLocaleString()} watching
            </span>
          </div>
        )}
        <button
          onClick={() => toggle(animeId)}
          className="p-2 text-white/40 active:text-white transition-colors"
        >
          {saved ? <BookmarkCheck className="w-5 h-5 text-white" /> : <Bookmark className="w-5 h-5" />}
        </button>
      </div>

      {/* Desktop: breadcrumb */}
      <div className="hidden md:flex items-center gap-2 px-4 py-2.5 border-b border-white/5 text-[11px] font-mono uppercase tracking-widest text-white/30">
        <Link href="/">
          <span className="hover:text-white transition-colors cursor-pointer">Home</span>
        </Link>
        <span>/</span>
        <Link href={`/anime/al/${animeId}`}>
          <span className="hover:text-white transition-colors cursor-pointer truncate max-w-[200px] inline-block align-bottom">{title}</span>
        </Link>
        <span>/</span>
        <span className="text-white/60">Episode {currentEp}</span>
      </div>

      {/* 3-column main layout */}
      <div className="flex flex-col xl:flex-row gap-0">

        {/* ── LEFT: Anime info panel ── */}
        <div className={`${theaterMode ? "hidden" : "hidden xl:flex"} flex-col w-56 shrink-0 border-r border-white/5 p-4 gap-4`}>
          <Link href={`/anime/al/${animeId}`}>
            <img
              src={cover}
              alt={title}
              className="w-full aspect-[3/4] object-cover hover:opacity-80 transition-opacity cursor-pointer"
            />
          </Link>
          <div>
            <h2 className="text-sm font-semibold text-white leading-snug line-clamp-2">{title}</h2>
            {native && <p className="text-[10px] text-white/30 mt-0.5 line-clamp-1">{native}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {totalEps > 0 && (
              <span className="text-[9px] font-mono border border-white/15 px-2 py-0.5 text-white/50 uppercase tracking-widest">
                {totalEps} EPS
              </span>
            )}
            {anime?.averageScore && (
              <span className="text-[9px] font-mono border border-white/15 px-2 py-0.5 text-white/50 uppercase tracking-widest">
                ★ {(anime.averageScore / 10).toFixed(1)}
              </span>
            )}
            {status && (
              <span className={`text-[9px] font-mono px-2 py-0.5 uppercase tracking-widest border ${
                status === "RELEASING" ? "border-green-500/40 text-green-400" : "border-white/15 text-white/50"
              }`}>
                {status}
              </span>
            )}
          </div>
          {(startDateStr || anime?.countryOfOrigin) && (
            <div className="text-[10px] text-white/30 space-y-1 font-mono">
              {startDateStr && <div><span className="text-white/20">Start:</span> {startDateStr}</div>}
              {anime?.countryOfOrigin && <div><span className="text-white/20">Country:</span> {anime.countryOfOrigin}</div>}
              {studio && <div><span className="text-white/20">Studio:</span> {studio}</div>}
            </div>
          )}

          {/* Next episode countdown — only for airing shows */}
          {anime?.nextAiringEpisode && countdownSecs !== null && countdownSecs > 0 && (
            <div className="border border-green-500/20 bg-green-500/5 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[9px] font-mono uppercase tracking-widest text-green-400/80">
                  Next — Ep {anime.nextAiringEpisode.episode}
                </span>
              </div>
              <div className="text-base font-mono font-bold text-white tracking-tight tabular-nums leading-none">
                {fmtCountdown(countdownSecs)}
              </div>
              <div className="text-[9px] font-mono text-white/25">
                {new Date(anime.nextAiringEpisode.airingAt * 1000).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── CENTER: Player + controls ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Player */}
          <div ref={playerContainerRef} className="w-full aspect-video bg-black relative overflow-hidden">
            {anime ? (
              <>
                {/* AniZone: use the native HLS player */}
                {server === "ANIZONE" && anizoneHlsUrl && (
                  <HlsPlayer
                    key={`anizone-${anizoneSlug}-${currentEp}`}
                    hlsUrl={anizoneHlsUrl}
                    subtitles={anizoneSubtitles}
                    preferDub={lang === "DUB"}
                    title={getEpTitle(currentEp) !== `Episode ${currentEp}` ? `${title} — Ep ${currentEp}: ${getEpTitle(currentEp)}` : `${title} — Episode ${currentEp}`}
                    progressKey={`al_${animeId}_${currentEp}`}
                    syncCommand={wtSyncCmd}
                    onPlayStateChange={(playing, time) => playing ? wt.sendPlay(time) : wt.sendPause(time)}
                    onSeek={(t) => wt.sendSeek(t)}
                    onBuffering={wt.sendBuffering}
                    onTimeUpdate={(t) => { playerTimeRef.current = t; }}
                  />
                )}

                {/* MIRURO iframe embed — loads miruro.to watch page directly (server-side CF session) */}
                {server === "MIRURO" && miruroIframeUrl && (
                  <iframe
                    ref={iframeRef}
                    key={`miruro-${animeId}-${currentEp}`}
                    src={miruroIframeUrl}
                    className="w-full h-full"
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    title={`${title} Episode ${currentEp}`}
                    onLoad={() => setTimeout(() => setIframeLoaded(true), 200)}
                  />
                )}

                {/* MIRURO in-page fallback — shown when CF session unavailable; user's browser loads proxy directly, embedded inline */}
                {server === "MIRURO" && !miruroIframeUrl && miruroInPageUrl && miruroInPageUrl !== "loading" && (
                  <div className="absolute inset-0 z-20" style={{ background: "#000" }}>
                    {/* Close / escape hatch strip */}
                    <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-1.5"
                      style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%)" }}>
                      <span className="text-[10px] font-mono text-purple-400/60 uppercase tracking-widest">miruro.bz</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openMiruroOsPopup()}
                          className="text-[10px] font-mono text-white/30 hover:text-white/60 uppercase tracking-widest transition-colors"
                          title="Reload"
                        >
                          ↻ Reload
                        </button>
                        <button
                          onClick={() => { setMiruroInPageUrl(null); setMiruroUsingPopup(false); }}
                          className="text-[10px] font-mono text-white/30 hover:text-white/60 transition-colors px-1"
                          title="Close"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <iframe
                      key={`miruro-inpage-${animeId}-${currentEp}-${miruroInPageNonce}`}
                      src={miruroInPageUrl}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                      allowFullScreen
                      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                      title={`${title} Episode ${currentEp} — Miruro`}
                    />
                  </div>
                )}

                {/* ANIMEONSEN — native HLS player once stream URL is extracted */}
                {server === "ANIMEONSEN" && animeonsenStreamUrl && (
                  <HlsPlayer
                    key={`animeonsen-${animeId}-${currentEp}`}
                    hlsUrl={animeonsenStreamUrl}
                    subtitles={[]}
                    title={getEpTitle(currentEp) !== `Episode ${currentEp}` ? `${title} — Ep ${currentEp}: ${getEpTitle(currentEp)}` : `${title} — Episode ${currentEp}`}
                    progressKey={`al_${animeId}_${currentEp}`}
                    onFatalError={() => setAnimeonsenStreamUrl(null)}
                    syncCommand={wtSyncCmd}
                    onPlayStateChange={(playing, time) => playing ? wt.sendPlay(time) : wt.sendPause(time)}
                    onSeek={(t) => wt.sendSeek(t)}
                    onBuffering={wt.sendBuffering}
                    onTimeUpdate={(t) => { playerTimeRef.current = t; }}
                  />
                )}

                {/* ANIMEONSEN — full-size visible iframe inside the player area.
                    The injected JS still intercepts the api.animeonsen.xyz /video/ call and
                    postMessages the HLS URL here; once received we swap to the native HlsPlayer. */}
                {server === "ANIMEONSEN" && !animeonsenStreamUrl && animeonsenContentId && (
                  <iframe
                    key={`ao-proxy-${animeonsenContentId}-${currentEp}-${aoIframeReloadKey}`}
                    src={apiUrl(`/api/animeonsen/proxy-watch?contentId=${encodeURIComponent(animeonsenContentId)}&ep=${currentEp}`)}
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    allowFullScreen
                    title="AnimeonSen Player"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "#000" }}
                  />
                )}

                {/* KOTO native HLS player (bypasses mewcdn cross-origin player) */}
                {server === "KOTO" && kotoHlsUrl && (
                  <HlsPlayer
                    key={`koto-${kotoSlug || "mal"}-${currentEp}`}
                    hlsUrl={kotoHlsUrl}
                    subtitles={[]}
                    title={getEpTitle(currentEp) !== `Episode ${currentEp}` ? `${title} — Ep ${currentEp}: ${getEpTitle(currentEp)}` : `${title} — Episode ${currentEp}`}
                    progressKey={`al_${animeId}_${currentEp}`}
                    onFatalError={() => setKotoHlsUrl(null)}
                    syncCommand={wtSyncCmd}
                    onPlayStateChange={(playing, time) => playing ? wt.sendPlay(time) : wt.sendPause(time)}
                    onSeek={(t) => wt.sendSeek(t)}
                    onBuffering={wt.sendBuffering}
                    onTimeUpdate={(t) => { playerTimeRef.current = t; }}
                  />
                )}

                {/* KOTO fallback iframe: player URL found but no extractable HLS.
                    vidtube.site has no X-Frame-Options so it embeds directly — the browser
                    handles cookies + same-origin API calls correctly without our proxy.
                    Other player URLs go through the proxy as before. */}
                {server === "KOTO" && kotoPlayerUrl && !kotoHlsUrl && (
                  <iframe
                    ref={iframeRef}
                    key={`koto-iframe-${kotoSlug || "mal"}-${currentEp}`}
                    src={
                      /^https?:\/\/vidtube\.site/i.test(kotoPlayerUrl)
                        ? kotoPlayerUrl
                        : `/api/proxy?url=${encodeURIComponent(kotoPlayerUrl)}&hideChrome=1`
                    }
                    className="w-full h-full"
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    title={`${title} Episode ${currentEp}`}
                    onLoad={() => setTimeout(() => setIframeLoaded(true), 200)}
                  />
                )}

                {/* GOGO native HLS — use our own player when the server extracted a direct stream */}
                {server === "GOGO" && gogoHlsUrl && !gogoStreamError && (
                  <HlsPlayer
                    key={`gogo-hls-${animeId}-${currentEp}-${gogoHlsUrl}`}
                    hlsUrl={gogoHlsUrl}
                    syncCommand={wtSyncCmd}
                    onPlayStateChange={(playing, time) => playing ? wt.sendPlay(time) : wt.sendPause(time)}
                    onSeek={(t) => wt.sendSeek(t)}
                    onBuffering={wt.sendBuffering}
                    onTimeUpdate={(t) => { playerTimeRef.current = t; }}
                  />
                )}

                {/* GOGO iframe fallback (when no HLS URL) / CUSTOM: embed via iframe */}
                {(server === "CUSTOM" || (server === "GOGO" && !gogoHlsUrl)) && (
                <iframe
                  ref={iframeRef}
                  key={`${animeId}-${anime.idMal ?? "al"}-${currentEp}-${lang}-${server}-${server === "CUSTOM" ? customUrl : ""}-${server === "GOGO" ? (cdnLoading ? "loading" : (cdnUrl ?? "fallback")) : ""}`}
                  src={(() => {
                    if (server === "CUSTOM") return customUrl ? `/api/proxy?url=${encodeURIComponent(customUrl)}` : "about:blank";
                    if (!gogoSlug) return "about:blank";
                    if (cdnLoading) return "about:blank";
                    if (cdnUrl) return cdnUrl;
                    return "about:blank";
                  })()}
                  className="w-full h-full"
                  style={{ opacity: iframeLoaded ? 1 : 0, transition: "opacity 0.5s ease" }}
                  allowFullScreen
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                  referrerPolicy="no-referrer"
                  title={`${title} Episode ${currentEp}`}
                  onLoad={() => {
                    if (server === "GOGO" && cdnLoading) return;
                    setTimeout(() => {
                      setIframeLoaded(true);
                      if (server === "GOGO") setTimeout(() => sendCmd({ na_cmd: "query" }), 600);
                    }, 200);
                  }}
                />
                )}


                {/* AniZone loading/error overlay (HlsPlayer handles its own state once loaded) */}
                {server === "ANIZONE" && (anizoneStreamLoading || anizoneStreamError || !anizoneHlsUrl) && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.92)" }}>
                    {banner && <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-10 scale-110 blur-sm" />}
                    <div className="relative z-10 flex flex-col items-center gap-4">
                      {anizoneStreamError ? (
                        <div className="text-center space-y-2">
                          <p className="text-white/70 text-sm font-semibold tracking-wide">AniZone stream not found</p>
                          <p className="text-white/30 text-[11px] font-mono">{anizoneStreamError}</p>
                          <p className="text-white/20 text-[10px] font-mono max-w-[260px] text-center">Try a different slug or check the ANIZONE panel below.</p>
                        </div>
                      ) : (
                        <>
                          <div className="relative w-14 h-14">
                            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                            <div className="absolute inset-0 rounded-full border-2 border-t-blue-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                          </div>
                          <p className="text-white text-sm font-semibold tracking-wide">
                            {anizoneSlug ? "Fetching AniZone stream…" : "Set a slug in the ANIZONE panel below."}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* ANIMEONSEN loading / error overlay */}
                {server === "ANIMEONSEN" && !animeonsenContentId && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.92)" }}>
                    {banner && <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-10 scale-110 blur-sm" />}
                    <div className="relative z-10 flex flex-col items-center gap-4">
                      {animeonsenError ? (
                        <div className="text-center space-y-3">
                          <div className="w-11 h-11 border border-yellow-400/40 bg-yellow-400/5 flex items-center justify-center mx-auto rounded-sm">
                            <span className="text-yellow-400 text-xl">🔧</span>
                          </div>
                          <p className="text-white/80 text-sm font-semibold tracking-wide">AnimeonSen Under Maintenance</p>
                          <p className="text-white/35 text-[11px] font-mono max-w-[260px] text-center leading-relaxed">This server isn't available right now.<br/>Please try another server below.</p>
                          {suggestedServer && SERVER_META[suggestedServer] && (
                            <>
                              {failCountdown !== null && (
                                <p className="text-yellow-400/80 text-[11px] font-mono animate-pulse">
                                  Auto-switching to {SERVER_META[suggestedServer].label} in {failCountdown}s…
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  onClick={() => switchToServer(suggestedServer)}
                                  className={`inline-flex items-center gap-2 text-[11px] font-mono font-bold px-5 py-2.5 border ${SERVER_META[suggestedServer].borderCls} ${SERVER_META[suggestedServer].colorCls} ${SERVER_META[suggestedServer].hoverCls} transition-all uppercase tracking-widest`}
                                >
                                  <Play className="w-3 h-3 fill-current" /> Try {SERVER_META[suggestedServer].label}
                                </button>
                                {failCountdown !== null && (
                                  <button
                                    onClick={() => setFailCountdown(null)}
                                    className="text-[10px] font-mono px-3 py-2.5 border border-white/15 text-white/35 hover:border-white/40 hover:text-white/60 transition-colors uppercase tracking-widest"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="relative w-14 h-14">
                            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                            <div className="absolute inset-0 rounded-full border-2 border-t-green-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                            <div className="absolute inset-2 rounded-full border border-white/20 border-t-green-400/60 animate-spin" style={{ animationDuration: "0.6s", animationDirection: "reverse" }} />
                          </div>
                          <p className="text-white/70 text-sm font-semibold tracking-wide">Searching AnimeonSen…</p>
                        </>
                      )}
                      <p className="text-white/20 text-[11px] font-mono uppercase tracking-widest">
                        Episode {currentEp} · {lang}
                      </p>
                    </div>
                  </div>
                )}

                {/* MIRURO loading / popup / error overlay — hidden when in-page iframe is active */}
                {server === "MIRURO" && !miruroIframeUrl && (miruroProxyBlocked || !(miruroInPageUrl && miruroInPageUrl !== "loading")) && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.92)" }}>
                    {banner && <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-10 scale-110 blur-sm" />}
                    <div className="relative z-10 flex flex-col items-center gap-4">
                      {miruroProxyBlocked ? (
                        /* Server IP is CF/upstream blocked — retry loads it inline via the visitor's own browser */
                        <div className="text-center space-y-3">
                          <div className="w-11 h-11 border border-red-400/30 bg-red-400/5 flex items-center justify-center mx-auto rounded-sm">
                            <span className="text-red-400 text-xl">⚡</span>
                          </div>
                          <p className="text-white/80 text-sm font-semibold tracking-wide">Server IP Blocked</p>
                          <p className="text-white/40 text-[11px] font-mono max-w-[280px] text-center leading-relaxed">
                            Miruro is blocking our server's IP address.<br/>
                            Your browser can still reach it — click below to load it here.
                          </p>
                          <button
                            onClick={openMiruroOsPopup}
                            className="inline-flex items-center gap-2 text-[11px] font-mono font-bold px-5 py-2.5 border border-purple-400/70 text-purple-400 hover:bg-purple-400/10 transition-all uppercase tracking-widest"
                          >
                            <span>↻</span> Retry
                          </button>
                          {suggestedServer && SERVER_META[suggestedServer] && (
                            <div className="flex items-center gap-2 mt-1">
                              <button
                                onClick={() => switchToServer(suggestedServer)}
                                className={`inline-flex items-center gap-2 text-[11px] font-mono font-bold px-5 py-2.5 border ${SERVER_META[suggestedServer].borderCls} ${SERVER_META[suggestedServer].colorCls} ${SERVER_META[suggestedServer].hoverCls} transition-all uppercase tracking-widest`}
                              >
                                <Play className="w-3 h-3 fill-current" /> Try {SERVER_META[suggestedServer].label}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : miruroUsingPopup && miruroInPageUrl === "loading" ? (
                        /* Fetching miruro URL — show spinner while the in-page player is preparing */
                        <>
                          <div className="relative w-14 h-14">
                            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                            <div className="absolute inset-0 rounded-full border-2 border-t-purple-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                            <div className="absolute inset-2 rounded-full border border-white/20 border-t-purple-400/60 animate-spin" style={{ animationDuration: "0.6s", animationDirection: "reverse" }} />
                          </div>
                          <p className="text-white/70 text-sm font-semibold tracking-wide">Opening Miruro…</p>
                        </>
                      ) : miruroUsingPopup && !miruroInPageUrl ? (
                        /* In-page player failed to load — offer an inline retry */
                        <div className="text-center space-y-3">
                          <div className="w-11 h-11 border border-purple-400/30 bg-purple-400/5 flex items-center justify-center mx-auto rounded-sm">
                            <Play className="w-5 h-5 text-purple-400 fill-current" />
                          </div>
                          <p className="text-white/80 text-sm font-semibold tracking-wide">Couldn't load Miruro</p>
                          <p className="text-white/35 text-[11px] font-mono max-w-[260px] text-center leading-relaxed">
                            {miruroError ?? "Something went wrong loading the player."}<br/>Try again below.
                          </p>
                          <button
                            onClick={openMiruroOsPopup}
                            className="inline-flex items-center gap-2 text-[11px] font-mono font-bold px-5 py-2.5 border border-purple-400/70 text-purple-400 hover:bg-purple-400/10 transition-all uppercase tracking-widest"
                          >
                            <Play className="w-3 h-3 fill-current" /> Retry
                          </button>
                          {suggestedServer && SERVER_META[suggestedServer] && (
                            <div className="flex items-center gap-2 mt-1">
                              <button
                                onClick={() => switchToServer(suggestedServer)}
                                className={`inline-flex items-center gap-2 text-[11px] font-mono font-bold px-5 py-2.5 border ${SERVER_META[suggestedServer].borderCls} ${SERVER_META[suggestedServer].colorCls} ${SERVER_META[suggestedServer].hoverCls} transition-all uppercase tracking-widest`}
                              >
                                <Play className="w-3 h-3 fill-current" /> Try {SERVER_META[suggestedServer].label}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : miruroError ? (
                        <div className="text-center space-y-3">
                          <div className="w-11 h-11 border border-yellow-400/40 bg-yellow-400/5 flex items-center justify-center mx-auto rounded-sm">
                            <span className="text-yellow-400 text-xl">🔧</span>
                          </div>
                          <p className="text-white/80 text-sm font-semibold tracking-wide">Miruro Under Maintenance</p>
                          <p className="text-white/35 text-[11px] font-mono max-w-[260px] text-center leading-relaxed">Our server can't reach Miruro right now,<br/>but your browser can. Try loading it here.</p>
                          <button
                            onClick={openMiruroOsPopup}
                            className="inline-flex items-center gap-2 text-[11px] font-mono font-bold px-5 py-2.5 border border-purple-400/70 text-purple-400 hover:bg-purple-400/10 transition-all uppercase tracking-widest"
                          >
                            <Play className="w-3 h-3 fill-current" /> Load Miruro
                          </button>
                          {suggestedServer && SERVER_META[suggestedServer] && (
                            <>
                              {failCountdown !== null && (
                                <p className="text-yellow-400/80 text-[11px] font-mono animate-pulse">
                                  Auto-switching to {SERVER_META[suggestedServer].label} in {failCountdown}s…
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  onClick={() => switchToServer(suggestedServer)}
                                  className={`inline-flex items-center gap-2 text-[11px] font-mono font-bold px-5 py-2.5 border ${SERVER_META[suggestedServer].borderCls} ${SERVER_META[suggestedServer].colorCls} ${SERVER_META[suggestedServer].hoverCls} transition-all uppercase tracking-widest`}
                                >
                                  <Play className="w-3 h-3 fill-current" /> Try {SERVER_META[suggestedServer].label}
                                </button>
                                {failCountdown !== null && (
                                  <button
                                    onClick={() => setFailCountdown(null)}
                                    className="text-[10px] font-mono px-3 py-2.5 border border-white/15 text-white/35 hover:border-white/40 hover:text-white/60 transition-colors uppercase tracking-widest"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="relative w-14 h-14">
                            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                            <div className="absolute inset-0 rounded-full border-2 border-t-purple-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                            <div className="absolute inset-2 rounded-full border border-white/20 border-t-purple-400/60 animate-spin" style={{ animationDuration: "0.6s", animationDirection: "reverse" }} />
                          </div>
                          <p className="text-white/70 text-sm font-semibold tracking-wide">Checking Miruro…</p>
                        </>
                      )}
                      <p className="text-white/20 text-[11px] font-mono uppercase tracking-widest">
                        Episode {currentEp} · {lang}
                      </p>
                    </div>
                  </div>
                )}

                {/* ANINEKO — embed direct watch page (SSR PHP, no X-Frame-Options on watch pages) */}
                {server === "ANINEKO" && aninekoIframeUrl && (
                  <iframe
                    ref={iframeRef}
                    key={`anineko-${animeId}-${currentEp}`}
                    src={aninekoIframeUrl}
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    allowFullScreen
                    title="AniNeko Player"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "#000" }}
                    onLoad={() => setTimeout(() => setIframeLoaded(true), 300)}
                  />
                )}

                {/* ANINEKO loading / error overlay */}
                {server === "ANINEKO" && !aninekoIframeUrl && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.92)" }}>
                    {banner && <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-10 scale-110 blur-sm" />}
                    <div className="relative z-10 flex flex-col items-center gap-4">
                      {aninekoError ? (
                        <div className="text-center space-y-3">
                          <div className="w-11 h-11 border border-yellow-400/40 bg-yellow-400/5 flex items-center justify-center mx-auto rounded-sm">
                            <span className="text-yellow-400 text-xl">🔧</span>
                          </div>
                          <p className="text-white/80 text-sm font-semibold tracking-wide">AniNeko Under Maintenance</p>
                          <p className="text-white/35 text-[11px] font-mono max-w-[260px] text-center leading-relaxed">This server isn't available right now.<br/>Please try another server below.</p>
                          {suggestedServer && SERVER_META[suggestedServer] && (
                            <>
                              {failCountdown !== null && (
                                <p className="text-yellow-400/80 text-[11px] font-mono animate-pulse">
                                  Auto-switching to {SERVER_META[suggestedServer].label} in {failCountdown}s…
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  onClick={() => switchToServer(suggestedServer)}
                                  className={`inline-flex items-center gap-2 text-[11px] font-mono font-bold px-5 py-2.5 border ${SERVER_META[suggestedServer].borderCls} ${SERVER_META[suggestedServer].colorCls} ${SERVER_META[suggestedServer].hoverCls} transition-all uppercase tracking-widest`}
                                >
                                  <Play className="w-3 h-3 fill-current" /> Try {SERVER_META[suggestedServer].label}
                                </button>
                                {failCountdown !== null && (
                                  <button
                                    onClick={() => setFailCountdown(null)}
                                    className="text-[10px] font-mono px-3 py-2.5 border border-white/15 text-white/35 hover:border-white/40 hover:text-white/60 transition-colors uppercase tracking-widest"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="relative w-14 h-14">
                            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                            <div className="absolute inset-0 rounded-full border-2 border-t-pink-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                            <div className="absolute inset-2 rounded-full border border-white/20 border-t-pink-400/60 animate-spin" style={{ animationDuration: "0.6s", animationDirection: "reverse" }} />
                          </div>
                          <p className="text-white/70 text-sm font-semibold tracking-wide">Searching AniNeko…</p>
                        </>
                      )}
                      <p className="text-white/20 text-[11px] font-mono uppercase tracking-widest">
                        Episode {currentEp} · {lang}
                      </p>
                    </div>
                  </div>
                )}

                {/* SHIROKO — proxy-embedded shiroko.co player */}
                {server === "SHIROKO" && shirokoIframeUrl && (
                  <iframe
                    ref={iframeRef}
                    key={`shiroko-${animeId}-${currentEp}-${shirokoProvider}`}
                    src={shirokoIframeUrl}
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    allowFullScreen
                    title="Shiroko Player"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "#000" }}
                    onLoad={() => setTimeout(() => setIframeLoaded(true), 300)}
                  />
                )}

                {/* SHIROKO loading / error overlay */}
                {server === "SHIROKO" && !shirokoIframeUrl && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.92)" }}>
                    {banner && <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-10 scale-110 blur-sm" />}
                    <div className="relative z-10 flex flex-col items-center gap-4">
                      {shirokoError ? (
                        <div className="text-center space-y-3">
                          <div className="w-11 h-11 border border-yellow-400/40 bg-yellow-400/5 flex items-center justify-center mx-auto rounded-sm">
                            <span className="text-yellow-400 text-xl">🔧</span>
                          </div>
                          <p className="text-white/80 text-sm font-semibold tracking-wide">Shiroko Unavailable</p>
                          <p className="text-white/35 text-[11px] font-mono max-w-[260px] text-center leading-relaxed">
                            This episode isn't available on Shiroko.<br/>Try switching the provider below or choose another server.
                          </p>
                          {suggestedServer && SERVER_META[suggestedServer] && (
                            <>
                              {failCountdown !== null && (
                                <p className="text-yellow-400/80 text-[11px] font-mono animate-pulse">
                                  Auto-switching to {SERVER_META[suggestedServer].label} in {failCountdown}s…
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  onClick={() => switchToServer(suggestedServer)}
                                  className={`inline-flex items-center gap-2 text-[11px] font-mono font-bold px-5 py-2.5 border ${SERVER_META[suggestedServer].borderCls} ${SERVER_META[suggestedServer].colorCls} ${SERVER_META[suggestedServer].hoverCls} transition-all uppercase tracking-widest`}
                                >
                                  <Play className="w-3 h-3 fill-current" /> Try {SERVER_META[suggestedServer].label}
                                </button>
                                {failCountdown !== null && (
                                  <button
                                    onClick={() => setFailCountdown(null)}
                                    className="text-[10px] font-mono px-3 py-2.5 border border-white/15 text-white/35 hover:border-white/40 hover:text-white/60 transition-colors uppercase tracking-widest"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="relative w-14 h-14">
                            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                            <div className="absolute inset-0 rounded-full border-2 border-t-sky-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                            <div className="absolute inset-2 rounded-full border border-white/20 border-t-sky-400/60 animate-spin" style={{ animationDuration: "0.6s", animationDirection: "reverse" }} />
                          </div>
                          <p className="text-white/70 text-sm font-semibold tracking-wide">Loading Shiroko…</p>
                        </>
                      )}
                      <p className="text-white/20 text-[11px] font-mono uppercase tracking-widest">
                        Episode {currentEp} · {lang}
                      </p>
                    </div>
                  </div>
                )}

                {/* KOTO loading / error overlay — only shown when no URL at all */}
                {server === "KOTO" && !kotoHlsUrl && !kotoPlayerUrl && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.92)" }}>
                    {banner && <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-10 scale-110 blur-sm" />}
                    <div className="relative z-10 flex flex-col items-center gap-4">
                      {kotoPlayerError ? (
                        <div className="text-center space-y-3">
                          <div className="w-11 h-11 border border-yellow-400/40 bg-yellow-400/5 flex items-center justify-center mx-auto rounded-sm">
                            <span className="text-yellow-400 text-xl">🔧</span>
                          </div>
                          <p className="text-white/80 text-sm font-semibold tracking-wide">AniKoto Under Maintenance</p>
                          <p className="text-white/35 text-[11px] font-mono max-w-[260px] text-center leading-relaxed">This server isn't available right now.<br/>Please try another server below.</p>
                          {suggestedServer && SERVER_META[suggestedServer] && (
                            <>
                              {failCountdown !== null && (
                                <p className="text-yellow-400/80 text-[11px] font-mono animate-pulse">
                                  Auto-switching to {SERVER_META[suggestedServer].label} in {failCountdown}s…
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  onClick={() => switchToServer(suggestedServer)}
                                  className={`inline-flex items-center gap-2 text-[11px] font-mono font-bold px-5 py-2.5 border ${SERVER_META[suggestedServer].borderCls} ${SERVER_META[suggestedServer].colorCls} ${SERVER_META[suggestedServer].hoverCls} transition-all uppercase tracking-widest`}
                                >
                                  <Play className="w-3 h-3 fill-current" /> Try {SERVER_META[suggestedServer].label}
                                </button>
                                {failCountdown !== null && (
                                  <button
                                    onClick={() => setFailCountdown(null)}
                                    className="text-[10px] font-mono px-3 py-2.5 border border-white/15 text-white/35 hover:border-white/40 hover:text-white/60 transition-colors uppercase tracking-widest"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="relative w-14 h-14">
                            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                            <div className="absolute inset-0 rounded-full border-2 border-t-teal-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                            <div className="absolute inset-2 rounded-full border border-white/20 border-t-teal-400/60 animate-spin" style={{ animationDuration: "0.6s", animationDirection: "reverse" }} />
                          </div>
                          <p className="text-white/70 text-sm font-semibold tracking-wide">Fetching AniKoto stream…</p>
                        </>
                      )}
                      <p className="text-white/20 text-[11px] font-mono uppercase tracking-widest">
                        Episode {currentEp} · {lang}
                      </p>
                    </div>
                  </div>
                )}

                {/* GoGo maybe-broken overlay — only relevant for iframe fallback, not native HLS */}
                {server === "GOGO" && gogoMaybeBroken && !gogoStreamError && !gogoHlsUrl && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.94)" }}>
                    {banner && <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.06] scale-110 blur-xl" />}
                    <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center max-w-sm">
                      <div className="w-12 h-12 border border-orange-400/40 flex items-center justify-center rounded-sm">
                        <span className="text-orange-400 text-xl font-bold">!</span>
                      </div>
                      <div className="space-y-2">
                        <p className="text-white text-sm font-semibold tracking-wide">GoGo Stream Not Playing</p>
                        <p className="text-white/35 text-[11px] font-mono leading-relaxed">
                          No playback detected — this episode may<br />have been removed (copyright) from GoGo.
                        </p>
                        {gogoMaybeCountdown !== null && gogoMaybeCountdown > 0 && (
                          <p className="text-orange-400/80 text-[11px] font-mono animate-pulse">
                            Auto-switching in {gogoMaybeCountdown}s…
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 justify-center">
                        <button
                          onClick={() => { setGogoMaybeBroken(false); setGogoMaybeCountdown(null); }}
                          className="text-[10px] font-mono px-3 py-2 border border-white/15 text-white/40 hover:border-white/40 hover:text-white/70 transition-colors uppercase tracking-widest"
                        >
                          Dismiss
                        </button>
                        <button
                          onClick={() => { setServer("KOTO"); setGogoMaybeBroken(false); setGogoMaybeCountdown(null); setGogoStreamError(false); setIframeLoaded(false); bridgeLiveRef.current = false; setBridgeLive(false); }}
                          className="flex items-center gap-1.5 text-[10px] font-mono font-bold px-3 py-2 border border-teal-400/70 text-teal-400 hover:bg-teal-400/10 transition-all uppercase tracking-widest"
                        >
                          <Play className="w-3 h-3 fill-current" /> AniKoto
                        </button>
                        <button
                          onClick={() => { setServer("ANIZONE"); setGogoMaybeBroken(false); setGogoMaybeCountdown(null); setGogoStreamError(false); setIframeLoaded(false); bridgeLiveRef.current = false; setBridgeLive(false); }}
                          className="flex items-center gap-1.5 text-[10px] font-mono font-bold px-3 py-2 border border-blue-400/70 text-blue-400 hover:bg-blue-400/10 transition-all uppercase tracking-widest"
                        >
                          <Play className="w-3 h-3 fill-current" /> AniZone
                        </button>
                        <button
                          onClick={() => { setServer("MIRURO"); setGogoMaybeBroken(false); setGogoMaybeCountdown(null); setGogoStreamError(false); setIframeLoaded(false); bridgeLiveRef.current = false; setBridgeLive(false); }}
                          className="flex items-center gap-1.5 text-[10px] font-mono font-bold px-3 py-2 border border-purple-400/70 text-purple-400 hover:bg-purple-400/10 transition-all uppercase tracking-widest"
                        >
                          <Play className="w-3 h-3 fill-current" /> Miruro
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* GoGo stream broken — custom themed error overlay */}
                {server === "GOGO" && gogoStreamError && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.97)" }}>
                    {banner && <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.06] scale-110 blur-xl" />}
                    <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center max-w-sm">
                      <div className="w-12 h-12 border border-orange-400/30 flex items-center justify-center rounded-sm">
                        <span className="text-orange-400 text-xl font-bold">!</span>
                      </div>
                      <div className="space-y-2">
                        <p className="text-white text-sm font-semibold tracking-wide">GoGo Stream Unavailable</p>
                        {autoSwitchMsg ? (
                          <p className="text-teal-400 text-[11px] font-mono leading-relaxed animate-pulse">{autoSwitchMsg}</p>
                        ) : (
                          <p className="text-white/35 text-[11px] font-mono leading-relaxed">
                            This episode may have been removed from GoGo<br />(copyright) or the CDN link is broken.<br />Try another server below.
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 justify-center">
                        <button
                          onClick={() => { setGogoStreamError(false); setIframeLoaded(false); setCdnNotFound(false); bridgeLiveRef.current = false; setBridgeLive(false); }}
                          className="text-[10px] font-mono px-3 py-2 border border-white/15 text-white/40 hover:border-white/40 hover:text-white/70 transition-colors uppercase tracking-widest"
                        >
                          Retry GoGo
                        </button>
                        <button
                          onClick={() => { setServer("KOTO"); setGogoStreamError(false); setIframeLoaded(false); bridgeLiveRef.current = false; setBridgeLive(false); setAutoSwitchMsg(null); }}
                          className="flex items-center gap-1.5 text-[10px] font-mono font-bold px-3 py-2 border border-teal-400/70 text-teal-400 hover:bg-teal-400/10 transition-all uppercase tracking-widest"
                        >
                          <Play className="w-3 h-3 fill-current" /> AniKoto
                        </button>
                        <button
                          onClick={() => { setServer("ANIZONE"); setGogoStreamError(false); setIframeLoaded(false); bridgeLiveRef.current = false; setBridgeLive(false); setAutoSwitchMsg(null); }}
                          className="flex items-center gap-1.5 text-[10px] font-mono font-bold px-3 py-2 border border-blue-400/70 text-blue-400 hover:bg-blue-400/10 transition-all uppercase tracking-widest"
                        >
                          <Play className="w-3 h-3 fill-current" /> AniZone
                        </button>
                        <button
                          onClick={() => { setServer("MIRURO"); setGogoStreamError(false); setIframeLoaded(false); bridgeLiveRef.current = false; setBridgeLive(false); setAutoSwitchMsg(null); }}
                          className="flex items-center gap-1.5 text-[10px] font-mono font-bold px-3 py-2 border border-purple-400/70 text-purple-400 hover:bg-purple-400/10 transition-all uppercase tracking-widest"
                        >
                          <Play className="w-3 h-3 fill-current" /> Miruro
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Floating "not working?" button — shown after iframe is loaded and no error */}
                {server === "GOGO" && iframeLoaded && !gogoStreamError && (
                  <button
                    onClick={() => setGogoStreamError(true)}
                    className="absolute bottom-3 right-3 z-10 text-[9px] font-mono uppercase tracking-widest text-white/30 hover:text-white/60 border border-white/10 hover:border-white/25 px-2.5 py-1.5 transition-colors bg-black/60"
                  >
                    Stream broken?
                  </button>
                )}

                {/* iframe-based loading overlay (GOGO fallback / CUSTOM only — not shown when GOGO has native HLS) */}
                {(server === "CUSTOM" || (server === "GOGO" && !gogoHlsUrl)) && !iframeLoaded && !gogoStreamError && (
                  <div
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center"
                    style={{ background: "rgba(0,0,0,0.92)" }}
                  >
                    {banner && (
                      <img
                        src={banner}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover opacity-10 scale-110 blur-sm"
                      />
                    )}
                    <div className="relative z-10 flex flex-col items-center gap-4">
                      {server === "GOGO" && cdnNotFound && !cdnUrl ? (
                        <>
                          <div className="text-center space-y-2">
                            <p className="text-white/70 text-sm font-semibold tracking-wide">Not found on GogoAnimeS</p>
                            <p className="text-white/30 text-[11px] font-mono uppercase tracking-widest">
                              Slug <span className="text-orange-400/60">{gogoSlug}</span> · episode {currentEp}
                            </p>
                            <p className="text-white/20 text-[10px] font-mono max-w-[260px] text-center">
                              This anime may not be on GogoAnimeS — try KOTO or edit the slug below.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 justify-center mt-2">
                            <button
                              onClick={() => { setServer("KOTO"); setIframeLoaded(false); }}
                              className="flex items-center gap-2 text-[12px] font-mono font-bold px-6 py-3 border border-teal-400 text-teal-400 hover:bg-teal-400 hover:text-black transition-all uppercase tracking-widest"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              Stream via AniKoto
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="relative w-14 h-14">
                            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                            <div className="absolute inset-0 rounded-full border-2 border-t-white border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                            <div className="absolute inset-2 rounded-full border border-white/20 border-t-white/60 animate-spin" style={{ animationDuration: "0.6s", animationDirection: "reverse" }} />
                          </div>
                          <div className="text-center">
                            <p className="text-white text-sm font-semibold tracking-wide">
                              {server === "GOGO" && cdnLoading
                                ? "Fetching stream link…"
                                : server === "GOGO"
                                ? (cdnUrl ? "Loading stream…" : "Connecting to GogoAnimeS…")
                                : "Loading, please wait…"}
                            </p>
                            <p className="text-white/30 text-[11px] font-mono mt-1 uppercase tracking-widest">
                              Episode {currentEp} · {lang}
                              {server === "GOGO" && gogoSlug && ` · ${gogoSlug.toUpperCase()}`}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-zinc-950">
                <img src={banner} alt={title} className="absolute inset-0 w-full h-full object-cover opacity-20" />
                <div className="relative z-10 text-center">
                  <div className="w-8 h-8 border border-white/20 border-t-white rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-white/40 text-xs font-mono">Loading stream...</p>
                </div>
              </div>
            )}
          </div>

          {/* ── MOBILE: YouTube-style info strip below player ── */}
          <div className="flex md:hidden flex-col">
            {/* Episode title + nav */}
            <div className="px-4 pt-3 pb-2">
              {getEpTitle(currentEp) !== `Episode ${currentEp}` ? (
                <p className="text-[13px] font-semibold text-white leading-snug line-clamp-2">
                  {currentEp}. {getEpTitle(currentEp)}
                </p>
              ) : (
                <p className="text-[13px] font-semibold text-white/70">Episode {currentEp}</p>
              )}
              {getEpAired(currentEp) && (
                <p className="text-[10px] text-white/30 font-mono mt-1">{getEpAired(currentEp)}</p>
              )}
            </div>
            {/* Prev / Next + sub/dub */}
            <div className="flex items-center gap-2 px-4 pb-3 border-b border-white/[0.06]">
              <Link href={`/watch/al/${animeId}/${currentEp - 1}`}>
                <button
                  disabled={currentEp <= 1}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/8 text-white/50 disabled:opacity-30 text-[11px] font-mono uppercase tracking-widest active:bg-white/15"
                >
                  <SkipBack className="w-3.5 h-3.5" /> Prev
                </button>
              </Link>
              <Link href={`/watch/al/${animeId}/${currentEp + 1}`}>
                <button
                  disabled={totalEps > 0 && currentEp >= totalEps}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/8 text-white/50 disabled:opacity-30 text-[11px] font-mono uppercase tracking-widest active:bg-white/15"
                >
                  Next <SkipForward className="w-3.5 h-3.5" />
                </button>
              </Link>
              {/* SUB/DUB */}
              <div className="ml-auto flex items-center gap-1.5">
                {actualLang && !autoDetecting && (
                  <span
                    title={actualLang === lang ? `Playing in ${actualLang}` : `Requested ${lang} but stream is ${actualLang}`}
                    className={`text-[8px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                      actualLang === "DUB"
                        ? actualLang === lang ? "border-yellow-400/50 text-yellow-300/80 bg-yellow-400/10" : "border-yellow-400/30 text-yellow-300/50"
                        : actualLang === lang ? "border-sky-400/50 text-sky-300/80 bg-sky-400/10" : "border-sky-400/30 text-sky-300/50"
                    }`}
                  >
                    {actualLang === lang ? `✓ ${actualLang}` : `↩ ${actualLang}`}
                  </span>
                )}
                {(["SUB", "DUB"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={`text-[10px] font-mono px-3 py-1.5 rounded-full transition-colors ${
                      lang === l
                        ? "bg-white text-black font-bold"
                        : "bg-white/8 text-white/40"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {/* Server pills */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06] overflow-x-auto no-scrollbar">
              <span className="text-[9px] font-mono text-white/25 uppercase tracking-widest shrink-0">Server</span>
              {([
                { key: "GOGO",        label: "GogoAnime",  color: "orange" },
                { key: "KOTO",        label: "AniKoto",    color: "teal"   },
                { key: "ANIZONE",     label: "AniZone",    color: "blue"   },
                { key: "MIRURO",      label: "Miruro",     color: "purple" },
                { key: "ANIMEONSEN",  label: "AnimeonSen", color: "green"  },
                { key: "ANINEKO",     label: "AniNeko",    color: "pink"   },
              ] as const).map(({ key, label, color }) => {
                const active = server === key;
                const health = serverHealth[key];
                const isFailed = health === "fail" && !active;
                const colorMap = {
                  orange: { active: "bg-orange-500/90 text-white", idle: "bg-white/6 text-white/50" },
                  teal:   { active: "bg-teal-500/90 text-white",   idle: "bg-white/6 text-white/50" },
                  blue:   { active: "bg-blue-500/90 text-white",   idle: "bg-white/6 text-white/50" },
                  purple: { active: "bg-purple-500/90 text-white", idle: "bg-white/6 text-white/50" },
                  green:  { active: "bg-green-500/90 text-white",  idle: "bg-white/6 text-white/50" },
                  pink:   { active: "bg-pink-500/90 text-white",   idle: "bg-white/6 text-white/50" },
                };
                const dotClass =
                  health === "ok"       ? "bg-green-400" :
                  health === "fail"     ? "bg-red-500" :
                  health === "checking" ? "bg-yellow-400 animate-pulse" :
                  "bg-white/20";
                const dotTitle =
                  health === "ok"       ? "Available" :
                  health === "fail"     ? "Unavailable for this episode" :
                  health === "checking" ? "Checking…" :
                  "Not checked yet";
                const c = colorMap[color];
                return (
                  <button
                    key={key}
                    onClick={() => {
                      userPickedRef.current = true;
                      setServer(key);
                      if (key !== "ANIZONE") setIframeLoaded(false);
                    }}
                    className={`relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-mono shrink-0 transition-all ${active ? c.active : c.idle} ${isFailed ? "opacity-40" : ""}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} title={dotTitle} />
                    {label}
                    {raceWinnerServer === key && (
                      <span className="text-[8px] leading-none ml-0.5" title="Fastest server this episode">⚡</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Warning banner + AI verification badge — desktop only */}
          <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-white/[0.03] border-b border-white/5 text-[10px] text-white/30">
            <MessageSquare className="w-3 h-3 shrink-0" />
            <span>If the episode is not working, please try a different server below.</span>
            <button
              onClick={reportBrokenStream}
              disabled={reportSent}
              className={`flex items-center gap-1 ml-2 px-2 py-0.5 rounded border transition-all shrink-0 ${
                reportSent
                  ? "border-green-500/40 text-green-400/70 cursor-default"
                  : "border-white/10 text-white/25 hover:border-red-400/40 hover:text-red-400/70 cursor-pointer"
              }`}
              title="Report this stream as broken"
            >
              {reportSent ? (
                <><CheckCircle2 className="w-3 h-3" /><span>Reported</span></>
              ) : (
                <><Flag className="w-3 h-3" /><span>Flag broken</span></>
              )}
            </button>
            <div className="ml-auto shrink-0">
              {verifyResult === null && sourcePageTitle && (
                <span className="text-white/20 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/20 animate-pulse inline-block" />
                  Verifying…
                </span>
              )}
              {verifyResult !== null && verifyResult.correct && (
                <span
                  className={`font-mono flex items-center gap-1 ${
                    verifyResult.confidence === "high" ? "text-green-400/70" : "text-white/35"
                  }`}
                  title={verifyResult.reason}
                >
                  ✓ {verifyResult.confidence === "high" ? "AI verified correct episode" : "Episode looks correct"}
                </span>
              )}
              {verifyResult !== null && !verifyResult.correct && (
                <span
                  className="font-mono flex items-center gap-1 text-yellow-400/80 cursor-help"
                  title={verifyResult.reason}
                >
                  ⚠ Wrong episode? — {verifyResult.reason.slice(0, 60)}{verifyResult.reason.length > 60 ? "…" : ""}
                </span>
              )}
            </div>
          </div>

          {/* Player control bar — desktop only */}
          <div className="hidden md:flex items-center justify-between px-4 py-2.5 border-b border-white/5">
            <div className="flex items-center gap-1.5">
              <WatchTogetherPanel
                status={wt.status}
                roomId={wt.roomId}
                members={wt.members}
                chat={wt.chat}
                isHost={wt.isHost}
                isLoggedIn={wt.isLoggedIn}
                user={wt.user}
                joinNotice={wt.joinNotice}
                leftNotice={wt.leftNotice}
                syncNotice={wt.syncNotice}
                syncRequest={wt.syncRequest}
                bufferingMembers={wt.bufferingMembers}
                onCreateRoom={wt.createRoom}
                onJoinRoom={wt.joinRoom}
                onLeave={wt.leaveRoom}
                onSendChat={wt.sendChat}
                onSyncNow={() => wt.sendSync(playerTimeRef.current)}
                onRequestSync={wt.sendSyncRequest}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setTheaterMode(t => !t)}
                className="p-1.5 hover:bg-white/10 rounded transition-colors"
                title={theaterMode ? "Exit theater mode" : "Theater mode"}
              >
                {theaterMode
                  ? <Minimize2 className="w-4 h-4 text-white/60 hover:text-white" />
                  : <Maximize2 className="w-4 h-4 text-white/50 hover:text-white" />}
              </button>
              {currentEp > 1 && (
                <Link href={`/watch/al/${animeId}/${currentEp - 1}`}>
                  <button className="p-1.5 hover:bg-white/10 rounded transition-colors" title="Previous episode">
                    <SkipBack className="w-4 h-4 text-white/50 hover:text-white" />
                  </button>
                </Link>
              )}
              <Link href={`/watch/al/${animeId}/${currentEp}`}>
                <button className="p-1.5 hover:bg-white/10 rounded transition-colors" title="Reload episode">
                  <Play className="w-4 h-4 text-white/50 hover:text-white fill-current" />
                </button>
              </Link>
              {(totalEps === 0 || currentEp < totalEps) && (
                <Link href={`/watch/al/${animeId}/${currentEp + 1}`}>
                  <button className="p-1.5 hover:bg-white/10 rounded transition-colors" title="Next episode">
                    <SkipForward className="w-4 h-4 text-white/50 hover:text-white" />
                  </button>
                </Link>
              )}
              <button className="p-1.5 hover:bg-white/10 rounded transition-colors ml-1">
                <Scissors className="w-4 h-4 text-white/30" />
              </button>
            </div>
            {liveViewers > 0 && (
              <div className="flex items-center gap-1.5 px-2">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                </span>
                <span className="text-[10px] font-mono text-white/40 tabular-nums whitespace-nowrap">
                  {liveViewers.toLocaleString()} watching
                </span>
              </div>
            )}
            <button
              onClick={() => toggle(animeId)}
              className="p-1.5 hover:bg-white/10 rounded transition-colors"
              title={saved ? "Remove from watchlist" : "Add to watchlist"}
            >
              {saved
                ? <BookmarkCheck className="w-4 h-4 text-white" />
                : <Bookmark className="w-4 h-4 text-white/40 hover:text-white" />}
            </button>
          </div>

          {/* "You are watching" + SUB/DUB + Quality — desktop only */}
          <div className="hidden md:flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 border-b border-white/5">
            <div>
              <p className="text-[10px] text-white/30 font-mono uppercase tracking-widest mb-0.5">You are watching</p>
              <p className="text-sm font-semibold text-white">
                Episode {currentEp}
                {epCount > 0 && <span className="text-white/30 font-normal"> / {epCount}</span>}
              </p>
              {getEpTitle(currentEp) !== `Episode ${currentEp}` && (
                <p className="text-[11px] text-white/50 mt-0.5 line-clamp-1">{getEpTitle(currentEp)}</p>
              )}
              <p className="text-[10px] text-white/25 mt-0.5">
                If the current server doesn't work, try another server below.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              {/* SUB/DUB toggle */}
              <div className="flex items-center gap-2">
                {actualLang && !autoDetecting && (
                  <span
                    title={actualLang === lang ? `Playing in ${actualLang}` : `Requested ${lang} but stream is ${actualLang}`}
                    className={`text-[9px] font-mono px-1.5 py-0.5 border shrink-0 ${
                      actualLang === "DUB"
                        ? actualLang === lang ? "border-yellow-400/60 text-yellow-300/90 bg-yellow-400/10" : "border-yellow-400/30 text-yellow-300/50"
                        : actualLang === lang ? "border-sky-400/60 text-sky-300/90 bg-sky-400/10" : "border-sky-400/30 text-sky-300/50"
                    }`}
                  >
                    {actualLang === lang ? `✓ ${actualLang}` : `↩ ${actualLang}`}
                  </span>
                )}
                {(["SUB", "DUB"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={`text-[10px] font-mono px-2.5 py-1 border transition-colors ${
                      lang === l
                        ? "border-white bg-white text-black"
                        : "border-white/20 text-white/40 hover:border-white/50 hover:text-white"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {/* Server dropdown */}
              <div className="relative" ref={serverDropRef}>
                <button
                  onClick={() => setServerDropOpen(o => !o)}
                  className={`flex items-center gap-2 text-[10px] font-mono px-3 py-1 border transition-colors ${
                    serverDropOpen
                      ? "border-white/40 text-white bg-white/5"
                      : "border-white/20 text-white/60 hover:border-white/40 hover:text-white"
                  }`}
                >
                  <span className="text-white/30">Server</span>
                  <span className={
                    server === "GOGO"       ? "text-orange-400" :
                    server === "KOTO"       ? "text-teal-400" :
                    server === "ANIZONE"    ? "text-blue-400" :
                    server === "MIRURO"     ? "text-purple-400" :
                    server === "ANIMEONSEN" ? "text-green-400" :
                    server === "ANINEKO"    ? "text-pink-400" :
                    server === "SHIROKO"    ? "text-sky-400" :
                    "text-white"
                  }>{server}</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${serverDropOpen ? "rotate-180" : ""}`} />
                </button>
                {serverDropOpen && (
                  <div className="absolute top-full right-0 mt-1 z-50 bg-[#0d0d0d] border border-white/10 shadow-2xl min-w-[170px]">
                    {([
                      { key: "GOGO",       label: "GOGO",       color: "orange" as const, onClick: () => { userPickedRef.current = true; setServer("GOGO"); setCdnNotFound(false); setIframeLoaded(false); setGogoStreamError(false); bridgeLiveRef.current = false; setBridgeLive(false); } },
                      { key: "KOTO",       label: "KOTO",       color: "teal"   as const, onClick: () => { userPickedRef.current = true; setServer("KOTO"); setIframeLoaded(false); } },
                      { key: "ANIZONE",    label: "ANIZONE",    color: "blue"   as const, onClick: () => { userPickedRef.current = true; setServer("ANIZONE"); setIframeLoaded(false); } },
                      { key: "MIRURO",     label: "MIRURO",     color: "purple" as const, onClick: () => { userPickedRef.current = true; setServer("MIRURO"); setIframeLoaded(false); } },
                      { key: "ANIMEONSEN", label: "ANIMEONSEN", color: "green"  as const, onClick: () => { userPickedRef.current = true; setServer("ANIMEONSEN"); setIframeLoaded(false); if (aoCfReady) setAnimeonsenInitializing(false); } },
                      { key: "ANINEKO",    label: "ANINEKO",    color: "pink"   as const, onClick: () => { userPickedRef.current = true; setServer("ANINEKO"); setIframeLoaded(false); } },
                      { key: "SHIROKO",    label: "SHIROKO",    color: "sky"    as const, onClick: () => { userPickedRef.current = true; setServer("SHIROKO"); setIframeLoaded(false); } },
                    ]).map(({ key, label, color, onClick }) => {
                      const active = server === key;
                      const health = serverHealth[key as keyof typeof serverHealth];
                      const colorText = {
                        orange: active ? "text-orange-400" : "text-orange-400/50",
                        teal:   active ? "text-teal-400"   : "text-teal-400/50",
                        blue:   active ? "text-blue-400"   : "text-blue-400/50",
                        purple: active ? "text-purple-400" : "text-purple-400/50",
                        green:  active ? "text-green-400"  : "text-green-400/50",
                        pink:   active ? "text-pink-400"   : "text-pink-400/50",
                        sky:    active ? "text-sky-400"    : "text-sky-400/50",
                      }[color];
                      const dotClass =
                        health === "ok"       ? "bg-green-400" :
                        health === "fail"     ? "bg-red-500" :
                        health === "checking" ? "bg-yellow-400 animate-pulse" :
                        "bg-white/20";
                      return (
                        <button
                          key={key}
                          onClick={() => { onClick(); setServerDropOpen(false); }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left ${
                            active ? "bg-white/5" : "hover:bg-white/5"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
                          <span className={`text-[10px] font-mono flex-1 ${colorText}`}>{label}</span>
                          {raceWinnerServer === key && <span className="text-[9px]" title="Fastest server">⚡</span>}
                          {active && <span className="text-[9px] text-white/30">✓</span>}
                        </button>
                      );
                    })}
                    {/* SHIROKO sub-provider — shown when SHIROKO is the active server */}
                    {server === "SHIROKO" && (
                      <div className="border-t border-white/10 pt-1 pb-1">
                        <div className="px-3 py-1 text-[9px] font-mono text-sky-400/40 uppercase tracking-widest">Provider</div>
                        {[
                          { id: "zen",        label: "Zen"       },
                          { id: "hianime",    label: "HiAnime"   },
                          { id: "gogoanime",  label: "GogoAnime" },
                          { id: "animepahe",  label: "AnimePahe" },
                          { id: "animerulz",  label: "AnimeRulz" },
                        ].map(p => (
                          <button
                            key={p.id}
                            onClick={() => {
                              setShirokoProvider(p.id);
                              setShirokoIframeUrl(null);
                              setShirokoError(null);
                              setIframeLoaded(false);
                            }}
                            className={`w-full flex items-center gap-2 px-5 py-1.5 text-[10px] font-mono transition-colors ${
                              shirokoProvider === p.id
                                ? "text-sky-300 bg-sky-400/10"
                                : "text-white/40 hover:text-white/70 hover:bg-white/5"
                            }`}
                          >
                            {shirokoProvider === p.id
                              ? <span className="text-sky-400 text-[9px] shrink-0">✓</span>
                              : <span className="w-[9px] shrink-0" />}
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* DUB-not-available warning — shown when DUB was requested but stream fell back to SUB */}
          {lang === "DUB" && actualLang === "SUB" && !autoDetecting && (
            <div className="flex items-center gap-2.5 px-4 py-2 bg-amber-400/[0.06] border-b border-amber-400/20">
              <span className="text-[10px] shrink-0">⚠️</span>
              <p className="text-[10px] font-mono text-amber-300/70">
                No dubbed version found for this title — playing in <span className="text-amber-200/90 font-semibold">SUB</span> instead.
                Try a different server or check back later.
              </p>
            </div>
          )}

          {/* Auto-detect banner — shown while race is running */}
          {autoDetecting && (
            <div className="border-b border-white/5 px-4 py-2.5 flex items-center gap-2.5">
              <div className="flex gap-[3px] items-center shrink-0">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-400/70 animate-bounce [animation-delay:0ms]" />
                <div className="w-1.5 h-1.5 rounded-full bg-teal-400/70 animate-bounce [animation-delay:150ms]" />
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400/70 animate-bounce [animation-delay:300ms]" />
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400/70 animate-bounce [animation-delay:450ms]" />
                <div className="w-1.5 h-1.5 rounded-full bg-green-400/70 animate-bounce [animation-delay:600ms]" />
              </div>
              <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Auto-detecting best server…</span>
              {(() => {
                const pref = localStorage.getItem(`na_preferred_${animeId}`) as "GOGO" | "KOTO" | "ANIZONE" | "MIRURO" | "ANIMEONSEN" | null;
                const color = pref === "GOGO" ? "text-orange-400/50" : pref === "KOTO" ? "text-teal-400/50" : pref === "ANIZONE" ? "text-blue-400/50" : pref === "MIRURO" ? "text-purple-400/50" : pref === "ANIMEONSEN" ? "text-green-400/50" : null;
                return pref && color ? (
                  <span className={`text-[9px] font-mono uppercase tracking-widest ml-auto ${color}`}>
                    trying {pref} first
                  </span>
                ) : null;
              })()}
            </div>
          )}

          {/* GOGO status panel */}
          {!autoDetecting && server === "GOGO" && (
            <div className="border-b border-white/5 px-4 py-2.5 flex items-center gap-2.5">
              {cdnLoading ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-orange-400/40 animate-pulse shrink-0" />
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Connecting…</span>
                </>
              ) : cdnUrl && !gogoStreamError ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
                  <span className="text-[10px] font-mono text-orange-400/70 uppercase tracking-widest">Stream Connected</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-white/20 shrink-0" />
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Not Connected</span>
                </>
              )}
            </div>
          )}

          {/* KOTO status panel */}
          {!autoDetecting && server === "KOTO" && (
            <div className="border-b border-white/5 px-4 py-2.5 flex items-center gap-2.5">
              {kotoPlayerLoading ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-teal-400/40 animate-pulse shrink-0" />
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Connecting…</span>
                </>
              ) : (kotoPlayerUrl || kotoHlsUrl) ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-teal-400 shrink-0" />
                  <span className="text-[10px] font-mono text-teal-400/70 uppercase tracking-widest">Stream Connected</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-white/20 shrink-0" />
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Not Connected</span>
                </>
              )}
            </div>
          )}

          {/* ANIZONE status panel */}
          {!autoDetecting && server === "ANIZONE" && (
            <div className="border-b border-white/5 px-4 py-2.5 flex items-center gap-2.5">
              {anizoneStreamLoading ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-blue-400/40 animate-pulse shrink-0" />
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Connecting…</span>
                </>
              ) : anizoneHlsUrl ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                  <span className="text-[10px] font-mono text-blue-400/70 uppercase tracking-widest">Stream Connected</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-white/20 shrink-0" />
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Not Connected</span>
                </>
              )}
            </div>
          )}

          {/* MIRURO status panel */}
          {!autoDetecting && server === "MIRURO" && (
            <div className="border-b border-white/5 px-4 py-2.5 flex items-center gap-2.5">
              {miruroLoading ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-purple-400/40 animate-pulse shrink-0" />
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Connecting…</span>
                </>
              ) : miruroIframeUrl ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />
                  <span className="text-[10px] font-mono text-purple-400/70 uppercase tracking-widest">miruro.bz</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-white/20 shrink-0" />
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Not Connected</span>
                </>
              )}
              <button
                onClick={openMiruroOsPopup}
                className="ml-auto text-[10px] font-mono text-purple-400/50 hover:text-purple-400 uppercase tracking-widest underline underline-offset-2"
              >
                Reload
              </button>
            </div>
          )}

          {/* ANIMEONSEN status panel + content ID input */}
          {!autoDetecting && server === "ANIMEONSEN" && (
            <>
              <div className="border-b border-white/5 px-4 py-2.5 flex items-center gap-2.5">
                {animeonsenLoading ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-green-400/40 animate-pulse shrink-0" />
                    <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Searching…</span>
                  </>
                ) : animeonsenIframeUrl ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                    <span className="text-[10px] font-mono text-green-400/70 uppercase tracking-widest">Connected</span>
                  </>
                ) : animeonsenError ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-red-400/60 shrink-0" />
                    <span className="text-[10px] font-mono text-red-400/70 uppercase tracking-widest">Not found — paste content ID below</span>
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 rounded-full bg-white/20 shrink-0" />
                    <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Not Connected</span>
                  </>
                )}
              </div>
            </>
          )}

          {/* DIRECT panel */}
          {server === "CUSTOM" && (
            <div className="border-b border-white/5 bg-white/[0.02] px-4 py-3 space-y-2.5">
              {/* URL Template row */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest shrink-0 w-16">Template</span>
                <input
                  value={templateInput}
                  onChange={(e) => setTemplateInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveTemplate()}
                  placeholder="https://site.com/anime/episode-{ep}  (use {ep} for episode number)"
                  className="flex-1 bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-white placeholder-white/15 focus:outline-none focus:border-white/30 font-mono"
                />
                <button
                  onClick={saveTemplate}
                  className="text-[10px] font-mono px-2.5 py-1.5 border border-white/20 text-white/50 hover:border-white hover:text-white transition-colors shrink-0"
                >
                  Save
                </button>
                {urlTemplate && (
                  <button
                    onClick={clearTemplate}
                    className="text-[10px] font-mono px-2.5 py-1.5 border border-white/10 text-white/30 hover:border-red-500/50 hover:text-red-400 transition-colors shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>
              {/* Direct URL row */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest shrink-0 w-16">
                  {urlTemplate ? `EP ${currentEp}` : "URL"}
                </span>
                <input
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="Or paste a one-time URL directly..."
                  className="flex-1 bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-white placeholder-white/15 focus:outline-none focus:border-white/30 font-mono"
                />
                <button
                  onClick={() => setIframeLoaded(false)}
                  className="text-[10px] font-mono px-2.5 py-1.5 border border-white/20 text-white/50 hover:border-white hover:text-white transition-colors shrink-0"
                >
                  Load
                </button>
              </div>
              {urlTemplate && (
                <p className="text-[10px] font-mono text-white/25 pl-[72px]">
                  Template active — episodes auto-fill as you navigate.
                </p>
              )}
            </div>
          )}

          {/* ── MOBILE: Up Next episode list (YouTube style) ── */}
          <div className="flex md:hidden flex-col border-t border-white/[0.06]">
            <div className="flex items-center justify-between px-4 py-3">
              <h3 className="text-[13px] font-semibold text-white">Up Next</h3>
              <span className="text-[10px] font-mono text-white/30">{epCount > 0 ? `${epCount} episodes` : ""}</span>
            </div>
            <div className="overflow-x-auto no-scrollbar">
              <div className="flex gap-3 px-4 pb-4">
                {filteredEps.slice(0, 20).map((ep) => {
                  const active = ep === currentEp;
                  const watched = isWatched(ep);
                  const thumb = getEpThumb(ep);
                  const epTitle = getEpTitle(ep);
                  const progressPct = !active && !watched ? getEpisodeProgressPct(`al_${animeId}_${ep}`) : null;
                  return (
                    <Link key={ep} href={`/watch/al/${animeId}/${ep}`}>
                      <div className={`flex flex-col gap-1.5 w-36 shrink-0 cursor-pointer ${active ? "opacity-100" : "opacity-80 active:opacity-100"}`}>
                        <div className="relative w-36 h-[81px] rounded-lg overflow-hidden bg-zinc-900">
                          <img src={thumb} alt={`EP ${ep}`} className="w-full h-full object-cover" />
                          {active && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                              <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
                                <Play className="w-4 h-4 text-black fill-black ml-0.5" />
                              </div>
                            </div>
                          )}
                          {watched && !active && (
                            <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center">
                              <span className="text-[8px] text-white/80">✓</span>
                            </div>
                          )}
                          {progressPct !== null && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
                              <div className="h-full bg-blue-400" style={{ width: `${progressPct * 100}%` }} />
                            </div>
                          )}
                          <div className="absolute bottom-1 left-1.5">
                            <span className={`text-[9px] font-mono font-bold px-1 py-0.5 rounded ${active ? "bg-white text-black" : "bg-black/60 text-white/70"}`}>EP {ep}</span>
                          </div>
                        </div>
                        <p className={`text-[11px] leading-snug line-clamp-2 ${active ? "text-white font-semibold" : "text-white/60"}`}>
                          {epTitle !== `Episode ${ep}` ? epTitle : <span className="text-white/35">Episode {ep}</span>}
                        </p>
                      </div>
                    </Link>
                  );
                })}
                {filteredEps.length > 20 && (
                  <Link href={`/watch/al/${animeId}/${filteredEps[20]}`}>
                    <div className="flex flex-col items-center justify-center w-28 h-[81px] shrink-0 rounded-lg bg-white/5 border border-white/10 gap-2 cursor-pointer active:bg-white/10">
                      <span className="text-white/50 text-[11px] font-mono">+{filteredEps.length - 20} more</span>
                    </div>
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* ── BELOW PLAYER: Rating Meter + Related ── */}
          <div className="flex flex-col lg:flex-row gap-0">
            {/* Rating Meter */}
            <div className="flex-1 min-w-0 px-4 sm:px-6 py-6 border-r border-white/5">

              {/* ── NEXA METER (Moctale-style) ── */}
              <EpisodeRatingMeter
                animeId={String(animeId)}
                episode={currentEp}
                episodeTitle={getEpTitle(currentEp)}
                animeName={anime?.title.english || anime?.title.romaji || ""}
                coverImage={anime?.coverImage.extraLarge || anime?.coverImage.large || ""}
              />

            </div>

            {/* Related anime */}
            {relatedAnime.length > 0 && (
              <div className="lg:w-72 xl:w-80 px-4 py-6 shrink-0">
                <h3 className="text-sm font-semibold text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                  <span className="w-1 h-4 bg-white inline-block" />
                  Related Anime
                </h3>
                <div className="space-y-3">
                  {relatedAnime.map((r) => (
                    <Link key={r.id} href={`/anime/al/${r.id}`}>
                      <div className="flex items-center gap-3 cursor-pointer group hover:bg-white/5 -mx-2 px-2 py-1.5 transition-colors">
                        <img
                          src={r.coverImage?.large || ""}
                          alt={r.title.english || r.title.romaji}
                          className="w-12 h-16 object-cover shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white group-hover:text-white/80 transition-colors line-clamp-2 font-medium">
                            {r.title.english || r.title.romaji}
                          </p>
                          <p className="text-[10px] text-white/30 font-mono mt-0.5 uppercase">
                            {r.relationType.replace(/_/g, " ")}
                            {r.format ? ` · ${r.format}` : ""}
                            {r.seasonYear ? ` · ${r.seasonYear}` : ""}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Episode list — desktop only ── */}
        <div className={`${theaterMode ? "hidden" : "hidden xl:flex"} flex-col xl:w-80 shrink-0 border-l border-white/5`}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-white">Episodes</h3>
              <span className="text-[10px] font-mono text-white/30">{epCount > 0 ? epCount : "?"}</span>
              {/* Airing countdown chip — live ticking, only shown for RELEASING shows */}
              {anime?.nextAiringEpisode && countdownSecs !== null && countdownSecs > 0 && (
                <span className="inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 border border-green-500/30 text-green-400/70 bg-green-500/5 tabular-nums">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400/60 animate-pulse inline-block" />
                  Ep {anime.nextAiringEpisode.episode} in {fmtCountdown(countdownSecs)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setEpGridView(false)}
                className={`p-1.5 rounded transition-colors ${!epGridView ? "text-white" : "text-white/30 hover:text-white"}`}
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setEpGridView(true)}
                className={`p-1.5 rounded transition-colors ${epGridView ? "text-white" : "text-white/30 hover:text-white"}`}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 rounded text-white/30 hover:text-white transition-colors ml-1">
                <Eye className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Search episodes */}
          <div className="px-3 py-2.5 border-b border-white/5">
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5">
              <Search className="w-3 h-3 text-white/25 shrink-0" />
              <input
                value={epSearch}
                onChange={(e) => setEpSearch(e.target.value)}
                placeholder="Search episodes..."
                className="flex-1 bg-transparent text-xs text-white placeholder-white/25 focus:outline-none"
              />
            </div>
          </div>

          {/* New episode notification banner */}
          {newEpNotice !== null && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-green-500/10 border-b border-green-500/20 animate-pulse-once">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-ping" />
                <span className="text-[11px] font-mono text-green-400 font-semibold">
                  Episode {newEpNotice} just dropped!
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/watch/al/${animeId}/${newEpNotice}`}>
                  <button className="text-[9px] font-mono px-2 py-0.5 bg-green-500 text-black font-bold hover:bg-green-400 transition-colors">
                    WATCH
                  </button>
                </Link>
                <button
                  onClick={() => setNewEpNotice(null)}
                  className="text-white/30 hover:text-white/70 text-xs leading-none transition-colors"
                >
                  ×
                </button>
              </div>
            </div>
          )}

          {/* Episodes scroll */}
          <div ref={epListRef} className="overflow-y-auto flex-1 max-h-[600px] xl:max-h-[calc(100vh-200px)]">
            {/* Jikan loading indicator */}
            {jikanLoading && (
              <div className="flex items-center gap-2 px-4 py-2 text-[10px] font-mono text-white/25 border-b border-white/5">
                <div className="w-2.5 h-2.5 border border-white/20 border-t-white/60 rounded-full animate-spin" />
                Loading episode data...
              </div>
            )}
            {epGridView ? (
              <div className="grid grid-cols-4 gap-1 p-2">
                {filteredEps.map((ep) => {
                  const active = ep === currentEp;
                  const watched = isWatched(ep);
                  const filler = isEpFiller(ep);
                  const progressPct = !active && !watched ? getEpisodeProgressPct(`al_${animeId}_${ep}`) : null;
                  return (
                    <Link key={ep} href={`/watch/al/${animeId}/${ep}`}>
                      <div
                        data-active={active}
                        title={getEpTitle(ep)}
                        className={`aspect-square flex items-center justify-center text-xs font-mono cursor-pointer transition-colors border relative overflow-hidden ${
                          active
                            ? "bg-white text-black border-white font-bold"
                            : filler
                            ? "border-white/10 text-white/25 bg-white/[0.03] italic"
                            : watched
                            ? "border-white/10 text-white/30 bg-white/5"
                            : "border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        {ep}
                        {filler && !active && (
                          <span className="absolute top-0.5 right-0.5 text-[6px] text-yellow-500/60">F</span>
                        )}
                        {progressPct !== null && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
                            <div className="h-full bg-blue-400/70" style={{ width: `${progressPct * 100}%` }} />
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {filteredEps.map((ep) => {
                  const active = ep === currentEp;
                  const watched = isWatched(ep);
                  const thumb = getEpThumb(ep);
                  const epTitle = getEpTitle(ep);
                  const aired = getEpAired(ep);
                  const score = getEpScore(ep);
                  const filler = isEpFiller(ep);
                  const recap = isEpRecap(ep);
                  const progressPct = !active && !watched ? getEpisodeProgressPct(`al_${animeId}_${ep}`) : null;
                  return (
                    <Link key={ep} href={`/watch/al/${animeId}/${ep}`}>
                      <div
                        data-active={active}
                        className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                          active ? "bg-white/10" : "hover:bg-white/5"
                        }`}
                      >
                        {/* Thumbnail */}
                        <div className="relative w-24 h-14 shrink-0 overflow-hidden bg-zinc-900">
                          <img
                            src={thumb}
                            alt={`EP ${ep}`}
                            className="w-full h-full object-cover"
                          />
                          {active && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                              <Play className="w-5 h-5 text-white fill-white" />
                            </div>
                          )}
                          {watched && !active && (
                            <div className="absolute bottom-0.5 right-0.5">
                              <span className="text-[8px] font-mono bg-black/70 text-white/60 px-1">✓</span>
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5 flex items-center justify-between">
                            <span className="text-[8px] font-mono text-white/60">{ep}</span>
                            {score && (
                              <span className="text-[8px] font-mono text-white/50">★{score.toFixed(1)}</span>
                            )}
                          </div>
                          {progressPct !== null && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5">
                              <div className="h-full bg-blue-400" style={{ width: `${progressPct * 100}%` }} />
                            </div>
                          )}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-start gap-1.5 flex-wrap mb-0.5">
                            {filler && (
                              <span className="text-[8px] font-mono bg-yellow-500/20 text-yellow-400/80 px-1 py-0.5 shrink-0">FILLER</span>
                            )}
                            {recap && (
                              <span className="text-[8px] font-mono bg-white/10 text-white/40 px-1 py-0.5 shrink-0">RECAP</span>
                            )}
                          </div>
                          <p className={`text-[11px] font-medium line-clamp-2 leading-snug ${
                            active ? "text-white" : watched ? "text-white/40" : "text-white/80"
                          }`}>
                            {epTitle !== `Episode ${ep}` ? `${ep}. ${epTitle}` : <span className={active ? "text-white/60" : "text-white/35"}>Episode {ep}</span>}
                          </p>
                          {aired && (
                            <p className="text-[9px] font-mono text-white/25 mt-0.5">Aired: {aired}</p>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
