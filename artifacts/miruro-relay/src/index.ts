/**
 * Miruro Relay
 *
 * A standalone forward-proxy designed to run on a host whose IP is NOT
 * blocked by Cloudflare (e.g. Render's free tier), unlike Replit's shared
 * datacenter IPs.
 *
 * CF Bypass strategy:
 *  1. On every /relay request, inject cached CF session cookies into the
 *     forwarded headers. If we have a valid session, upstream sees a
 *     real browser's cookie jar and usually returns 200.
 *  2. On 403/429 (session expired or IP rotated), invalidate the cache,
 *     trigger a fresh Playwright + stealth browser solve, then retry once.
 *  3. If the browser solve fails (hard IP block), return 503 so the
 *     api-server can fall back to another streaming server.
 *
 * Optional:
 *  - PROXY_URL env var: route browser + fetch through a proxy
 *    (e.g. http://user:pass@residential-proxy.com:8000 or socks5://...)
 *  - Cookie persistence: cf_clearance is saved to /tmp and reused across
 *    relay restarts, avoiding unnecessary browser launches.
 *
 * Allow-listed upstream hosts (security: prevents open-proxy abuse):
 *   miruro.bz, miruro.to, pro.ultracloud.cc, pru.ultracloud.cc
 */
import express from "express";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import {
  getCfSession,
  injectCfHeaders,
  invalidateCfSession,
  warmCfSession,
} from "./cf-bypass.js";

// Build a proxy dispatcher once at startup (reused across requests for efficiency).
// When PROXY_URL is set, ALL upstream fetches — both plain and cookie-injected —
// are routed through it. This ensures traffic from the relay's server process
// exits via the proxy IP, not the relay host's own IP (which may be CF-blocked).
let proxyDispatcher: ProxyAgent | undefined;
const PROXY_URL = process.env.PROXY_URL;
if (PROXY_URL) {
  try {
    proxyDispatcher = new ProxyAgent(PROXY_URL);
    console.info(
      `[miruro-relay] Proxy dispatcher ready: ${PROXY_URL.replace(/:\/\/.*@/, "://<redacted>@")}`
    );
  } catch (e) {
    console.error("[miruro-relay] Failed to create ProxyAgent:", e);
  }
}

/**
 * Drop-in fetch wrapper that routes through the proxy when PROXY_URL is set.
 * Uses undici's ProxyAgent so authenticated proxies (user:pass@host:port) work
 * correctly — native Node fetch does not support proxy auth natively.
 */
function relayFetch(url: string, init: RequestInit & { redirect?: RequestRedirect }): Promise<Response> {
  if (proxyDispatcher) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return undiciFetch(url, { ...init, dispatcher: proxyDispatcher } as any) as unknown as Promise<Response>;
  }
  return fetch(url, init);
}

const app = express();
const PORT = Number(process.env.PORT) || 10000;

const ALLOWED_HOSTS = [
  "miruro.bz",
  "www.miruro.bz",
  "miruro.to",
  "www.miruro.to",
  "pro.ultracloud.cc",
  "pru.ultracloud.cc",
];

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

/** Whether an upstream status indicates a CF block that requires re-solving */
function isCfBlock(status: number): boolean {
  return status === 403 || status === 429;
}

/** HOP-BY-HOP headers we must strip before forwarding to the caller */
const HOP_BY_HOP = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
]);

// Read raw request body for any method/content-type so we can forward it
// upstream unchanged (works for JSON, form data, binary, etc.).
app.use((req, res, next) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.concat(chunks);
    next();
  });
  req.on("error", next);
});

// ── Health / root ──────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "miruro-relay" });
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// ── Session status (debug) ─────────────────────────────────────────────────

app.get("/status", async (_req, res) => {
  const session = await getCfSession();
  res.json({
    hasCfSession: !!session,
    expiresIn: session
      ? Math.round((session.expiresAt - Date.now()) / 1000) + "s"
      : null,
    proxyConfigured: !!process.env.PROXY_URL,
  });
});

// ── Core relay endpoint ───────────────────────────────────────────────────

app.all("/relay", async (req, res) => {
  const rawUrl = (req.query.url as string | undefined)?.trim();
  if (!rawUrl) {
    res.status(400).json({ error: "url query param is required" });
    return;
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid url" });
    return;
  }

  if (!isAllowedHost(target.hostname)) {
    res.status(403).json({ error: `Host not allow-listed: ${target.hostname}` });
    return;
  }

  // Decode caller-supplied headers (base64 JSON from api-server/miruro-relay.ts)
  let callerHeaders: Record<string, string> = {};
  const encodedHeaders = req.headers["x-relay-headers"];
  if (typeof encodedHeaders === "string" && encodedHeaders.length > 0) {
    try {
      callerHeaders = JSON.parse(
        Buffer.from(encodedHeaders, "base64").toString("utf-8")
      );
    } catch {
      // malformed — proceed with empty headers
    }
  }

  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
  const hasBody =
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    rawBody &&
    rawBody.length > 0;

  /**
   * Perform the actual upstream fetch with optional CF cookie injection.
   * Returns the upstream Response (may be a CF block).
   */
  async function doFetch(withSession: boolean): Promise<Response> {
    let headers = { ...callerHeaders };

    if (withSession) {
      const session = await getCfSession();
      if (session) {
        headers = injectCfHeaders(headers, session);
      }
    }

    return relayFetch(target.toString(), {
      method: req.method,
      headers,
      body: hasBody ? rawBody : undefined,
      redirect: "manual",
    });
  }

  /** Stream a Response back to the caller, copying status + safe headers. */
  function sendUpstream(upstream: Response): void {
    res.status(upstream.status);
    for (const [key, value] of upstream.headers.entries()) {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }
  }

  try {
    // Attempt 1: plain fetch with cached CF cookies injected
    let upstream = await doFetch(true);

    if (isCfBlock(upstream.status)) {
      console.info(
        `[miruro-relay] Got ${upstream.status} from upstream — invalidating CF session, re-solving…`
      );
      // Drain the blocked response body to release the connection before retrying.
      // Skipping this leaves the socket open and can exhaust the connection pool.
      await upstream.body?.cancel().catch(() => {});

      invalidateCfSession();

      // Trigger a fresh browser solve (awaited — we need the new cookies before retrying)
      const newSession = await getCfSession();
      let retryUpstream: Response | null = null;

      if (newSession) {
        // Attempt 2: retry with the freshly-solved cookies
        retryUpstream = await doFetch(true);
      }

      if (!retryUpstream || isCfBlock(retryUpstream.status)) {
        // Drain retry body too (if we got one) before sending error response
        await retryUpstream?.body?.cancel().catch(() => {});
        // Still blocked after re-solve — report 503 so the api-server
        // can surface the "upstream blocked" error and auto-switch servers.
        res.status(503).json({
          error: "CF upstream block — cannot reach miruro.bz from this IP",
        });
        return;
      }

      upstream = retryUpstream;
    }

    sendUpstream(upstream);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: `Relay fetch failed: ${msg}` });
  }
});

// ── Startup ────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[miruro-relay] listening on port ${PORT}`);
  // Pre-warm the CF session in the background so the first request
  // doesn't pay the full browser-launch latency (~10-20 s).
  warmCfSession();
});
