// ─────────────────────────────────────────────────────────────────────────────
// Proxify — third-party stream proxy aggregator fallbacks.
//
// When our own server-side HLS proxy (/api/anizone/hls) can't reach a CDN
// directly (network error, IP block, timeout), we fall back to routing the
// same url|referer pair through independent third-party proxy CDNs. Since
// these run on different infrastructure/IP ranges than Replit, they succeed
// in cases where a direct fetch from our server gets blocked.
//
// Encodings reverse-engineered from the "Proxify Streams" aggregator
// (github.com/walterwhite-69/Proxify-Streams).
// ─────────────────────────────────────────────────────────────────────────────

const MIRURO_XOR_KEY = Buffer.from("a54d389c18527d9fd3e7f0643e27ed", "hex");

function base64urlNoPad(buf: Buffer): string {
  return buf.toString("base64url").replace(/=+$/, "");
}

function xorEncode(text: string, key: Buffer): string {
  const b = Buffer.from(text, "utf8");
  const out = Buffer.alloc(b.length);
  for (let i = 0; i < b.length; i++) {
    out[i] = b[i] ^ key[i % key.length];
  }
  return base64urlNoPad(out);
}

export interface ProxifyFallback {
  name: string;
  url: string;
}

/**
 * Build fallback proxy URLs for a given upstream resource URL + referer.
 * Each one is an independent third-party proxy CDN with its own IP range.
 */
export function buildProxifyFallbacks(url: string, referer: string): ProxifyFallback[] {
  const fallbacks: ProxifyFallback[] = [];

  try {
    fallbacks.push({
      name: "anikuro",
      url: `https://proxy.anikuro.to/${Buffer.from(`${url}|${referer}`).toString("base64")}${url.toLowerCase().includes(".m3u8") ? ".m3u8" : ".mp4"}`,
    });
  } catch { /* skip provider on encoding failure */ }

  try {
    fallbacks.push({
      name: "lunaranime",
      url: `https://cluster.lunaranime.ru/api/proxy/hls/custom?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(referer)}`,
    });
  } catch { /* skip provider on encoding failure */ }

  try {
    const headers = JSON.stringify({ Referer: referer });
    fallbacks.push({
      name: "animanga",
      url: `https://upcloud.animanga.fun/proxy?url=${encodeURIComponent(url)}&headers=${encodeURIComponent(headers)}`,
    });
  } catch { /* skip provider on encoding failure */ }

  try {
    fallbacks.push({
      name: "miruro-proxify",
      url: `https://pro.ultracloud.cc/m3u8/?u=${xorEncode(url, MIRURO_XOR_KEY)}&r=${xorEncode(referer, MIRURO_XOR_KEY)}`,
    });
  } catch { /* skip provider on encoding failure */ }

  return fallbacks;
}
