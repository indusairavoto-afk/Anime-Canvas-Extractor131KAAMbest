/**
 * Miruro Relay Client
 *
 * When MIRURO_RELAY_URL is set (pointing at a deployed instance of the
 * @workspace/miruro-relay service, e.g. on Render — whose IP is not
 * Cloudflare-blocked), all outbound fetches to miruro.bz / ultracloud.cc
 * are routed through it via a simple forward-proxy call instead of using
 * CloakBrowser to solve the Cloudflare challenge locally.
 *
 * This is the "real" fix for the hard IP block documented in
 * .agents/memory/miruro-cf-ip-block.md — Replit's outbound IP never clears
 * Cloudflare's Turnstile challenge, but a non-Replit-IP host succeeds with
 * a plain fetch, no browser automation needed.
 */

export function isMiruroRelayConfigured(): boolean {
  return !!process.env.MIRURO_RELAY_URL;
}

function encodeHeaders(headers: RequestInit["headers"]): string {
  const obj: Record<string, string> = {};
  if (headers) {
    for (const [k, v] of new Headers(headers).entries()) {
      obj[k] = v;
    }
  }
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

/**
 * Forwards a fetch through the deployed Miruro relay instead of calling the
 * target URL directly. Returns a standard Response, so call sites don't need
 * to change how they read the result (.status, .headers, .text(), etc.).
 */
export async function relayFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const relayBase = (process.env.MIRURO_RELAY_URL ?? "").replace(/\/$/, "");
  const relayUrl = `${relayBase}/relay?url=${encodeURIComponent(url)}`;

  const method = init.method ?? "GET";
  const hasBody = init.body !== undefined && init.body !== null && method !== "GET" && method !== "HEAD";

  const extraHeaders: Record<string, string> = {
    "x-relay-headers": encodeHeaders(init.headers),
  };
  if (process.env.MIRURO_RELAY_SECRET) {
    extraHeaders["x-relay-secret"] = process.env.MIRURO_RELAY_SECRET;
  }

  const relayInit: RequestInit & { duplex?: "half" } = {
    method,
    headers: extraHeaders,
    body: hasBody ? init.body : undefined,
  };
  if (hasBody) relayInit.duplex = "half";

  return fetch(relayUrl, relayInit);
}
