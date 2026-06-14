import { useState, useEffect, useRef } from "react";
import { Link, useParams, useLocation } from "wouter";
import {
  ArrowLeft, Search, Grid3X3, List, Play, Pause, SkipForward, SkipBack,
  RotateCcw, RotateCw, Scissors, Bookmark, BookmarkCheck, ChevronDown,
  MessageSquare, ThumbsUp, ThumbsDown, CornerDownRight, Eye,
  Volume2, VolumeX, Maximize, Minimize,
} from "lucide-react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import { apiUrl } from "@/lib/api";

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

async function fetchAllJikanEpisodes(malId: number, totalEps: number): Promise<JikanEpisode[]> {
  const all: JikanEpisode[] = [];
  const maxPages = Math.ceil(Math.max(totalEps, 1) / 25) || 4;
  for (let page = 1; page <= Math.min(maxPages, 8); page++) {
    try {
      const r = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`);
      const json = await r.json();
      const batch: JikanEpisode[] = json?.data ?? [];
      all.push(...batch);
      if (!json?.pagination?.has_next_page) break;
      await new Promise((res) => setTimeout(res, 350));
    } catch { break; }
  }
  return all;
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

interface Comment {
  id: string;
  author: string;
  text: string;
  ts: number;
  likes: number;
}

function useLocalComments(key: string) {
  const [comments, setComments] = useState<Comment[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
  });
  const save = (next: Comment[]) => {
    setComments(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  return { comments, save };
}

export default function WatchAniList() {
  const params = useParams<{ animeId: string; episode: string }>();
  const animeId = parseInt(params.animeId ?? "0");
  const currentEp = parseInt((params.episode ?? "1").replace(/^ep-?/i, ""));
  const [, navigate] = useLocation();

  const [anime, setAnime] = useState<AniMedia | null>(null);
  const [jikanEps, setJikanEps] = useState<JikanEpisode[]>([]);
  const [jikanLoading, setJikanLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<"SUB" | "DUB">("SUB");
  const [server, setServer] = useState<"GOGO" | "KOTO" | "ANIZONE" | "CUSTOM">("GOGO");
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
  const [epSearch, setEpSearch] = useState("");
  const [epGridView, setEpGridView] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentAuthor, setCommentAuthor] = useState(() => localStorage.getItem("na_username") ?? "");
  const [commentSort, setCommentSort] = useState<"Best" | "Newest" | "Oldest">("Newest");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const epListRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [cdnUrl, setCdnUrl] = useState<string | null>(null);
  const [cdnLoading, setCdnLoading] = useState(false);
  const [cdnNotFound, setCdnNotFound] = useState(false);
  const [kotoSlug, setKotoSlug] = useState("");
  const [kotoSlugInput, setKotoSlugInput] = useState("");
  const [kotoSearchResults, setKotoSearchResults] = useState<{ slug: string; title: string; thumbnail: string }[]>([]);
  const [kotoSearching, setKotoSearching] = useState(false);
  const [kotoSearchDone, setKotoSearchDone] = useState(false);
  const [kotoPlayerUrl, setKotoPlayerUrl] = useState<string | null>(null);
  const [kotoPlayerLoading, setKotoPlayerLoading] = useState(false);
  const [kotoPlayerError, setKotoPlayerError] = useState<string | null>(null);
  const [gogoSearchResults, setGogoSearchResults] = useState<{ slug: string; title: string; thumbnail: string }[]>([]);
  const [gogoSearching, setGogoSearching] = useState(false);
  const [gogoSearchDone, setGogoSearchDone] = useState(false);
  const [videoState, setVideoState] = useState({ paused: true, time: 0, duration: 0, buffered: 0, volume: 1, muted: false });
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const [newEpNotice, setNewEpNotice] = useState<number | null>(null);
  const prevNextAiringEpRef = useRef<number | null>(null);
  const [countdownSecs, setCountdownSecs] = useState<number | null>(null);

  const { toggle, isInList } = useWatchlist();
  const { markWatched, isWatched } = useWatchProgress();
  const { markProgress } = useContinueWatching();
  const saved = isInList(animeId);

  const { comments, save: saveComments } = useLocalComments(`na_comments_al_${animeId}`);

  useEffect(() => {
    if (!animeId) return;
    setLoading(true);
    setJikanEps([]);
    setNewEpNotice(null);
    prevNextAiringEpRef.current = null;
    fetch("https://graphql.anilist.co", {
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
            fetchAllJikanEpisodes(media.idMal, media.episodes ?? 0)
              .then(setJikanEps)
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
        const r = await fetch("https://graphql.anilist.co", {
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
            fetchAllJikanEpisodes(media.idMal, media.episodes ?? 0)
              .then(setJikanEps)
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
    markWatched(currentEp, animeId);
    const t = anime.title.english || anime.title.romaji || "";
    const c = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
    const b = anime.bannerImage || c;
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
    // Reset KOTO player state so stale errors don't persist across episodes/server switches
    setKotoPlayerUrl(null);
    setKotoPlayerLoading(false);
    setKotoPlayerError(null);
  }, [animeId, currentEp, lang, server]);

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
    const saved = localStorage.getItem(`na_anizone_${animeId}`);
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
          localStorage.setItem(`na_anizone_${animeId}`, slug);
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

  // When GOGO server is selected, fetch the CDN player iframe URL from the gogoanimes.cv page
  // so we can embed only the CDN player (with our control bridge) instead of the full site.
  useEffect(() => {
    if (server !== "GOGO" || !gogoSlug) { setCdnUrl(null); setCdnLoading(false); setCdnNotFound(false); return; }
    setCdnUrl(null);
    setCdnLoading(true);
    setCdnNotFound(false);
    setGogoSearchResults([]);
    setGogoSearchDone(false);
    let cancelled = false;
    fetch(apiUrl(`/api/gogo/cdn-url?slug=${encodeURIComponent(gogoSlug)}&ep=${currentEp}`))
      .then((r) => r.json())
      .then((data: { cdnUrl?: string; resolvedSlug?: string }) => {
        if (cancelled) return;
        if (data.cdnUrl) {
          setCdnUrl(data.cdnUrl);
        } else {
          // All slug variants exhausted — mark not-found and auto-search GoGoAnimes by title
          setCdnNotFound(true);
          triggerGogoSearch(title);
        }
        // If the server auto-resolved a different (working) slug, save it so
        // subsequent episodes skip the retry loop entirely.
        if (data.resolvedSlug && data.resolvedSlug !== gogoSlug) {
          setGogoSlug(data.resolvedSlug);
          setGogoSlugInput(data.resolvedSlug);
          localStorage.setItem(`na_gogo_${animeId}`, data.resolvedSlug);
        }
      })
      .catch(() => { if (!cancelled) triggerGogoSearch(title); })
      .finally(() => { if (!cancelled) setCdnLoading(false); });
    return () => { cancelled = true; };
  }, [server, gogoSlug, currentEp, animeId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function triggerKotoSearch(query: string) {
    if (!query) return;
    setKotoSearching(true);
    setKotoSearchDone(false);
    const q = query.replace(/\s*season\s*\d+/i, "").replace(/\s*\d+(st|nd|rd|th)\s*season/i, "").trim();
    fetch(apiUrl(`/api/koto/search?q=${encodeURIComponent(q)}&limit=8`))
      .then((r) => r.json())
      .then((data: { results?: { slug: string; title: string; thumbnail: string }[] }) => {
        const results = data.results ?? [];
        setKotoSearchResults(results);
        // Auto-select first result if slug not yet set
        if (results.length > 0 && !kotoSlug) {
          setKotoSlug(results[0].slug);
          setKotoSlugInput(results[0].slug);
          localStorage.setItem(`na_koto_${animeId}`, results[0].slug);
        }
      })
      .catch(() => { setKotoSearchResults([]); })
      .finally(() => { setKotoSearching(false); setKotoSearchDone(true); });
  }

  function triggerAnizoneSearch(query: string, currentSlug?: string) {
    if (!query) return;
    setAnizoneSearching(true);
    setAnizoneSearchDone(false);
    const q = query.replace(/\s*season\s*\d+/i, "").replace(/\s*\d+(st|nd|rd|th)\s*season/i, "").trim();
    fetch(apiUrl(`/api/anizone/search?q=${encodeURIComponent(q)}&limit=8`))
      .then((r) => r.json())
      .then((data: { results?: { slug: string; title: string; thumbnail: string }[] }) => {
        const results = data.results ?? [];
        setAnizoneSearchResults(results);
        // Auto-select first result if no slug is saved yet
        if (results.length > 0 && !currentSlug) {
          setAnizoneSlug(results[0].slug);
          setAnizoneSlugInput(results[0].slug);
          localStorage.setItem(`na_anizone_${animeId}`, results[0].slug);
        }
      })
      .catch(() => { setAnizoneSearchResults([]); })
      .finally(() => { setAnizoneSearching(false); setAnizoneSearchDone(true); });
  }

  // Pre-search KOTO as soon as the title is known (regardless of current server)
  // so the slug is ready instantly when KOTO is selected or is the default.
  useEffect(() => {
    if (!title || !animeId) return;
    const saved = localStorage.getItem(`na_koto_${animeId}`) ?? "";
    if (saved) { setKotoSlug(saved); setKotoSlugInput(saved); return; }
    triggerKotoSearch(title);
  }, [title, animeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-search AniZone as soon as the title is known so the slug is ready
  // instantly when AniZone is selected, without requiring user interaction.
  useEffect(() => {
    if (!title || !animeId) return;
    const saved = localStorage.getItem(`na_anizone_${animeId}`) ?? "";
    if (saved) { setAnizoneSlug(saved); setAnizoneSlugInput(saved); return; }
    // Also skip if slug already set from externalLinks
    if (anizoneSlug) return;
    triggerAnizoneSearch(title, "");
  }, [title, animeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When KOTO server is selected, ensure slug is loaded (handles server switch)
  useEffect(() => {
    if (server !== "KOTO" || !title) return;
    const saved = localStorage.getItem(`na_koto_${animeId}`) ?? "";
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
      // Anime loaded but has no MAL ID — KOTO mapper can't be used
      setKotoPlayerError("No MAL ID for this anime — KOTO unavailable");
      return;
    }
    setKotoPlayerUrl(null);
    setKotoPlayerLoading(true);
    setKotoPlayerError(null);
    const params = new URLSearchParams({ ep: String(currentEp), malId: String(malId) });
    if (slug) params.set("slug", slug);
    let cancelled = false;
    fetch(apiUrl(`/api/koto/stream?${params}`))
      .then((r) => r.json())
      .then((data: { url?: string; error?: string }) => {
        if (cancelled) return;
        if (data.url) {
          setKotoPlayerUrl(data.url);
        } else {
          setKotoPlayerError(data.error ?? "No player URL found");
        }
      })
      .catch((e: Error) => { if (!cancelled) setKotoPlayerError(e.message); })
      .finally(() => { if (!cancelled) setKotoPlayerLoading(false); });
    return () => { cancelled = true; };
  }, [server, kotoSlug, kotoSearching, anime, currentEp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for video state updates from the proxied CDN player via postMessage bridge
  useEffect(() => {
    const handler = (evt: MessageEvent) => {
      if (evt.data?.type !== "na_video_state") return;
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

  const sortedComments = [...comments].sort((a, b) => {
    if (commentSort === "Best") return b.likes - a.likes;
    if (commentSort === "Oldest") return a.ts - b.ts;
    return b.ts - a.ts;
  });

  const submitComment = () => {
    if (!commentText.trim()) return;
    const author = commentAuthor.trim() || "Anonymous";
    localStorage.setItem("na_username", author);
    setCommentAuthor(author);
    saveComments([
      ...comments,
      { id: crypto.randomUUID(), author, text: commentText.trim(), ts: Date.now(), likes: 0 },
    ]);
    setCommentText("");
  };

  const likeComment = (id: string) => {
    saveComments(comments.map((c) => c.id === id ? { ...c, likes: c.likes + 1 } : c));
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
      {/* Top breadcrumb */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 text-[11px] font-mono uppercase tracking-widest text-white/30">
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
        <div className="hidden xl:flex flex-col w-56 shrink-0 border-r border-white/5 p-4 gap-4">
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
                <iframe
                  ref={iframeRef}
                  key={`${animeId}-${anime.idMal ?? "al"}-${currentEp}-${lang}-${server}-${server === "CUSTOM" ? customUrl : ""}-${server === "GOGO" ? (cdnLoading ? "loading" : (cdnUrl ?? "fallback")) : ""}-${server === "KOTO" ? (kotoPlayerLoading ? "koto-loading" : (kotoPlayerUrl ?? "koto-missing")) : ""}-${server === "ANIZONE" ? (anizoneSlug || "no-slug") : ""}`}
                  src={(() => {
                    if (server === "CUSTOM") return customUrl ? `/api/proxy?url=${encodeURIComponent(customUrl)}` : "about:blank";
                    if (server === "KOTO") {
                      if (kotoPlayerLoading || !kotoPlayerUrl) return "about:blank";
                      return kotoPlayerUrl;
                    }
                    if (server === "ANIZONE") {
                      if (!anizoneSlug) return "about:blank";
                      return `/api/anizone/player?slug=${encodeURIComponent(anizoneSlug)}&ep=${currentEp}`;
                    }
                    // GOGO
                    if (!gogoSlug) return "about:blank";
                    if (cdnLoading) return "about:blank";
                    if (cdnUrl) return cdnUrl;
                    return "about:blank";
                  })()}
                  className="w-full h-full"
                  style={{ opacity: iframeLoaded ? 1 : 0, transition: "opacity 0.5s ease" }}
                  allowFullScreen
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
                  referrerPolicy="no-referrer"
                  title={`${title} Episode ${currentEp}`}
                  onLoad={() => {
                    if (server === "GOGO" && cdnLoading) return;
                    if (server === "KOTO" && (kotoPlayerLoading || !kotoPlayerUrl)) return;
                    if (server === "ANIZONE" && !anizoneSlug) return;
                    setTimeout(() => {
                      setIframeLoaded(true);
                      if (server === "GOGO") setTimeout(() => sendCmd({ na_cmd: "query" }), 600);
                    }, 200);
                  }}
                />


                {!iframeLoaded && (
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
                                : server === "KOTO" && kotoPlayerLoading
                                ? "Fetching AniKoto stream…"
                                : server === "KOTO" && kotoPlayerError
                                ? `AniKoto error: ${kotoPlayerError}`
                                : server === "KOTO" && kotoPlayerUrl
                                ? "Loading AniKoto player…"
                                : server === "KOTO"
                                ? "Fetching AniKoto stream…"
                                : server === "ANIZONE"
                                ? (anizoneSlug ? "Loading AniZone stream…" : "Set a slug in the ANIZONE panel below.")
                                : "Loading, please wait…"}
                            </p>
                            <p className="text-white/30 text-[11px] font-mono mt-1 uppercase tracking-widest">
                              Episode {currentEp} · {lang}
                              {server === "GOGO" && gogoSlug && ` · ${gogoSlug.toUpperCase()}`}
                              {server === "KOTO" && kotoSlug && ` · ${kotoSlug}`}
                              {server === "ANIZONE" && anizoneSlug && ` · ${anizoneSlug}`}
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

          {/* Warning banner */}
          <div className="flex items-center gap-2 px-4 py-2 bg-white/[0.03] border-b border-white/5 text-[10px] text-white/30">
            <MessageSquare className="w-3 h-3 shrink-0" />
            If the episode is not working, please try a different server below.
          </div>

          {/* Player control bar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
            <div className="flex items-center gap-1.5">
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

          {/* "You are watching" + SUB/DUB + Quality */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 border-b border-white/5">
            <div>
              <p className="text-[10px] text-white/30 font-mono uppercase tracking-widest mb-0.5">You are watching</p>
              <p className="text-sm font-semibold text-white">
                Episode {currentEp}
                {epCount > 0 && <span className="text-white/30 font-normal"> / {epCount}</span>}
              </p>
              <p className="text-[10px] text-white/25 mt-0.5">
                If the current server doesn't work, try another server below.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              {/* SUB/DUB toggle */}
              <div className="flex items-center gap-1">
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
              {/* GOGO server */}
              <button
                onClick={() => { setServer("GOGO"); setCdnNotFound(false); setIframeLoaded(false); }}
                className={`text-[10px] font-mono px-2.5 py-1 border transition-colors ${
                  server === "GOGO"
                    ? "border-orange-400 bg-orange-400 text-black"
                    : "border-orange-400/30 text-orange-400/60 hover:border-orange-400/70 hover:text-orange-400"
                }`}
              >
                GOGO
              </button>
              {/* KOTO server */}
              <button
                onClick={() => { setServer("KOTO"); setIframeLoaded(false); }}
                className={`text-[10px] font-mono px-2.5 py-1 border transition-colors ${
                  server === "KOTO"
                    ? "border-teal-400 bg-teal-400 text-black"
                    : "border-teal-400/30 text-teal-400/60 hover:border-teal-400/70 hover:text-teal-400"
                }`}
              >
                KOTO
              </button>
              {/* AniZone server */}
              <button
                onClick={() => { setServer("ANIZONE"); setIframeLoaded(false); }}
                className={`text-[10px] font-mono px-2.5 py-1 border transition-colors ${
                  server === "ANIZONE"
                    ? "border-blue-400 bg-blue-400 text-black"
                    : "border-blue-400/30 text-blue-400/60 hover:border-blue-400/70 hover:text-blue-400"
                }`}
              >
                ANIZONE
              </button>
            </div>
          </div>

          {/* GOGO panel */}
          {server === "GOGO" && (
            <div className="border-b border-white/5 bg-orange-400/[0.03] px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-orange-400/60 uppercase tracking-widest shrink-0 w-16">Slug</span>
                <input
                  value={gogoSlugInput}
                  onChange={(e) => setGogoSlugInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const s = gogoSlugInput.trim();
                      setGogoSlug(s);
                      localStorage.setItem(`na_gogo_${animeId}`, s);
                      setIframeLoaded(false);
                    }
                  }}
                  placeholder="e.g. rezero-starting-life-in-another-world-season-4"
                  className="flex-1 bg-white/5 border border-orange-400/20 px-3 py-1.5 text-xs text-white placeholder-white/15 focus:outline-none focus:border-orange-400/50 font-mono"
                />
                <button
                  onClick={() => {
                    const s = gogoSlugInput.trim();
                    setGogoSlug(s);
                    localStorage.setItem(`na_gogo_${animeId}`, s);
                    setIframeLoaded(false);
                  }}
                  className="text-[10px] font-mono px-2.5 py-1.5 border border-orange-400/30 text-orange-400/60 hover:border-orange-400 hover:text-orange-400 transition-colors shrink-0"
                >
                  Load
                </button>
                <button
                  onClick={() => triggerGogoSearch(title)}
                  disabled={gogoSearching}
                  title="Search GogoAnimes by title"
                  className="text-[10px] font-mono px-2.5 py-1.5 border border-orange-400/20 text-orange-400/40 hover:border-orange-400/60 hover:text-orange-400/80 transition-colors shrink-0 disabled:opacity-40"
                >
                  {gogoSearching ? "…" : "Search"}
                </button>
              </div>
              {gogoSlug ? (
                <p className="text-[10px] font-mono text-orange-400/40 pl-[72px]">
                  → gogoanimes.cv/{gogoSlug}-episode-{currentEp}/
                </p>
              ) : (
                <p className="text-[10px] font-mono text-white/20 pl-[72px]">
                  Enter the show slug from the gogoanimes.cv URL and press Load.
                </p>
              )}

              {/* Search results */}
              {gogoSearching && (
                <div className="pl-[72px] flex items-center gap-2 pt-1">
                  <div className="w-3 h-3 border border-orange-400/40 border-t-orange-400 rounded-full animate-spin" />
                  <span className="text-[10px] font-mono text-orange-400/50">Searching GogoAnimes…</span>
                </div>
              )}
              {!gogoSearching && gogoSearchDone && gogoSearchResults.length > 0 && (
                <div className="pl-[72px] pt-1 space-y-1">
                  <p className="text-[9px] font-mono text-orange-400/40 uppercase tracking-widest mb-1.5">
                    {gogoSearchResults.length} match{gogoSearchResults.length !== 1 ? "es" : ""} found — pick one to load:
                  </p>
                  <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto pr-1">
                    {gogoSearchResults.map((r) => (
                      <button
                        key={r.slug}
                        onClick={() => {
                          setGogoSlug(r.slug);
                          setGogoSlugInput(r.slug);
                          localStorage.setItem(`na_gogo_${animeId}`, r.slug);
                          setIframeLoaded(false);
                          setGogoSearchResults([]);
                          setGogoSearchDone(false);
                        }}
                        className="flex items-center gap-2 text-left px-2 py-1.5 hover:bg-orange-400/10 border border-transparent hover:border-orange-400/20 transition-colors group"
                      >
                        {r.thumbnail && (
                          <img
                            src={r.thumbnail}
                            alt=""
                            className="w-8 h-11 object-cover shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-[11px] text-white/80 group-hover:text-white truncate">{r.title}</p>
                          <p className="text-[9px] font-mono text-orange-400/40 group-hover:text-orange-400/70 truncate">{r.slug}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!gogoSearching && gogoSearchDone && gogoSearchResults.length === 0 && (
                <p className="pl-[72px] text-[10px] font-mono text-white/20 pt-1">
                  No matches found. Try editing the slug manually above.
                </p>
              )}
            </div>
          )}

          {/* KOTO panel */}
          {server === "KOTO" && (
            <div className="border-b border-white/5 bg-teal-400/[0.03] px-4 py-3 space-y-2">
              {/* Stream status row */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-teal-400/60 uppercase tracking-widest shrink-0 w-16">Stream</span>
                {kotoPlayerLoading && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border border-teal-400/40 border-t-teal-400 rounded-full animate-spin" />
                    <span className="text-[10px] font-mono text-teal-400/50">Fetching via mapper…</span>
                  </div>
                )}
                {!kotoPlayerLoading && kotoPlayerUrl && (
                  <span className="text-[10px] font-mono text-teal-400/70 truncate">✓ CDN stream ready</span>
                )}
                {!kotoPlayerLoading && kotoPlayerError && (
                  <span className="text-[10px] font-mono text-red-400/70 truncate">{kotoPlayerError}</span>
                )}
                {!kotoPlayerLoading && !kotoPlayerUrl && !kotoPlayerError && !anime?.idMal && (
                  <span className="text-[10px] font-mono text-white/30">No MAL ID — KOTO unavailable for this title</span>
                )}
              </div>

              {/* Retry button on error */}
              {kotoPlayerError && anime?.idMal && (
                <div className="pl-[72px] pt-0.5">
                  <button
                    onClick={() => {
                      setKotoPlayerUrl(null);
                      setKotoPlayerLoading(true);
                      setKotoPlayerError(null);
                      fetch(apiUrl(`/api/koto/stream?malId=${anime.idMal}&ep=${currentEp}`))
                        .then((r) => r.json())
                        .then((data: { url?: string; error?: string }) => {
                          if (data.url) setKotoPlayerUrl(data.url);
                          else setKotoPlayerError(data.error ?? "No player URL found");
                        })
                        .catch((e: Error) => setKotoPlayerError(e.message))
                        .finally(() => setKotoPlayerLoading(false));
                    }}
                    className="text-[10px] font-mono px-2.5 py-1 border border-teal-400/30 text-teal-400/60 hover:border-teal-400 hover:text-teal-400 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ANIZONE panel */}
          {server === "ANIZONE" && (
            <div className="border-b border-white/5 bg-blue-400/[0.03] px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-blue-400/60 uppercase tracking-widest shrink-0 w-16">Slug</span>
                <input
                  value={anizoneSlugInput}
                  onChange={(e) => setAnizoneSlugInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const s = anizoneSlugInput.trim();
                      setAnizoneSlug(s);
                      localStorage.setItem(`na_anizone_${animeId}`, s);
                      setIframeLoaded(false);
                    }
                  }}
                  placeholder="e.g. 3rvkiqfs  (from anizone.to/anime/...)"
                  className="flex-1 bg-white/5 border border-blue-400/20 px-3 py-1.5 text-xs text-white placeholder-white/15 focus:outline-none focus:border-blue-400/50 font-mono"
                />
                <button
                  onClick={() => {
                    const s = anizoneSlugInput.trim();
                    setAnizoneSlug(s);
                    localStorage.setItem(`na_anizone_${animeId}`, s);
                    setIframeLoaded(false);
                  }}
                  className="text-[10px] font-mono px-2.5 py-1.5 border border-blue-400/30 text-blue-400/60 hover:border-blue-400 hover:text-blue-400 transition-colors shrink-0"
                >
                  Load
                </button>
                <button
                  onClick={() => triggerAnizoneSearch(title)}
                  disabled={anizoneSearching}
                  className="text-[10px] font-mono px-2.5 py-1.5 border border-blue-400/20 text-blue-400/40 hover:border-blue-400/60 hover:text-blue-400/80 transition-colors shrink-0 disabled:opacity-40"
                >
                  {anizoneSearching ? "…" : "Search"}
                </button>
              </div>
              {anizoneSlug ? (
                <p className="text-[10px] font-mono text-blue-400/40 pl-[72px]">
                  → anizone.to/anime/{anizoneSlug}/ep-{currentEp}
                </p>
              ) : (
                <p className="text-[10px] font-mono text-white/20 pl-[72px]">
                  Press Search to find the slug, or paste it from anizone.to/anime/…
                </p>
              )}

              {/* Search loading */}
              {anizoneSearching && (
                <div className="pl-[72px] flex items-center gap-2 pt-1">
                  <div className="w-3 h-3 border border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />
                  <span className="text-[10px] font-mono text-blue-400/50">Searching anizone.to…</span>
                </div>
              )}

              {/* Search results */}
              {!anizoneSearching && anizoneSearchDone && anizoneSearchResults.length > 0 && (
                <div className="pl-[72px] pt-1 space-y-1">
                  <p className="text-[9px] font-mono text-blue-400/40 uppercase tracking-widest mb-1.5">
                    {anizoneSearchResults.length} match{anizoneSearchResults.length !== 1 ? "es" : ""} — pick one to load:
                  </p>
                  <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto pr-1">
                    {anizoneSearchResults.map((r) => (
                      <button
                        key={r.slug}
                        onClick={() => {
                          setAnizoneSlug(r.slug);
                          setAnizoneSlugInput(r.slug);
                          localStorage.setItem(`na_anizone_${animeId}`, r.slug);
                          setIframeLoaded(false);
                          setAnizoneSearchResults([]);
                          setAnizoneSearchDone(false);
                        }}
                        className="flex items-center gap-2 text-left px-2 py-1.5 hover:bg-blue-400/10 border border-transparent hover:border-blue-400/20 transition-colors group"
                      >
                        {r.thumbnail && (
                          <img src={r.thumbnail} alt="" className="w-8 h-11 object-cover shrink-0 opacity-70 group-hover:opacity-100 transition-opacity" />
                        )}
                        <div className="min-w-0">
                          <p className="text-[11px] text-white/80 group-hover:text-white truncate">{r.title}</p>
                          <p className="text-[9px] font-mono text-blue-400/40 group-hover:text-blue-400/70 truncate">{r.slug}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!anizoneSearching && anizoneSearchDone && anizoneSearchResults.length === 0 && (
                <p className="pl-[72px] text-[10px] font-mono text-white/20 pt-1">
                  No matches found. Try a shorter title or paste the slug directly from anizone.to.
                </p>
              )}
            </div>
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

          {/* ── BELOW PLAYER: Comments + Related ── */}
          <div className="flex flex-col lg:flex-row gap-0">
            {/* Comments */}
            <div className="flex-1 min-w-0 px-4 sm:px-6 py-6 border-r border-white/5">
              <div className="flex items-center gap-2 mb-5">
                <h3 className="text-base font-semibold text-white uppercase tracking-wide">Comments</h3>
                <span className="text-[10px] font-mono bg-white/10 text-white/60 px-2 py-0.5">{comments.length}</span>
                <div className="ml-auto flex gap-1">
                  {(["Best", "Newest", "Oldest"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setCommentSort(s)}
                      className={`text-[10px] font-mono px-3 py-1 border transition-colors ${
                        commentSort === s
                          ? "border-white bg-white text-black"
                          : "border-white/10 text-white/40 hover:text-white hover:border-white/30"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Write comment */}
              <div className="mb-6 space-y-2">
                <input
                  value={commentAuthor}
                  onChange={(e) => setCommentAuthor(e.target.value)}
                  placeholder="Your name (optional)"
                  className="w-full bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-white/30"
                />
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => { if (e.ctrlKey && e.key === "Enter") submitComment(); }}
                  placeholder="Write your comment..."
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-white/30 resize-none"
                />
                <button
                  onClick={submitComment}
                  className="px-5 py-2 bg-white text-black text-xs font-mono uppercase tracking-widest hover:bg-white/90 transition-colors"
                >
                  Post
                </button>
              </div>

              {/* Comment list */}
              <div className="space-y-5">
                {sortedComments.length === 0 && (
                  <p className="text-white/20 text-xs font-mono">No comments yet. Be the first!</p>
                )}
                {sortedComments.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center shrink-0 text-[10px] font-mono text-white/50 uppercase">
                      {c.author[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-white">{c.author}</span>
                        <span className="text-[9px] font-mono text-white/25">
                          {new Date(c.ts).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs text-white/70 leading-relaxed">{c.text}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <button
                          onClick={() => likeComment(c.id)}
                          className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white transition-colors"
                        >
                          <ThumbsUp className="w-3 h-3" />
                          {c.likes > 0 && <span>{c.likes}</span>}
                        </button>
                        <button className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white transition-colors">
                          <CornerDownRight className="w-3 h-3" />
                          Reply
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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

        {/* ── RIGHT: Episode list ── */}
        <div className="xl:w-80 shrink-0 border-l border-white/5 flex flex-col">
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
                  return (
                    <Link key={ep} href={`/watch/al/${animeId}/${ep}`}>
                      <div
                        data-active={active}
                        title={getEpTitle(ep)}
                        className={`aspect-square flex items-center justify-center text-xs font-mono cursor-pointer transition-colors border relative ${
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
                            {ep}. {epTitle}
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
