/**
 * Miruro Relay — Cloudflare Worker
 *
 * Runs on Cloudflare's edge network (ASN 13335). Because this is Cloudflare
 * infrastructure making the request, miruro.bz's CF firewall rule that blocks
 * Replit/DigitalOcean datacenter IPs does NOT apply here.
 *
 * Endpoints:
 *   GET  /healthz              — health check
 *   ALL  /relay?url=<encoded>  — general forward proxy (used by api-server Node code)
 *   GET  /pipe?e=<encoded>     — miruro pipe passthrough (used by Python sidecar)
 *
 * Security:
 *   Set the RELAY_SECRET environment variable via `wrangler secret put RELAY_SECRET`.
 *   When set, every request (except /healthz) must include the header:
 *     x-relay-secret: <your-secret>
 *   Without it the Worker is an open proxy — only safe if the URL is not public.
 */

export interface Env {
  RELAY_SECRET?: string;
}

const ALLOWED_HOSTS = [
  "miruro.bz",
  "www.miruro.bz",
  "miruro.to",
  "www.miruro.to",
  "miruro.tv",
  "www.miruro.tv",
  "pro.ultracloud.cc",
  "pru.ultracloud.cc",
  // AnimePahe + kwik.cx — used by the PAHE streaming server
  "animepahe.ru",
  "animepahe.com",
  "animepahe.org",
  "animepahe.pw",
  "kwik.cx",
  "kwik.si",
];

// Headers dropped when forwarding responses back to the caller.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "x-relay-headers",
  "x-relay-secret",
]);

// Browser-like headers sent on pipe requests so miruro doesn't reject us.
const PIPE_BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
  "sec-ch-ua": '"Chromium";v="110", "Not A(Brand";v="24", "Google Chrome";v="110"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

function checkSecret(request: Request, env: Env): boolean {
  if (!env.RELAY_SECRET) return true; // open if no secret configured
  return request.headers.get("x-relay-secret") === env.RELAY_SECRET;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health — no auth required
    if (url.pathname === "/healthz" || url.pathname === "/health") {
      return Response.json({ ok: true, service: "miruro-relay" });
    }

    // All other endpoints require the shared secret (if configured)
    if (!checkSecret(request, env)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (url.pathname === "/relay") {
      return handleRelay(request, url);
    }

    if (url.pathname === "/pipe") {
      return handlePipe(request, url);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};

// ── /relay — general forward proxy ──────────────────────────────────────────

async function handleRelay(request: Request, url: URL): Promise<Response> {
  const rawUrl = url.searchParams.get("url")?.trim();
  if (!rawUrl) {
    return Response.json({ error: "url query param is required" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return Response.json({ error: "Invalid url" }, { status: 400 });
  }

  if (!isAllowedHost(target.hostname)) {
    return Response.json(
      { error: `Host not allow-listed: ${target.hostname}` },
      { status: 403 }
    );
  }

  // Decode caller-supplied headers (base64 JSON from api-server/miruro-relay.ts)
  let callerHeaders: Record<string, string> = {};
  const encodedHeaders = request.headers.get("x-relay-headers");
  if (encodedHeaders) {
    try {
      callerHeaders = JSON.parse(atob(encodedHeaders));
    } catch {
      // malformed — proceed with empty headers
    }
  }

  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD";

  const upstream = await fetch(target.toString(), {
    method,
    headers: callerHeaders,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  });

  // Strip hop-by-hop headers before forwarding the response.
  // set-cookie is handled separately below since Headers.entries() merges
  // multiple set-cookie values into a single comma-joined string, which
  // corrupts cookies (Expires contains commas) and drops all but one cookie.
  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== "set-cookie") {
      responseHeaders.set(key, value);
    }
  }
  const setCookies =
    typeof (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
    "function"
      ? (upstream.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : [];
  for (const cookie of setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

// ── /pipe — miruro secure pipe passthrough ──────────────────────────────────
//
// Accepts POST with a plain-JSON body describing the pipe request.
// The Worker encodes it to base64url internally — no pre-encoded strings are
// ever sent over the wire, which avoids CF WAF rules that block requests
// containing base64url/JWT-like strings (eyJ...) in params, bodies, or headers.
//
// POST body: { path: string, query: Record<string, unknown>, origin?: string }
// Legacy GET: ?e=<base64url>&origin=<encoded>  (kept for backwards-compat)

async function handlePipe(request: Request, url: URL): Promise<Response> {
  let e: string | null = null;
  let origin = "https://www.miruro.bz";

  if (request.method === "POST") {
    // Preferred path: caller sends plain JSON using short WAF-safe key names.
    //   fn   — pipe endpoint name (e.g. "episodes", "sources")
    //   q    — query params object
    //   host — miruro hostname WITHOUT protocol (Worker prepends https://)
    // No base64url strings, no URLs-with-protocol cross the wire → no WAF triggers.
    // Legacy key `e` (pre-encoded payload) still accepted as fallback.
    type PipeBody = { a?: string; q?: Record<string, unknown>; host?: string; e?: string };
    let body: PipeBody;
    try {
      body = (await request.json()) as PipeBody;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (body.host) origin = `https://${body.host}`;

    if (body.a) {
      // Plain-JSON path — Worker builds & encodes base64url here
      const payload = { path: body.a, method: "GET", query: body.q ?? {}, body: null, version: "0.1.0" };
      e = btoa(JSON.stringify(payload))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    } else if (body.e) {
      // Legacy fallback — pre-encoded payload still accepted
      e = body.e;
    }
  } else {
    // Legacy GET — read from query string
    e = url.searchParams.get("e");
    origin = url.searchParams.get("origin") ?? origin;
  }

  if (!e) {
    return Response.json({ error: "a (or legacy e) is required" }, { status: 400 });
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return Response.json({ error: "Invalid origin" }, { status: 400 });
  }

  if (!isAllowedHost(originUrl.hostname)) {
    return Response.json(
      { error: `Origin not allow-listed: ${originUrl.hostname}` },
      { status: 403 }
    );
  }

  const pipeUrl = `${origin}/api/secure/pipe?e=${encodeURIComponent(e)}`;

  const upstream = await fetch(pipeUrl, {
    method: "GET",
    headers: {
      ...PIPE_BROWSER_HEADERS,
      Referer: `${origin}/`,
      Origin: origin,
    },
  });

  const contentType = upstream.headers.get("content-type") ?? "text/plain";
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": contentType },
  });
}
