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
      return handlePipe(url);
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

  // Strip hop-by-hop headers before forwarding the response
  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

// ── /pipe — miruro secure pipe passthrough ──────────────────────────────────

async function handlePipe(url: URL): Promise<Response> {
  const e = url.searchParams.get("e");
  if (!e) {
    return Response.json({ error: "e query param is required" }, { status: 400 });
  }

  const origin = url.searchParams.get("origin") ?? "https://www.miruro.bz";

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
