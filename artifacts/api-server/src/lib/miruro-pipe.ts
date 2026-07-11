/**
 * miruro-pipe.ts
 *
 * Implements the miruro `/api/secure/pipe` protocol entirely in Node/TypeScript
 * by routing requests through the deployed Cloudflare Worker relay.
 *
 * This is a Node-native replacement for the Python sidecar's pipe logic.
 * It is used when MIRURO_RELAY_URL is set — the relay handles the CF bypass
 * (CF edge IPs are not blocked by miruro.bz's firewall), so no curl_cffi
 * TLS impersonation or Python runtime is needed.
 *
 * Pipe protocol (same as Python sidecar):
 *   request  → base64url( JSON.stringify({path, method, query, body, version}) )
 *   response ← base64url( gzip( JSON.stringify(data) ) )
 */

import { gunzipSync } from "zlib";
import { type MiruroNativeStream, type MiruroNativeSubtitle } from "./miruro-sidecar.js";

const MIRURO_ORIGIN = (process.env.MIRURO_SIDECAR_ORIGIN ?? "https://www.miruro.bz").replace(/\/$/, "");
// Provider priority for native HLS.  Prefer providers whose CDNs are
// reachable from our server (hls.anidb.app, vivibebe.site → 200 OK).
// kwik-backed providers (kiwi → owocdn/uwucdn) are skipped by the
// kwik-filter logic; keeping them in the list allows detecting cdnBlocked.
const PROVIDER_PRIORITY = ["pewe", "bonk", "kiwi", "arc", "zoro", "hop"];

/** CDN hostnames that block datacenter/Replit IPs — cannot be proxied server-side. */
const KWIK_CDN_SUFFIXES = [".uwucdn.top", ".owocdn.top"];

function isKwikCdnUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return KWIK_CDN_SUFFIXES.some(
      (sfx) => hostname === sfx.slice(1) || hostname.endsWith(sfx),
    );
  } catch {
    return false;
  }
}

/** Thrown when every provider returns a kwik-CDN-blocked stream URL. */
export class KwikCdnBlockedError extends Error {
  readonly cdnBlocked = true;
  constructor() {
    super("All providers returned kwik-CDN-blocked stream URLs");
  }
}

// ── Encoding/decoding ─────────────────────────────────────────────────────────

function encodePipeRequest(path: string, query: Record<string, string | number>): string {
  const payload = { path, method: "GET", query, body: null, version: "0.1.0" };
  // base64url without padding — matches Python's urlsafe_b64encode(...).rstrip("=")
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePipeResponse(text: string): unknown {
  // Response is base64url(gzip(json)) — same as Python's _decode_pipe_response.
  // Buffer.from handles missing padding automatically when using "base64" codec.
  const compressed = Buffer.from(text.trim(), "base64");
  const decompressed = gunzipSync(compressed);
  return JSON.parse(decompressed.toString("utf-8"));
}

// ── Relay call ────────────────────────────────────────────────────────────────

async function relayPipeRequest(path: string, query: Record<string, string | number>): Promise<unknown> {
  const relayBase = (process.env.MIRURO_RELAY_URL ?? "").replace(/\/$/, "");
  if (!relayBase) throw new Error("MIRURO_RELAY_URL is not configured");

  // Send WAF-safe {fn, q, host} — short keys, hostname-only (no protocol).
  // The Worker encodes to base64url and prepends https:// internally so no
  // eyJ... strings or URLs-with-protocol ever cross the wire.
  const url = `${relayBase}/pipe`;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.MIRURO_RELAY_SECRET) {
    headers["x-relay-secret"] = process.env.MIRURO_RELAY_SECRET;
  }

  // Strip protocol from origin for the host field (www.miruro.bz not https://...)
  const originHost = MIRURO_ORIGIN.replace(/^https?:\/\//, "");

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ a: path, q: query, host: originHost }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Relay /pipe returned ${res.status}: ${body}`);
  }

  return decodePipeResponse(await res.text());
}

// ── Type helpers ──────────────────────────────────────────────────────────────

interface PipeEpisode {
  id?: string;
  number?: number;
  title?: string;
}

interface PipeEpisodesResponse {
  providers?: Record<string, { episodes?: Record<string, PipeEpisode[]> }>;
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
    .map((s: any): MiruroNativeSubtitle | null => {
      const url = findFirstString(s, ["url", "file", "src"]);
      if (!url) return null;
      const lang = (s.lang ?? s.language ?? s.srclang ?? "en") as string;
      const label = (s.label ?? s.name ?? lang) as string;
      const isDefault = Boolean(s.default ?? s.isDefault ?? lang.toLowerCase().startsWith("en"));
      return { url, lang, label, isDefault };
    })
    .filter((s): s is MiruroNativeSubtitle => s !== null);
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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true when the relay is configured and this module can be used.
 * When false, callers should fall back to the Python sidecar.
 */
export function isRelayPipeAvailable(): boolean {
  return !!process.env.MIRURO_RELAY_URL;
}

/**
 * Resolves a native Miruro stream entirely via the relay (no Python sidecar).
 * Mirrors fetchMiruroNativeStream() from miruro-sidecar.ts but calls the
 * CF Worker relay directly from Node instead of going through localhost:8090.
 */
export async function fetchMiruroNativeStreamViaRelay(
  anilistId: number,
  epNum: number,
  category: "sub" | "dub",
): Promise<MiruroNativeStream> {
  // 1. Fetch episode list
  const episodes = (await relayPipeRequest("episodes", { anilistId })) as PipeEpisodesResponse;
  const providers = episodes.providers ?? {};

  // 2. Build priority-sorted candidate list
  const ordered = [
    ...PROVIDER_PRIORITY.filter((p) => p in providers),
    ...Object.keys(providers).filter((p) => !PROVIDER_PRIORITY.includes(p)),
  ];

  const candidates: { provider: string; episodeId: string }[] = [];
  for (const provider of ordered) {
    const list = providers[provider]?.episodes?.[category];
    if (!Array.isArray(list)) continue;
    const match = list.find((e) => e.number === epNum);
    // Episode IDs from the pipe response are already base64-encoded — pass through directly.
    if (match?.id) {
      candidates.push({ provider, episodeId: match.id });
    }
  }

  if (candidates.length === 0) {
    throw new Error(`Episode ${epNum} (${category}) not found on Miruro for anilistId=${anilistId}`);
  }

  // 3. Try each candidate provider until one returns a non-kwik-CDN stream.
  //    Kwik-CDN URLs (uwucdn/owocdn) are hard IP-blocked from datacenter egress;
  //    skip them and try the next provider.
  //
  //    KwikCdnBlockedError is thrown ONLY when at least one provider returned
  //    a stream URL and every such URL was kwik-backed. Plain network/parse
  //    errors do NOT count toward the kwik tally — they propagate as normal
  //    errors so the caller's relay→sidecar fallback remains intact.
  let lastErr: Error | null = null;
  let streamsSeen = 0;     // providers that returned a stream URL (kwik or not)
  let kwikStreamsSeen = 0; // subset of those that were kwik-CDN-backed
  for (const { provider, episodeId } of candidates) {
    try {
      const sources = await relayPipeRequest("sources", {
        episodeId,
        provider,
        category,
        anilistId,
      });
      const streamUrl = extractStreamUrl(sources);
      if (!streamUrl) {
        lastErr = new Error(`No playable stream from provider=${provider}`);
        continue;
      }
      streamsSeen++;
      if (isKwikCdnUrl(streamUrl)) {
        kwikStreamsSeen++;
        lastErr = new Error(`Provider ${provider} uses kwik CDN (server-IP-blocked)`);
        continue; // try next provider
      }
      return {
        streamUrl,
        subtitles: extractSubtitles(sources),
        intro: extractTimestamp(sources, "intro"),
        outro: extractTimestamp(sources, "outro"),
        provider,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(`Relay pipe error (provider=${provider})`);
    }
  }

  // Only signal CDN-blocked when every stream URL we actually saw was kwik-backed.
  // If all providers failed with errors (no stream URL at all), propagate as normal.
  if (streamsSeen > 0 && streamsSeen === kwikStreamsSeen) throw new KwikCdnBlockedError();
  throw lastErr ?? new Error(`No provider returned a stream for anilistId=${anilistId} ep=${epNum}`);
}
