/**
 * VoidStream HLS Extractor
 *
 * Uses a SINGLETON Puppeteer browser (launched once, pages reused) to
 * navigate to embed provider pages and intercept the HLS .m3u8 URL.
 *
 * Key design decisions:
 *  - Browser launched once on first call; pages are cheap to open/close.
 *  - extractHlsBatch() tries all providers IN PARALLEL and resolves with
 *    the first successful URL — no serial waterfall delays.
 *  - Per-page timeout is 12 s (fail-fast); overall batch timeout is 14 s.
 *  - Results are cached 2 h in-memory.
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const CHROMIUM_PATH =
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser";

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const PAGE_TIMEOUT_MS = 13_000;           // per-provider page timeout
const BATCH_TIMEOUT_MS = 18_000;          // overall batch timeout (11 providers in parallel)

const hlsCache = new Map<string, { hlsUrl: string; expiresAt: number }>();

/** Ad/tracker domain fragments — abort matching requests to speed things up */
const AD_FRAGMENTS = [
  "googlesyndication.com",
  "doubleclick.net",
  "google-analytics.com",
  "googletagmanager.com",
  "adnxs.com",
  "amazon-adsystem.com",
  "criteo.com",
  "taboola.com",
  "outbrain.com",
  "popads.net",
  "popcash.net",
  "propellerads.com",
  "exoclick.com",
  "trafficjunky.net",
  "juicyads.com",
  "trafficstars.com",
  "mgid.com",
  "adservice.google",
  "pagead2.google",
];

function isAdUrl(url: string): boolean {
  return AD_FRAGMENTS.some((f) => url.includes(f));
}

// ---------------------------------------------------------------------------
// Singleton browser
// ---------------------------------------------------------------------------

type PuppeteerBrowser = Awaited<ReturnType<typeof puppeteer.launch>>;

let _browser: PuppeteerBrowser | null = null;
let _browserLaunchPromise: Promise<PuppeteerBrowser> | null = null;

async function getBrowser(): Promise<PuppeteerBrowser> {
  // Already have a live browser
  if (_browser) return _browser;

  // Deduplicate concurrent launch requests
  if (_browserLaunchPromise) return _browserLaunchPromise;

  _browserLaunchPromise = (async () => {
    console.info("[voidstream-hls] launching singleton browser…");
    const b = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--mute-audio",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-default-apps",
        "--no-first-run",
        "--window-size=1280,720",
      ],
    });

    b.on("disconnected", () => {
      console.warn("[voidstream-hls] browser disconnected — will relaunch on next request");
      _browser = null;
      _browserLaunchPromise = null;
    });

    _browser = b;
    _browserLaunchPromise = null;
    console.info("[voidstream-hls] browser ready");
    return b;
  })();

  return _browserLaunchPromise;
}

// ---------------------------------------------------------------------------
// Single-provider extraction (opens one page in the shared browser)
// ---------------------------------------------------------------------------

async function extractHlsFromEmbed(embedUrl: string): Promise<string | null> {
  // Cache hit
  const hit = hlsCache.get(embedUrl);
  if (hit && hit.expiresAt > Date.now()) {
    console.info(`[voidstream-hls] cache hit: ${embedUrl}`);
    return hit.hlsUrl;
  }

  const browser = await getBrowser();

  let page: Awaited<ReturnType<PuppeteerBrowser["newPage"]>> | null = null;
  try {
    page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 720 });

    // Block JS-initiated popups
    await page.evaluateOnNewDocument(() => {
      window.open = () => null;
    });

    await page.setRequestInterception(true);

    let resolveHls: ((url: string) => void) | null = null;
    const hlsFound = new Promise<string>((resolve) => {
      resolveHls = resolve;
    });

    page.on("request", (req: { url: () => string; abort: (r?: string) => Promise<void>; continue: () => Promise<void> }) => {
      const url = req.url();
      if (isAdUrl(url)) { req.abort("blockedbyclient").catch(() => {}); return; }
      // Intercept by URL pattern: .m3u8 in path (most providers)
      if (
        resolveHls &&
        url.includes(".m3u8") &&
        !url.includes("/ads/") &&
        !url.includes("ad-") &&
        !url.includes("advertisement")
      ) {
        resolveHls(url);
      }
      req.continue().catch(() => {});
    });

    // Also intercept responses by Content-Type so we catch providers
    // that serve HLS through opaque proxy URLs (no .m3u8 in path).
    page.on("response", (resp: { url: () => string; headers: () => Record<string, string> }) => {
      if (!resolveHls) return;
      const url = resp.url();
      if (isAdUrl(url)) return;
      const ct = (resp.headers()["content-type"] ?? "").toLowerCase();
      if (
        (ct.includes("mpegurl") || ct.includes("x-mpegurl")) &&
        !url.includes("/ads/") &&
        !url.includes("ad-")
      ) {
        resolveHls(url);
      }
    });

    page
      .goto(embedUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS })
      .catch(() => {});

    const hlsUrl = await Promise.race<string | null>([
      hlsFound,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PAGE_TIMEOUT_MS)),
    ]);

    if (hlsUrl) {
      console.info(`[voidstream-hls] found HLS (${new URL(embedUrl).hostname}): ${hlsUrl.slice(0, 80)}…`);
      hlsCache.set(embedUrl, { hlsUrl, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    return hlsUrl;
  } catch (err) {
    console.warn("[voidstream-hls] page error:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Batch extraction — try all providers IN PARALLEL, return first hit
// ---------------------------------------------------------------------------

/**
 * Given an ordered list of embed URLs (providers), opens one page per
 * provider simultaneously and resolves with the first URL that returns an
 * .m3u8 response. Falls back to null if every provider times out.
 *
 * The providers list is ordered by preference; priority() converts order
 * index into a small head-start delay so the preferred provider wins ties.
 */
export async function extractHlsBatch(
  providers: { id: string; label: string; iframeUrl: string }[]
): Promise<{ hlsUrl: string; providerId: string; providerLabel: string; embedUrl: string } | null> {
  if (providers.length === 0) return null;

  return new Promise((resolve) => {
    let settled = false;
    let pending = providers.length;

    const finish = (result: { hlsUrl: string; providerId: string; providerLabel: string; embedUrl: string } | null) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    // Overall hard timeout
    const hardTimeout = setTimeout(() => finish(null), BATCH_TIMEOUT_MS);

    providers.forEach((p, idx) => {
      // Stagger by 150 ms so we don't open all tabs simultaneously
      setTimeout(() => {
        if (settled) { pending--; return; }
        extractHlsFromEmbed(p.iframeUrl)
          .then((hlsUrl) => {
            if (hlsUrl && !settled) {
              clearTimeout(hardTimeout);
              finish({ hlsUrl, providerId: p.id, providerLabel: p.label, embedUrl: p.iframeUrl });
            }
          })
          .catch(() => {})
          .finally(() => {
            pending--;
            if (pending === 0) { clearTimeout(hardTimeout); finish(null); }
          });
      }, idx * 150);
    });
  });
}

export { extractHlsFromEmbed };

// Pre-warm the browser on module load so the first user request doesn't pay
// the launch cost. Errors here are non-fatal (browser will be launched on demand).
getBrowser().catch(() => {});
