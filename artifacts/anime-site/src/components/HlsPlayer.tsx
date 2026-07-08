import { useEffect, useRef, useState, useCallback } from "react";
import { apiUrl } from "@/lib/api";
import Hls, { type Level } from "hls.js";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipForward, SkipBack, Settings, Captions, Loader2,
  AlertTriangle, RotateCcw, Languages, Download, Mic,
  Camera, Gauge, PictureInPicture2, Repeat, List, ChevronDown, X, Search,
} from "lucide-react";

const HOLD_THRESHOLD_MS = 350;
const HOLD_SPEED = 2;
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const TRANSLATE_LANGS = [
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "it", name: "Italian" },
  { code: "ru", name: "Russian" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "tr", name: "Turkish" },
  { code: "ko", name: "Korean" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "ja", name: "Japanese" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "pl", name: "Polish" },
  { code: "nl", name: "Dutch" },
  { code: "sv", name: "Swedish" },
  { code: "uk", name: "Ukrainian" },
];

interface SubTrack {
  src: string;
  label: string;
  srclang: string;
  isDefault: boolean;
}

export type HlsSyncCommand = {
  type: "play" | "pause" | "seek";
  time: number;
  nonce: string;
};

interface EpisodePickerItem {
  number: number;
  title: string;
  thumbnail?: string;
  description?: string;
}

interface Props {
  hlsUrl: string;
  subtitles?: SubTrack[];
  title?: string;
  progressKey?: string;
  preferDub?: boolean;
  onEnded?: () => void;
  onFatalError?: () => void;
  onPlayStateChange?: (playing: boolean, time: number) => void;
  onTimeUpdate?: (time: number) => void;
  onSeek?: (time: number) => void;
  onBuffering?: (isBuffering: boolean) => void;
  syncCommand?: HlsSyncCommand | null;
  episodes?: EpisodePickerItem[];
  currentEpisode?: number;
  onEpisodeSelect?: (ep: number) => void;
  animeCover?: string;
  animeLogo?: string;
  epMeta?: string;
  epDescription?: string;
}

interface SavedProgress {
  position: number;
  duration: number;
  ts: number;
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function loadProgress(key: string): SavedProgress | null {
  try {
    const raw = localStorage.getItem(`watch_progress_${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as SavedProgress;
  } catch { return null; }
}

function saveProgress(key: string, position: number, duration: number) {
  try {
    if (position < 5 || duration <= 0) return;
    const data: SavedProgress = { position, duration, ts: Date.now() };
    localStorage.setItem(`watch_progress_${key}`, JSON.stringify(data));
  } catch { /* ignore */ }
}

function clearProgress(key: string) {
  try { localStorage.removeItem(`watch_progress_${key}`); } catch { /* ignore */ }
}

export function getEpisodeProgressPct(progressKey: string): number | null {
  const p = loadProgress(progressKey);
  if (!p || p.duration <= 0) return null;
  const pct = p.position / p.duration;
  if (pct < 0.02 || pct > 0.97) return null;
  return pct;
}

export default function HlsPlayer({ hlsUrl, subtitles = [], title, progressKey, preferDub = false, onEnded, onFatalError, onPlayStateChange, onTimeUpdate: onTimeUpdateProp, onSeek, onBuffering, syncCommand, episodes, currentEpisode, onEpisodeSelect, animeCover, animeLogo, epMeta, epDescription }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedAt = useRef<number>(0);
  // Prevents re-broadcasting WT-triggered play/pause/seek back to the room
  const suppressWtBroadcastRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wtPlayBlocked, setWtPlayBlocked] = useState(false);
  const [levels, setLevels] = useState<Level[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [showSettings, setShowSettings] = useState(false);
  const [showSubs, setShowSubs] = useState(false);
  const [activeSub, setActiveSub] = useState<string | null>(
    subtitles.find((s) => s.isDefault)?.src ?? (subtitles.length === 1 ? subtitles[0].src : null)
  );
  const [resumeToast, setResumeToast] = useState<string | null>(null);
  const [audioTracks, setAudioTracks] = useState<{ name: string; lang: string }[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState(-1);
  const [showAudio, setShowAudio] = useState(false);
  const [translateLang, setTranslateLang] = useState("es");
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [currentTranslatedVtt, setCurrentTranslatedVtt] = useState<string | null>(null);
  const translatedCacheRef = useRef<Map<string, string>>(new Map());
  const translatedTextCacheRef = useRef<Map<string, string>>(new Map());
  const blobUrlsRef = useRef<string[]>([]);
  const [holding, setHolding] = useState(false);
  const [flash, setFlash] = useState(false);
  const [screenshotError, setScreenshotError] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenshotErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdActivated = useRef(false);
  const wasPlayingBeforeHold = useRef(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeed, setShowSpeed] = useState(false);
  const [looping, setLooping] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [showEpisodePicker, setShowEpisodePicker] = useState(false);
  const [epQuery, setEpQuery] = useState("");
  const episodePickerRef = useRef<HTMLDivElement>(null);
  const episodeTriggerRef = useRef<HTMLButtonElement>(null);
  const episodeListRef = useRef<HTMLDivElement>(null);

  // Hover scrub-preview thumbnail
  const seekBarRef = useRef<HTMLDivElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewHlsRef = useRef<Hls | null>(null);
  const previewSeekDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [previewX, setPreviewX] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);

  // Close episode panel when clicking outside (but not on the trigger button)
  useEffect(() => {
    if (!showEpisodePicker) return;
    const handler = (e: MouseEvent) => {
      if (
        episodePickerRef.current?.contains(e.target as Node) ||
        episodeTriggerRef.current?.contains(e.target as Node)
      ) return;
      setShowEpisodePicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEpisodePicker]);

  // Auto-scroll episode list to current episode when panel opens
  useEffect(() => {
    if (!showEpisodePicker || currentEpisode == null) return;
    const el = episodeListRef.current?.querySelector(`[data-ep="${currentEpisode}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [showEpisodePicker, currentEpisode]);

  // Keep controls visible while episode panel is open
  useEffect(() => {
    if (!showEpisodePicker) return;
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, [showEpisodePicker]);

  // Cleanup any hold/flash/error timers on unmount so stale callbacks never
  // mutate state after the component is gone.
  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (screenshotErrorTimer.current) clearTimeout(screenshotErrorTimer.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const translateSubtitles = useCallback(async (lang: string, langName: string) => {
    const sourceSrc = activeSub ?? subtitles[0]?.src;
    if (!sourceSrc) return;
    const cacheKey = `${sourceSrc}::${lang}`;
    const cached = translatedCacheRef.current.get(cacheKey);
    if (cached) { setActiveSub(cached); return; }
    setTranslating(true);
    setTranslateError(null);
    try {
      const resp = await fetch(apiUrl("/api/translate-subtitle"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vttUrl: sourceSrc, targetLang: lang, targetLangName: langName }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      const { vtt } = await resp.json() as { vtt: string };
      const blob = new Blob([vtt], { type: "text/vtt" });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlsRef.current.push(blobUrl);
      translatedCacheRef.current.set(cacheKey, blobUrl);
      translatedTextCacheRef.current.set(cacheKey, vtt);
      setCurrentTranslatedVtt(vtt);
      setActiveSub(blobUrl);
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : "Translation failed");
      setTimeout(() => setTranslateError(null), 5000);
    } finally {
      setTranslating(false);
    }
  }, [activeSub, subtitles]);

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!document.fullscreenElement && !containerRef.current?.matches(":hover")) return;
      setShowControls(false);
    }, 3000);
  }, []);

  const flushProgress = useCallback(() => {
    const video = videoRef.current;
    if (!progressKey || !video || video.currentTime < 5 || video.duration <= 0) return;
    const pct = video.currentTime / video.duration;
    if (pct > 0.97) {
      clearProgress(progressKey);
    } else {
      saveProgress(progressKey, video.currentTime, video.duration);
    }
    lastSavedAt.current = Date.now();
  }, [progressKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    let mounted = true;

    setError(null);
    setLoading(true);
    setLevels([]);
    setCurrentLevel(-1);
    setResumeToast(null);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Chrome rejects mp4a.40.1 (AAC Main Profile) in MediaSource.addSourceBuffer().
    // HLS.js 1.6+ uses ManagedMediaSource by default (Chrome 107+), which has its own
    // prototype — patch both, and force preferManagedMediaSource:false so the codec
    // compat-name remapping in HLS.js targets the patched MediaSource path.
    let _origASB: typeof MediaSource.prototype.addSourceBuffer | null = null;
    let _origMASB: typeof MediaSource.prototype.addSourceBuffer | null = null;
    const _asbPatcher = function (this: MediaSource, mimeType: string): SourceBuffer {
      // Miruro CDN audio is labelled mp4a.40.1 (AAC Main) but Chrome's MSE refuses
      // to create a SourceBuffer for that codec identifier; remap to mp4a.40.2 (AAC-LC).
      // The actual audio bitstream is compatible — this is a metadata-only fix.
      return _origASB!.call(this, mimeType.replace("mp4a.40.1", "mp4a.40.2"));
    };
    if (Hls.isSupported() && typeof MediaSource !== "undefined") {
      _origASB = MediaSource.prototype.addSourceBuffer;
      MediaSource.prototype.addSourceBuffer = _asbPatcher;
    }
    if (typeof (window as Window & {ManagedMediaSource?: {prototype: MediaSource}}).ManagedMediaSource !== "undefined") {
      const mms = (window as Window & {ManagedMediaSource: {prototype: MediaSource}}).ManagedMediaSource;
      _origMASB = mms.prototype.addSourceBuffer;
      _origASB = _origASB ?? _origMASB;
      mms.prototype.addSourceBuffer = _asbPatcher;
    }

    if (Hls.isSupported()) {

      const hls = new Hls({ enableWorker: false, startLevel: -1, maxBufferLength: 30, preferManagedMediaSource: false });
      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        if (!mounted) return;
        setLevels(data.levels);
        setLoading(false);

        // ── Audio track selection for DUB / SUB ────────────────────────────
        // AniZone HLS streams embed multiple audio tracks (e.g. Japanese + English).
        // When preferDub=true, find the English track and activate it.
        // When preferDub=false (SUB), find Japanese track or fall back to track 0.
        const tracks = hls.audioTracks;
        if (tracks && tracks.length > 0) {
          setAudioTracks(tracks.map((t) => ({ name: t.name || t.lang || "Track", lang: t.lang || "" })));
          setActiveAudioTrack(hls.audioTrack);
        }
        if (tracks && tracks.length > 1) {
          const targetLang = preferDub ? "en" : "ja";
          const targetIdx = tracks.findIndex(
            (t) =>
              (t.lang && t.lang.toLowerCase().startsWith(targetLang)) ||
              (t.name && t.name.toLowerCase().includes(preferDub ? "english" : "japanese"))
          );
          if (targetIdx >= 0) {
            hls.audioTrack = targetIdx;
          } else if (!preferDub) {
            hls.audioTrack = 0;
          }
        }

        if (progressKey) {
          const saved = loadProgress(progressKey);
          const vidDuration = video.duration || data.levels[0]?.details?.totalduration;
          if (saved && saved.position > 5) {
            const effectiveDuration = vidDuration || saved.duration;
            const pct = saved.position / (effectiveDuration || saved.duration);
            if (pct < 0.95) {
              video.currentTime = saved.position;
              const remaining = saved.duration > 0
                ? `${fmtTime(saved.duration - saved.position)} remaining`
                : "";
              setResumeToast(`Resumed from ${fmtTime(saved.position)}${remaining ? " · " + remaining : ""}`);
              setTimeout(() => setResumeToast(null), 4000);
            }
          }
        }

        if (mounted) video.play().catch(() => {});
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setCurrentLevel(data.level);
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        if (mounted) setActiveAudioTrack(data.id);
      });

      // AUDIO_TRACKS_UPDATED fires after the master manifest is fully parsed
      // and is the reliable point where hls.audioTracks is populated.
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        if (!mounted) return;
        const atracks = hls.audioTracks;
        if (!atracks || atracks.length === 0) return;
        setAudioTracks(atracks.map((t) => ({ name: t.name || t.lang || "Track", lang: t.lang || "" })));
        setActiveAudioTrack(hls.audioTrack);

        // Apply initial DUB/SUB preference now that tracks are confirmed available
        if (atracks.length > 1) {
          const targetLang = preferDub ? "en" : "ja";
          const targetIdx = atracks.findIndex(
            (t) =>
              (t.lang && t.lang.toLowerCase().startsWith(targetLang)) ||
              (t.name && t.name.toLowerCase().includes(preferDub ? "english" : "japanese"))
          );
          if (targetIdx >= 0) hls.audioTrack = targetIdx;
          else if (!preferDub) hls.audioTrack = 0;
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.error('[HLS] Fatal error:', data.type, data.details, (data as {mimeType?: string}).mimeType, (data as {sourceBufferName?: string}).sourceBufferName);
          setError(data.details ?? "Stream error");
          setLoading(false);
          onFatalError?.();
        } else {
          console.warn('[HLS] Non-fatal error:', data.type, data.details);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      video.addEventListener("loadedmetadata", () => {
        if (!mounted) return;
        setLoading(false);
        if (progressKey) {
          const saved = loadProgress(progressKey);
          if (saved && saved.position > 5 && video.duration > 0 && saved.position / video.duration < 0.95) {
            video.currentTime = saved.position;
            setResumeToast(`Resumed from ${fmtTime(saved.position)}`);
            setTimeout(() => setResumeToast(null), 4000);
          }
        }
      }, { once: true });
    } else {
      setError("Your browser does not support HLS playback.");
      setLoading(false);
    }

    return () => {
      mounted = false;
      flushProgress();
      // Restore original addSourceBuffer if we patched it
      if (_origASB !== null && typeof MediaSource !== "undefined") {
        MediaSource.prototype.addSourceBuffer = _origASB;
        _origASB = null;
      }
      if (_origMASB !== null) {
        const mms = (window as Window & {ManagedMediaSource?: {prototype: MediaSource}}).ManagedMediaSource;
        if (mms) mms.prototype.addSourceBuffer = _origMASB;
        _origMASB = null;
      }
      // Pause first to cancel any in-flight play() promise before destroying
      try { video.pause(); } catch (_) {}
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [hlsUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hover scrub-preview: a second, muted, lowest-quality HLS decode used only
  // to draw a frame into a canvas when hovering the seek bar. Kept independent
  // from the main playback pipeline so seeking it never disturbs the viewer.
  useEffect(() => {
    const pv = previewVideoRef.current;
    if (!pv || !hlsUrl) return;
    let mounted = true;

    if (previewHlsRef.current) {
      previewHlsRef.current.destroy();
      previewHlsRef.current = null;
    }
    setPreviewReady(false);

    if (Hls.isSupported()) {
      const phls = new Hls({ enableWorker: false, startLevel: 0, capLevelToPlayerSize: false, maxBufferLength: 5 });
      previewHlsRef.current = phls;
      phls.loadSource(hlsUrl);
      phls.attachMedia(pv);
      phls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (mounted) setPreviewReady(true);
      });
      phls.on(Hls.Events.ERROR, () => { /* preview is best-effort; ignore failures */ });
    } else if (pv.canPlayType("application/vnd.apple.mpegurl")) {
      pv.src = hlsUrl;
      pv.addEventListener("loadedmetadata", () => { if (mounted) setPreviewReady(true); }, { once: true });
    }

    return () => {
      mounted = false;
      previewHlsRef.current?.destroy();
      previewHlsRef.current = null;
    };
  }, [hlsUrl]);

  const handleSeekHover = useCallback((e: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>) => {
    const bar = seekBarRef.current;
    if (!bar || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    const time = pct * duration;
    setPreviewX(pct * 100);
    setPreviewTime(time);

    if (previewSeekDebounce.current) clearTimeout(previewSeekDebounce.current);
    previewSeekDebounce.current = setTimeout(() => {
      const pv = previewVideoRef.current;
      if (!pv || !previewReady) return;
      try { pv.currentTime = time; } catch { /* ignore seek errors on unready media */ }
    }, 80);
  }, [duration, previewReady]);

  const drawPreviewFrame = useCallback(() => {
    const pv = previewVideoRef.current;
    const canvas = previewCanvasRef.current;
    if (!pv || !canvas || !pv.videoWidth) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = 160;
    canvas.height = Math.round((pv.videoHeight / pv.videoWidth) * 160);
    try {
      ctx.drawImage(pv, 0, 0, canvas.width, canvas.height);
    } catch { /* cross-origin frame — preview stays on last good draw */ }
  }, []);

  useEffect(() => {
    const pv = previewVideoRef.current;
    if (!pv) return;
    pv.addEventListener("seeked", drawPreviewFrame);
    return () => pv.removeEventListener("seeked", drawPreviewFrame);
  }, [drawPreviewFrame]);

  useEffect(() => {
    return () => { if (previewSeekDebounce.current) clearTimeout(previewSeekDebounce.current); };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      setPlaying(true);
      if (!suppressWtBroadcastRef.current) onPlayStateChange?.(true, video.currentTime);
    };
    const onPause = () => {
      setPlaying(false);
      flushProgress();
      if (!suppressWtBroadcastRef.current) onPlayStateChange?.(false, video.currentTime);
    };
    const onSeeked = () => {
      if (!suppressWtBroadcastRef.current) onSeek?.(video.currentTime);
    };
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      onTimeUpdateProp?.(video.currentTime);
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
      if (progressKey && Date.now() - lastSavedAt.current > 5000) {
        flushProgress();
      }
    };
    const onDuration = () => setDuration(video.duration);
    const onWaiting = () => { setLoading(true); onBuffering?.(true); };
    const onCanPlay = () => { setLoading(false); onBuffering?.(false); };
    const onEnded_ = () => {
      setPlaying(false);
      if (progressKey) clearProgress(progressKey);
      onEnded?.();
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("ended", onEnded_);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("ended", onEnded_);
    };
  }, [onEnded, progressKey, flushProgress, onPlayStateChange, onSeek]);

  // ── React to preferDub changes without restarting the stream ────────────
  // The main HLS useEffect only runs when hlsUrl changes. When the user
  // toggles DUB/SUB, hlsUrl stays the same but preferDub changes — this
  // effect catches that and switches the active audio track immediately.
  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls || audioTracks.length <= 1) return;
    const targetLang = preferDub ? "en" : "ja";
    const targetIdx = hls.audioTracks.findIndex(
      (t) =>
        (t.lang && t.lang.toLowerCase().startsWith(targetLang)) ||
        (t.name && t.name.toLowerCase().includes(preferDub ? "english" : "japanese"))
    );
    if (targetIdx >= 0) hls.audioTrack = targetIdx;
    else if (!preferDub) hls.audioTrack = 0;
  }, [preferDub, audioTracks]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── External sync command (Watch Together) ───────────────────────────────
  // suppressWtBroadcastRef prevents the play/pause/seeked events triggered by
  // an incoming WT sync from being re-broadcast back to the room (loop prevention).
  useEffect(() => {
    if (!syncCommand) return;
    const video = videoRef.current;
    if (!video) return;
    suppressWtBroadcastRef.current = true;
    const { type, time } = syncCommand;
    if (type === "seek" || type === "play" || type === "pause") {
      video.currentTime = time;
    }
    if (type === "play") {
      video.play().then(() => {
        setWtPlayBlocked(false);
        setTimeout(() => { suppressWtBroadcastRef.current = false; }, 150);
      }).catch((err: unknown) => {
        // Browser autoplay policy blocked play — show click-to-play overlay
        if (err instanceof Error && err.name === "NotAllowedError") {
          setWtPlayBlocked(true);
        }
        setTimeout(() => { suppressWtBroadcastRef.current = false; }, 150);
      });
    } else if (type === "pause") {
      setWtPlayBlocked(false);
      video.pause();
      setTimeout(() => { suppressWtBroadcastRef.current = false; }, 150);
    } else {
      setTimeout(() => { suppressWtBroadcastRef.current = false; }, 150);
    }
  }, [syncCommand]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const video = videoRef.current;
      if (!video) return;
      if (e.code === "Space") { e.preventDefault(); video.paused ? video.play().catch(() => {}) : video.pause(); }
      if (e.code === "ArrowRight") { e.preventDefault(); video.currentTime = Math.min(video.currentTime + 10, video.duration); }
      if (e.code === "ArrowLeft") { e.preventDefault(); video.currentTime = Math.max(video.currentTime - 10, 0); }
      if (e.code === "KeyM") { video.muted = !video.muted; setMuted(video.muted); }
      if (e.code === "KeyF") toggleFullscreen();
      resetHideTimer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resetHideTimer]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleUnload = () => flushProgress();
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [flushProgress]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.paused ? video.play().catch(() => {}) : video.pause();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const handleVolume = (v: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = v;
    video.muted = v === 0;
    setVolume(v);
    setMuted(v === 0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Number(e.target.value);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  };

  const skip = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.currentTime + delta, video.duration));
    resetHideTimer();
  };

  const cycleSpeed = (rate: number) => {
    const video = videoRef.current;
    setPlaybackSpeed(rate);
    setShowSpeed(false);
    // Don't stomp an active 2x hold-speed override — it applies once the hold ends.
    if (video && !holdActivated.current) video.playbackRate = rate;
  };

  const toggleLoop = () => {
    const video = videoRef.current;
    setLooping((v) => {
      const next = !v;
      if (video) video.loop = next;
      return next;
    });
  };

  const togglePip = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch { /* PiP unsupported or blocked — no-op */ }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnterPip = () => setPipActive(true);
    const onLeavePip = () => setPipActive(false);
    video.addEventListener("enterpictureinpicture", onEnterPip);
    video.addEventListener("leavepictureinpicture", onLeavePip);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnterPip);
      video.removeEventListener("leavepictureinpicture", onLeavePip);
    };
  }, []);

  const flashScreenshotError = () => {
    setScreenshotError(true);
    if (screenshotErrorTimer.current) clearTimeout(screenshotErrorTimer.current);
    screenshotErrorTimer.current = setTimeout(() => setScreenshotError(false), 2500);
  };

  const takeScreenshot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) { flashScreenshotError(); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(title || "screenshot").replace(/[^\w\-]+/g, "_")}_${fmtTime(video.currentTime).replace(/:/g, "-")}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch {
      // Cross-origin CDN frames taint the canvas — toBlob/toDataURL throws SecurityError.
      flashScreenshotError();
      return;
    }
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 180);
  };

  const endHold = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    const video = videoRef.current;
    if (holdActivated.current) {
      holdActivated.current = false;
      setHolding(false);
      if (video) {
        video.playbackRate = playbackSpeed;
        // These are purely local speed-hold transitions, not real user intent —
        // suppress them from Watch Together sync broadcast.
        suppressWtBroadcastRef.current = true;
        if (!wasPlayingBeforeHold.current) video.pause();
        setTimeout(() => { suppressWtBroadcastRef.current = false; }, 150);
      }
      return true; // was a hold gesture, swallow the following click
    }
    return false;
  };

  const startHold = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const video = videoRef.current;
    wasPlayingBeforeHold.current = !!video && !video.paused;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      holdActivated.current = true;
      setHolding(true);
      if (v.paused) {
        // Local speed-hold gesture only — don't let the resulting play event
        // broadcast as a real Watch Together state change.
        suppressWtBroadcastRef.current = true;
        v.play().catch(() => {}).finally(() => {
          setTimeout(() => { suppressWtBroadcastRef.current = false; }, 150);
        });
      }
      v.playbackRate = HOLD_SPEED;
    }, HOLD_THRESHOLD_MS);
  };

  const setQuality = (level: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
      setCurrentLevel(level);
    }
    setShowSettings(false);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  const qualityLabel = (l: Level) =>
    l.height ? `${l.height}p` : l.bitrate ? `${Math.round(l.bitrate / 1000)}k` : "?";

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black select-none"
      onMouseMove={resetHideTimer}
      onMouseEnter={resetHideTimer}
      onMouseLeave={() => { if (hideTimer.current) clearTimeout(hideTimer.current); setShowControls(true); }}
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        className="w-full h-full"
        playsInline
        crossOrigin="anonymous"
      >
        {activeSub && (
          <track src={activeSub} kind="subtitles" label="Subtitles" srcLang="en" default />
        )}
      </video>

      {/* Screenshot flash */}
      {flash && (
        <div className="absolute inset-0 bg-white pointer-events-none z-40" style={{ animation: "hlsFlashFade 0.18s ease forwards" }} />
      )}

      {/* Premium white loader */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="relative w-12 h-12" style={{ animation: "hlsLoaderPulse 1.4s ease-in-out infinite" }}>
            <div className="absolute inset-0 rounded-full border-[2.5px] border-white/10" />
            <div className="absolute inset-0 rounded-full border-[2.5px] border-transparent border-t-white animate-spin" />
          </div>
        </div>
      )}

      {/* 2x hold-to-fast-forward indicator */}
      {holding && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-md border border-white/15 pointer-events-none z-20">
          <Gauge className="w-3.5 h-3.5 text-white" />
          <span className="text-white text-[11px] font-mono tracking-wider">{HOLD_SPEED}x</span>
        </div>
      )}

      {/* Screenshot unavailable toast — cross-origin CDN frames can taint the canvas */}
      {screenshotError && (
        <div
          className="absolute top-14 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          style={{ animation: "fadeInOut 2.5s ease forwards" }}
        >
          <div className="flex items-center gap-2 bg-black/80 border border-white/15 backdrop-blur-sm px-3 py-1.5 rounded-full">
            <span className="text-white/80 text-[11px] font-mono">Screenshot unavailable for this source</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20 bg-black/80">
          <AlertTriangle className="w-10 h-10 text-red-400" />
          <p className="text-white/70 text-sm font-mono text-center max-w-xs">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); hlsRef.current?.loadSource(hlsUrl); }}
            className="text-[11px] font-mono px-4 py-1.5 border border-white/20 text-white/60 hover:border-white hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* WT play-blocked overlay — host is playing but autoplay blocked */}
      {wtPlayBlocked && !error && (
        <div
          className="absolute inset-0 flex items-center justify-center z-20 cursor-pointer"
          onClick={() => {
            suppressWtBroadcastRef.current = true;
            const video = videoRef.current;
            if (video) {
              video.play().then(() => {
                setWtPlayBlocked(false);
              }).catch(() => {}).finally(() => {
                setTimeout(() => { suppressWtBroadcastRef.current = false; }, 150);
              });
            }
          }}
        >
          <div className="flex flex-col items-center gap-2.5 bg-black/75 backdrop-blur-sm px-7 py-5 rounded-2xl border border-purple-500/30">
            <div className="w-14 h-14 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center">
              <Play className="w-6 h-6 text-purple-300 fill-purple-300 ml-0.5" />
            </div>
            <p className="text-white text-sm font-semibold">Host is playing</p>
            <p className="text-white/50 text-xs">Click here to join</p>
          </div>
        </div>
      )}

      {/* Click-to-play overlay (center) */}
      {!wtPlayBlocked && !loading && !error && !playing && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10 cursor-pointer"
          onClick={togglePlay}
        >
          <div className="w-16 h-16 rounded-full bg-black/60 border border-white/20 flex items-center justify-center backdrop-blur-sm">
            <Play className="w-7 h-7 text-white fill-white ml-1" />
          </div>
        </div>
      )}

      {/* Resume toast */}
      {resumeToast && (
        <div
          className="absolute top-14 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          style={{ animation: "fadeInOut 4s ease forwards" }}
        >
          <div className="flex items-center gap-2 bg-black/80 border border-white/15 backdrop-blur-sm px-3 py-1.5 rounded-full">
            <RotateCcw className="w-3 h-3 text-blue-400 shrink-0" />
            <span className="text-white/80 text-[11px] font-mono">{resumeToast}</span>
          </div>
        </div>
      )}

      {/* Dark episode panel — floats from top-right (fullscreen only) */}
      {fullscreen && episodes && episodes.length > 0 && (
        <>
          {/* Trigger button */}
          <div className="absolute top-3 right-3 z-50 pointer-events-auto">
            <button
              ref={episodeTriggerRef}
              onClick={() => setShowEpisodePicker((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-black/55 border border-white/20 backdrop-blur-sm text-white/85 hover:text-white hover:bg-black/75 transition-all text-[11px] font-mono"
              title="Episodes"
            >
              <List className="w-3.5 h-3.5 shrink-0" />
              <span>EP {currentEpisode ?? "—"}</span>
              <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showEpisodePicker ? "rotate-180" : ""}`} />
            </button>
          </div>

          <style>{`
            @keyframes ep-card-in {
              from { opacity: 0; transform: perspective(500px) rotateY(16deg) translateX(20px); }
              to   { opacity: 1; transform: perspective(500px) rotateY(0deg)  translateX(0);   }
            }
            .ep-card-anim { animation: ep-card-in 0.36s cubic-bezier(0.34,1.56,0.64,1) both; }
            .ep-card-hover { transition: background 0.16s ease, transform 0.2s cubic-bezier(0.34,1.56,0.64,1); }
            .ep-card-hover:hover { background: rgba(255,255,255,0.07) !important; transform: perspective(800px) rotateY(-2deg) translateX(-3px) scale(1.01); }
            .ep-search::placeholder { color: rgba(255,255,255,0.25); }
          `}</style>

          {/* Floating dark panel */}
          <div
            ref={episodePickerRef}
            className="absolute right-3 top-14 w-[290px] z-40 flex flex-col rounded-xl overflow-hidden"
            style={{
              background: "rgba(8,8,18,0.92)",
              backdropFilter: "blur(28px)",
              WebkitBackdropFilter: "blur(28px)",
              border: "1px solid rgba(255,255,255,0.08)",
              maxHeight: "calc(100% - 84px)",
              boxShadow: showEpisodePicker ? "0 24px 80px rgba(0,0,0,0.72), 0 4px 24px rgba(0,0,0,0.5)" : "none",
              transformOrigin: "top right",
              transform: showEpisodePicker
                ? "perspective(1200px) rotateY(0deg) rotateX(0deg) scale(1) translateY(0)"
                : "perspective(1200px) rotateY(28deg) rotateX(-8deg) scale(0.88) translateY(-12px)",
              opacity: showEpisodePicker ? 1 : 0,
              transition: showEpisodePicker
                ? "transform 0.48s cubic-bezier(0.34,1.56,0.64,1), opacity 0.28s ease, box-shadow 0.48s ease"
                : "transform 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.18s ease, box-shadow 0.18s ease",
              pointerEvents: showEpisodePicker ? "auto" : "none",
            }}
          >
            {/* Header + search */}
            <div className="px-3 pt-3 pb-2.5 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center gap-2 mb-2.5">
                <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest flex-1">Episodes</p>
                <span className="text-[9px] font-mono text-white/25 tabular-nums">{episodes.length}</span>
                <button
                  onClick={() => setShowEpisodePicker(false)}
                  className="p-0.5 text-white/30 hover:text-white/70 transition-colors rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search episodes…"
                  value={epQuery}
                  onChange={(e) => setEpQuery(e.target.value)}
                  className="ep-search w-full rounded-md pl-7 pr-3 py-1.5 text-[11px] text-white/80 outline-none transition-all"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.08)" }}
                  onFocus={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.11)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)"; }}
                  onBlur={(e)  => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
                />
              </div>
            </div>

            {/* Episode list */}
            <div ref={episodeListRef} className="flex-1 overflow-y-auto">
              {episodes
                .filter((ep) => {
                  const q = epQuery.trim().toLowerCase();
                  if (!q) return true;
                  return String(ep.number).includes(q) || ep.title.toLowerCase().includes(q);
                })
                .map((ep, idx) => {
                  const isCurrent = currentEpisode === ep.number;
                  return (
                    <button
                      key={ep.number}
                      data-ep={ep.number}
                      onClick={() => { onEpisodeSelect?.(ep.number); setShowEpisodePicker(false); }}
                      className="ep-card-hover ep-card-anim w-full text-left"
                      style={{
                        animationDelay: `${Math.min(idx * 0.04, 0.3)}s`,
                        background: isCurrent ? "rgba(255,255,255,0.06)" : "transparent",
                      }}
                    >
                      {isCurrent ? (
                        /* Featured card — currently watching */
                        <div className="px-3 py-3">
                          <div className="relative w-full rounded-lg overflow-hidden mb-2.5" style={{ aspectRatio: "16/9" }}>
                            {ep.thumbnail ? (
                              <img src={ep.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-white/5">
                                <Play className="w-6 h-6 text-white/20 fill-white/20" />
                              </div>
                            )}
                            <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-red-600">
                              <span className="text-[8px] font-bold text-white uppercase tracking-widest">Watching</span>
                            </div>
                            <div className="absolute inset-0 flex items-end justify-end p-2">
                              <div className="w-8 h-8 rounded-full bg-white/90 shadow flex items-center justify-center">
                                <Play className="w-3.5 h-3.5 text-gray-900 fill-gray-900 ml-0.5" />
                              </div>
                            </div>
                          </div>
                          <p className="text-[9px] font-mono text-white/35 mb-0.5 tabular-nums">EP {ep.number}</p>
                          <p className="text-[13px] font-semibold text-white leading-snug mb-1 truncate">{ep.title}</p>
                          {ep.description && (
                            <p className="text-[10px] text-white/45 leading-relaxed line-clamp-2">{ep.description}</p>
                          )}
                        </div>
                      ) : (
                        /* Compact row */
                        <div className="flex items-center gap-2.5 px-3 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                          <div className="relative shrink-0 rounded overflow-hidden" style={{ width: 78, height: 44 }}>
                            {ep.thumbnail ? (
                              <img src={ep.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-white/5">
                                <Play className="w-3.5 h-3.5 text-white/20 fill-white/20" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] font-mono text-white/30 mb-0.5 tabular-nums">EP {ep.number}</p>
                            <p className="text-[11px] text-white/70 leading-snug truncate">{ep.title}</p>
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>
        </>
      )}

      {/* Pause info overlay — bottom-left, shown when paused */}
      {!playing && (animeCover || animeLogo || epMeta || title || epDescription) && (
        <div
          className="absolute inset-0 z-20 pointer-events-none flex items-end"
          style={{
            background: "linear-gradient(135deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.15) 50%, transparent 100%)",
            opacity: 1,
            transition: "opacity 0.35s ease",
          }}
        >
          <div className={animeLogo ? "px-4 pb-28 max-w-[420px]" : "px-8 pb-28 max-w-[420px]"}>
            {animeLogo ? (
              <img
                src={animeLogo}
                alt=""
                className="h-20 sm:h-24 md:h-28 max-w-[380px] w-auto object-contain object-left mb-3 -ml-2"
                style={{ filter: "drop-shadow(0 4px 24px rgba(0,0,0,0.85))" }}
              />
            ) : animeCover && (
              <img
                src={animeCover}
                alt=""
                className="h-14 w-auto object-contain mb-3 rounded"
                style={{ filter: "drop-shadow(0 4px 20px rgba(0,0,0,0.85))" }}
              />
            )}
            {epMeta && (
              <p className="text-white/50 text-[11px] mb-1.5 tracking-wide font-mono">{epMeta}</p>
            )}
            {title && (
              <p className="text-white font-bold text-sm mb-2 leading-snug" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>{title}</p>
            )}
            {epDescription && (
              <p className="text-white/55 text-[11px] leading-relaxed line-clamp-2">{epDescription}</p>
            )}
          </div>
        </div>
      )}

      {/* Controls overlay */}
      <div
        className="absolute inset-0 flex flex-col justify-end z-30 pointer-events-none"
        style={{ opacity: showControls || !playing ? 1 : 0, transition: "opacity 0.25s ease" }}
      >
        {/* Title bar */}
        {title && (
          <div className="absolute top-0 left-0 right-0 px-4 pt-4 pb-8 pointer-events-none"
            style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)" }}
          >
            <p className="text-white text-sm font-semibold truncate drop-shadow pr-32">{title}</p>
          </div>
        )}

        {/* Bottom gradient + controls */}
        <div
          className="pointer-events-auto"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)" }}
        >
          {/* Seek bar + settings gear */}
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            <div
              ref={seekBarRef}
              className="relative flex-1 h-1 hover:h-1.5 transition-all duration-150 rounded-full bg-white/20 group"
              onMouseMove={handleSeekHover}
              onMouseLeave={() => setPreviewTime(null)}
            >
              {/* Hover scrub-preview thumbnail */}
              {previewTime !== null && (
                <div
                  className="absolute bottom-full mb-3 -translate-x-1/2 pointer-events-none z-10"
                  style={{ left: `${Math.min(Math.max(previewX, 8), 92)}%` }}
                >
                  <div className="w-40 rounded-lg overflow-hidden border border-white/15 bg-zinc-900 shadow-xl">
                    <div className="relative w-full aspect-video bg-black">
                      <canvas ref={previewCanvasRef} className="w-full h-full object-cover" />
                      <span className="absolute bottom-1 right-1.5 text-[10px] font-mono text-white bg-black/70 px-1 rounded">
                        {fmtTime(previewTime)}
                      </span>
                    </div>
                    {title && (
                      <p className="px-2 py-1 text-[10px] font-mono text-white/70 truncate">{title}</p>
                    )}
                  </div>
                </div>
              )}
              {/* Buffered */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/25"
                style={{ width: `${bufferedPct}%` }}
              />
              {/* Played */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]"
                style={{ width: `${progress}%` }}
              />
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.7)] opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `calc(${progress}% - 6px)` }}
              />
            </div>

            {/* Quality gear — sits at the end of the seek bar row */}
            {levels.length > 0 && (
              <div className="relative shrink-0">
                <button
                  onClick={() => { setShowSettings((v) => !v); setShowSubs(false); }}
                  className="p-1.5 text-white/60 hover:text-white transition-colors"
                  title="Quality"
                >
                  <Settings className="w-4 h-4" />
                </button>
                {showSettings && (
                  <div className="absolute bottom-full right-0 mb-2 min-w-[130px] bg-white border border-gray-200 rounded overflow-hidden shadow-xl z-50">
                    <p className="px-3 py-1.5 text-[9px] font-mono text-gray-400 uppercase tracking-widest border-b border-gray-100">Quality</p>
                    <button
                      onClick={() => setQuality(-1)}
                      className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors hover:bg-gray-50 ${currentLevel === -1 ? "text-gray-900 font-semibold" : "text-gray-600"}`}
                    >
                      Auto
                    </button>
                    {[...levels].reverse().map((l, ri) => {
                      const idx = levels.length - 1 - ri;
                      return (
                        <button
                          key={idx}
                          onClick={() => setQuality(idx)}
                          className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors hover:bg-gray-50 ${currentLevel === idx ? "text-gray-900 font-semibold" : "text-gray-600"}`}
                        >
                          {qualityLabel(l)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Hidden preview video — decodes lowest quality only, muted, never visible */}
          <video ref={previewVideoRef} className="hidden" muted playsInline preload="none" />

          {/* Controls row — left cluster: transport + volume; right cluster: PiP/loop/speed/CC/audio/fullscreen */}
          <div className="flex items-center gap-1 px-3 pb-3">
            {/* Play / Pause */}
            <button
              onClick={togglePlay}
              className="p-1.5 text-white hover:text-white/80 transition-colors"
              title={playing ? "Pause (Space)" : "Play (Space)"}
            >
              {playing
                ? <Pause className="w-5 h-5 fill-current" />
                : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            {/* Skip back */}
            <button
              onClick={() => skip(-10)}
              className="p-1.5 text-white/70 hover:text-white transition-colors"
              title="Back 10s (←)"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            {/* Skip forward */}
            <button
              onClick={() => skip(10)}
              className="p-1.5 text-white/70 hover:text-white transition-colors"
              title="Forward 10s (→)"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-1.5 group/vol">
              <button onClick={toggleMute} className="p-1.5 text-white/70 hover:text-white transition-colors" title="Mute (M)">
                {muted || volume === 0
                  ? <VolumeX className="w-4 h-4" />
                  : <Volume2 className="w-4 h-4" />}
              </button>
              <div className="w-0 group-hover/vol:w-16 overflow-hidden transition-all duration-200">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => handleVolume(Number(e.target.value))}
                  className="w-16 h-1 accent-white cursor-pointer"
                />
              </div>
            </div>

            {/* Time */}
            <span className="text-white/60 text-[11px] font-mono ml-1 tabular-nums">
              {fmtTime(currentTime)}
              {duration > 0 && <> / {fmtTime(duration)}</>}
            </span>

            <div className="flex-1" />

            {/* Picture-in-picture */}
            <button
              onClick={togglePip}
              className={`p-1.5 transition-colors ${pipActive ? "text-white" : "text-white/60 hover:text-white"}`}
              title="Picture in picture"
            >
              <PictureInPicture2 className="w-4 h-4" />
            </button>

            {/* Loop */}
            <button
              onClick={toggleLoop}
              className={`p-1.5 transition-colors ${looping ? "text-white" : "text-white/60 hover:text-white"}`}
              title="Loop episode"
            >
              <Repeat className="w-4 h-4" />
            </button>

            {/* Speed */}
            <div className="relative">
              <button
                onClick={() => { setShowSpeed((v) => !v); setShowSubs(false); setShowSettings(false); }}
                className="flex items-center gap-1 px-1.5 py-1.5 text-white/60 hover:text-white transition-colors"
                title="Playback speed"
              >
                <Gauge className="w-4 h-4" />
                <span className="text-[10px] font-mono">{playbackSpeed}x</span>
              </button>
              {showSpeed && (
                <div className="absolute bottom-full right-0 mb-2 min-w-[90px] bg-white border border-gray-200 rounded overflow-hidden shadow-xl z-50">
                  <p className="px-3 py-1.5 text-[9px] font-mono text-gray-400 uppercase tracking-widest border-b border-gray-100">Speed</p>
                  {SPEED_OPTIONS.map((rate) => (
                    <button
                      key={rate}
                      onClick={() => cycleSpeed(rate)}
                      className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors hover:bg-gray-50 ${playbackSpeed === rate ? "text-gray-900 font-semibold" : "text-gray-600"}`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Audio track badge — only shown when stream has multiple tracks */}
            {audioTracks.length > 1 && (
              <div className="relative">
                <button
                  onClick={() => { setShowAudio((v) => !v); setShowSettings(false); setShowSubs(false); }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-bold tracking-widest transition-colors bg-white/10 hover:bg-white/20 text-white/80 hover:text-white"
                  title="Audio track"
                >
                  <Mic className="w-3 h-3 shrink-0" />
                  {audioTracks[activeAudioTrack]?.lang
                    ? audioTracks[activeAudioTrack].lang.toUpperCase().slice(0, 2)
                    : audioTracks[activeAudioTrack]?.name?.slice(0, 2).toUpperCase() ?? "AU"}
                </button>
                {showAudio && (
                  <div className="absolute bottom-full right-0 mb-2 min-w-[140px] bg-white border border-gray-200 rounded shadow-xl z-50 overflow-hidden">
                    <p className="px-3 py-1.5 text-[9px] font-mono text-gray-400 uppercase tracking-widest border-b border-gray-100 flex items-center gap-1">
                      <Mic className="w-3 h-3" /> Audio Track
                    </p>
                    {audioTracks.map((t, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          if (hlsRef.current) hlsRef.current.audioTrack = idx;
                          setActiveAudioTrack(idx);
                          setShowAudio(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors hover:bg-gray-50 flex items-center gap-2 ${activeAudioTrack === idx ? "text-gray-900 font-semibold" : "text-gray-600"}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeAudioTrack === idx ? "bg-gray-900" : "bg-gray-300"}`} />
                        {t.name || t.lang || `Track ${idx + 1}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Subtitles */}
            {subtitles.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => { setShowSubs((v) => !v); setShowSettings(false); }}
                  className={`p-1.5 transition-colors ${activeSub ? "text-blue-400" : "text-white/50 hover:text-white"}`}
                  title="Subtitles / AI Translate"
                >
                  {translating
                    ? <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                    : <Captions className="w-4 h-4" />}
                </button>
                {showSubs && (
                  <div className="absolute bottom-full right-0 mb-2 min-w-[170px] max-h-80 overflow-y-auto bg-white border border-gray-200 rounded shadow-xl z-50">
                    <p className="px-3 py-1.5 text-[9px] font-mono text-gray-400 uppercase tracking-widest border-b border-gray-100">Subtitles</p>
                    <button
                      onClick={() => { setActiveSub(null); setShowSubs(false); }}
                      className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors hover:bg-gray-50 ${!activeSub ? "text-gray-900 font-semibold" : "text-gray-600"}`}
                    >
                      Off
                    </button>
                    {subtitles.map((s) => (
                      <button
                        key={s.src}
                        onClick={() => { setActiveSub(s.src); setShowSubs(false); }}
                        className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors hover:bg-gray-50 ${activeSub === s.src ? "text-gray-900 font-semibold" : "text-gray-600"}`}
                      >
                        {s.label}
                      </button>
                    ))}
                    <div className="border-t border-gray-100 mt-1">
                      <p className="px-3 py-1.5 text-[9px] font-mono text-purple-500 uppercase tracking-widest flex items-center gap-1">
                        <Languages className="w-3 h-3" /> AI Translate
                      </p>
                      <div className="px-2 pb-2.5 flex gap-1.5">
                        <select
                          value={translateLang}
                          onChange={(e) => setTranslateLang(e.target.value)}
                          className="flex-1 bg-gray-50 border border-gray-200 text-[11px] text-gray-700 px-1.5 py-1 rounded-sm outline-none cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {TRANSLATE_LANGS.map((l) => (
                            <option key={l.code} value={l.code}>{l.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => {
                            const lang = TRANSLATE_LANGS.find((l) => l.code === translateLang);
                            if (lang) { translateSubtitles(lang.code, lang.name); }
                            setShowSubs(false);
                          }}
                          disabled={translating}
                          className="px-2 py-1 text-[10px] font-mono bg-purple-50 text-purple-600 border border-purple-200 hover:bg-purple-100 transition-colors rounded-sm disabled:opacity-40 whitespace-nowrap"
                        >
                          {translating ? "…" : "Go"}
                        </button>
                      </div>
                      {translateError && (
                        <p className="px-2 pb-2 text-[9px] text-red-500 font-mono leading-tight">{translateError}</p>
                      )}
                      {currentTranslatedVtt && (
                        <div className="px-2 pb-2.5">
                          <button
                            onClick={() => {
                              const blob = new Blob([currentTranslatedVtt], { type: "text/plain" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = "subtitles_translated.txt";
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-mono bg-gray-50 text-gray-500 border border-gray-200 hover:border-gray-400 hover:text-gray-700 transition-colors rounded-sm"
                          >
                            <Download className="w-3 h-3" /> Save .txt
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Screenshot */}
            <button
              onClick={takeScreenshot}
              className="p-1.5 text-white/70 hover:text-white transition-colors"
              title="Screenshot"
            >
              <Camera className="w-4 h-4" />
            </button>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-1.5 text-white/70 hover:text-white transition-colors"
              title="Fullscreen (F)"
            >
              {fullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Click anywhere on video to play/pause + hold-to-2x (not on controls) */}
      <div
        className="absolute inset-0 z-5 cursor-pointer"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button, input")) return;
          startHold(e);
        }}
        onPointerUp={(e) => {
          if ((e.target as HTMLElement).closest("button, input")) return;
          if (!endHold()) { togglePlay(); resetHideTimer(); }
        }}
        onPointerLeave={() => endHold()}
        onPointerCancel={() => endHold()}
      />
    </div>
  );
}
