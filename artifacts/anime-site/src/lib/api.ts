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
