/**
 * Miruro Relay
 *
 * A tiny, standalone forward-proxy meant to run on a host whose IP is NOT
 * blocked by Cloudflare (e.g. Render's free tier), unlike Replit's shared
 * datacenter IPs. It has no knowledge of Miruro's app logic — it just
 * forwards whatever request it receives to an allow-listed upstream host
 * and streams the response back byte-for-byte, including headers.
 *
 * The Replit-hosted api-server calls this relay instead of calling
 * miruro.bz / ultracloud.cc directly, so all the existing miruro.ts proxy
 * logic (HTML rewriting, env2.js patching, etc.) keeps working unchanged —
 * only the final network hop moves to a non-blocked IP.
 *
 * Usage from the caller:
 *   GET/POST/... {RELAY_URL}/relay?url=<encodeURIComponent(fullTargetUrl)>
 *   Header "x-relay-headers": base64(JSON.stringify(headersToSendUpstream))
 *
 * Security: only forwards to an allow-listed set of hostnames to prevent
 * this relay from being abused as an open proxy.
 */
import express from "express";

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

// Read the raw request body as a Buffer for any method/content-type so we can
// forward it upstream unchanged (works for JSON, form data, binary, etc.).
app.use((req, res, next) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.concat(chunks);
    next();
  });
  req.on("error", next);
});

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "miruro-relay" });
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

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

  let forwardHeaders: Record<string, string> = {};
  const encodedHeaders = req.headers["x-relay-headers"];
  if (typeof encodedHeaders === "string" && encodedHeaders.length > 0) {
    try {
      forwardHeaders = JSON.parse(Buffer.from(encodedHeaders, "base64").toString("utf-8"));
    } catch {
      // ignore malformed header blob, forward with no extra headers
    }
  }

  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && rawBody && rawBody.length > 0;

  try {
    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers: forwardHeaders,
      body: hasBody ? rawBody : undefined,
      redirect: "manual",
    });

    res.status(upstream.status);
    for (const [key, value] of upstream.headers.entries()) {
      const k = key.toLowerCase();
      // Skip hop-by-hop / encoding headers that Node's fetch already decoded
      // or that would conflict with Express's own response handling.
      if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) {
        continue;
      }
      res.setHeader(key, value);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: `Relay fetch failed: ${msg}` });
  }
});

app.listen(PORT, () => {
  console.log(`[miruro-relay] listening on port ${PORT}`);
});
