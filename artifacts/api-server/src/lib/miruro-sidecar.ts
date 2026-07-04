// ─────────────────────────────────────────────────────────────────────────────
// Miruro sidecar client — talks to the local Python/FastAPI process
// (artifacts/miruro-sidecar) that impersonates Chrome's TLS fingerprint via
// curl_cffi to hit miruro's `/api/secure/pipe` backend directly, without a
// headless browser. Like the existing Puppeteer/relay bypass, it still needs
// a non-datacenter egress IP — set MIRURO_PROXY_URL for the sidecar to use.
// ─────────────────────────────────────────────────────────────────────────────

const SIDECAR_URL = process.env.MIRURO_SIDECAR_URL ?? "http://127.0.0.1:8090";

const PROVIDER_PRIORITY = ["kiwi", "arc", "zoro", "hop"];

interface SidecarEpisodeEntry {
  id?: string;
  number?: number;
  slug?: string;
  title?: string;
}

interface SidecarEpisodesResponse {
  providers?: Record<string, { episodes?: Record<string, SidecarEpisodeEntry[]> }>;
}

export interface MiruroNativeSubtitle {
  url: string;
  lang: string;
  label: string;
  isDefault: boolean;
}

export interface MiruroNativeStream {
  streamUrl: string;
  subtitles: MiruroNativeSubtitle[];
  intro: { start: number; end: number } | null;
  outro: { start: number; end: number } | null;
  provider: string;
}

async function sidecarGetJson(path: string, timeoutMs = 12000): Promise<unknown> {
  const r = await fetch(`${SIDECAR_URL}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await r.json());
    } catch {
      /* ignore */
    }
    throw new Error(`sidecar returned ${r.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return r.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findFirstString(obj: any, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (typeof obj[key] === "string" && obj[key]) return obj[key];
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractStreamUrl(sources: any): string | null {
  if (!sources || typeof sources !== "object") return null;
  const direct = findFirstString(sources, ["url", "file", "hls", "m3u8"]);
  if (direct) return direct;

  const arrays = [sources.sources, sources.streams, sources.links];
  for (const arr of arrays) {
    if (Array.isArray(arr) && arr.length > 0) {
      const found = findFirstString(arr[0], ["url", "file", "src"]);
      if (found) return found;
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSubtitles(sources: any): MiruroNativeSubtitle[] {
  const arr = sources?.subtitles ?? sources?.tracks ?? sources?.captions;
  if (!Array.isArray(arr)) return [];
  return arr
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => {
      const url = findFirstString(s, ["url", "file", "src"]);
      if (!url) return null;
      const lang = (s.lang ?? s.language ?? s.srclang ?? "en") as string;
      const label = (s.label ?? s.name ?? lang) as string;
      const isDefault = Boolean(s.default ?? s.isDefault ?? lang.toLowerCase().startsWith("en"));
      return { url, lang, label, isDefault };
    })
    .filter((s: MiruroNativeSubtitle | null): s is MiruroNativeSubtitle => s !== null);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTimestamp(sources: any, key: "intro" | "outro"): { start: number; end: number } | null {
  const obj = sources?.[key] ?? sources?.intro_outro?.[key] ?? sources?.timestamps?.[key];
  if (!obj || typeof obj !== "object") return null;
  const start = Number(obj.start ?? obj.begin ?? 0);
  const end = Number(obj.end ?? obj.stop ?? 0);
  if (!isFinite(start) || !isFinite(end) || end <= start) return null;
  return { start, end };
}

/**
 * Resolves a native (direct m3u8) Miruro stream for the given AniList anime
 * via the local sidecar, bypassing the iframe/X-Frame-Options entirely.
 * Returns null if the sidecar is unreachable, CF-blocked (no proxy egress),
 * or the episode/provider combination isn't available.
 */
export async function fetchMiruroNativeStream(
  anilistId: number,
  epNum: number,
  category: "sub" | "dub",
): Promise<MiruroNativeStream> {
  const episodes = (await sidecarGetJson(`/episodes/${anilistId}`)) as SidecarEpisodesResponse;
  const providers = episodes.providers ?? {};
  const providerNames = [
    ...PROVIDER_PRIORITY.filter((p) => p in providers),
    ...Object.keys(providers).filter((p) => !PROVIDER_PRIORITY.includes(p)),
  ];

  let chosen: { provider: string; slug: string } | null = null;
  for (const provider of providerNames) {
    const list = providers[provider]?.episodes?.[category];
    if (!Array.isArray(list)) continue;
    const match = list.find((e) => e.number === epNum);
    if (match?.slug) {
      chosen = { provider, slug: match.slug };
      break;
    }
  }

  if (!chosen) {
    throw new Error(`Episode ${epNum} (${category}) not found on Miruro for anilistId=${anilistId}`);
  }

  const sources = await sidecarGetJson(`/watch/${chosen.provider}/${anilistId}/${category}/${chosen.slug}`);
  const streamUrl = extractStreamUrl(sources);
  if (!streamUrl) {
    throw new Error(`No playable stream in Miruro sidecar response (provider=${chosen.provider})`);
  }

  return {
    streamUrl,
    subtitles: extractSubtitles(sources),
    intro: extractTimestamp(sources, "intro"),
    outro: extractTimestamp(sources, "outro"),
    provider: chosen.provider,
  };
}
