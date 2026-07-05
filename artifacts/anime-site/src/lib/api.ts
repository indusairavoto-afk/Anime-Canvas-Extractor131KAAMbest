const rawBase = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

// Render's fromService.property=host gives a bare hostname without a protocol
// (e.g. "nexa-anime-api.onrender.com"). Prepend https:// when needed so all
// fetch calls produce a valid absolute URL.
const API_BASE = rawBase
  ? rawBase.startsWith("http")
    ? rawBase.replace(/\/$/, "")
    : `https://${rawBase}`
  : "";

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}`;
}

// ── AniList GraphQL helper ────────────────────────────────────────────────────
// Calls AniList directly from the browser instead of through the server proxy.
// Replit's datacenter IPs are hard-blocked by AniList, but browser IPs are not.
const ANILIST_URL = "https://graphql.anilist.co";
const anilistCache = new Map<string, { data: unknown; expiresAt: number }>();
const ANILIST_TTL = 5 * 60 * 1000; // 5 minutes

export async function anilistFetch(body: object): Promise<unknown> {
  const key = JSON.stringify(body);
  const cached = anilistCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  try {
    const res = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (data && !(data as { errors?: unknown[] }).errors?.length) {
      anilistCache.set(key, { data, expiresAt: Date.now() + ANILIST_TTL });
      if (anilistCache.size > 300) {
        const first = anilistCache.keys().next().value;
        if (first) anilistCache.delete(first);
      }
    }
    return data;
  } catch {
    // Network errors (including CORS blocks) — return null so callers
    // can show empty state instead of crashing.
    return null;
  }
}
