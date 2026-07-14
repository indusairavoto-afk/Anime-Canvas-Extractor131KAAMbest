/**
 * VoidStream HLS Extractor
 *
 * Uses Puppeteer + stealth to navigate to a third-party embed provider
 * (vidapi.xyz, videasy.net, vidfast.to, etc.) and intercept the HLS
 * manifest URL that the player fetches. This lets us serve the raw stream
 * through our own HLS player — no ads, no redirects, no popups.
 *
 * Results are cached in-memory for 2 hours to avoid repeated browser
 * launches for the same episode/provider combination.
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const CHROMIUM_PATH =
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser";

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const EXTRACT_TIMEOUT_MS = 22_000; // 22 s total per provider

/** Simple in-memory cache: embedUrl → { hlsUrl, expiresAt } */
const hlsCache = new Map<string, { hlsUrl: string; expiresAt: number }>();

/** Ad / tracker domain fragments — abort matching requests to speed up extraction */
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

/**
 * Navigate to an embed provider URL in a headless browser, intercept all
 * network requests, and return the first .m3u8 URL found.
 * Returns null on timeout or unrecoverable error.
 */
export async function extractHlsFromEmbed(embedUrl: string): Promise<string | null> {
  // Cache hit
  const hit = hlsCache.get(embedUrl);
  if (hit && hit.expiresAt > Date.now()) {
    console.info(`[voidstream-hls] cache hit: ${embedUrl}`);
    return hit.hlsUrl;
  }

  console.info(`[voidstream-hls] launching browser for: ${embedUrl}`);
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch({
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

    const page = await browser.newPage();

    // Realistic desktop UA
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 720 });

    // Block JS-initiated popups
    await page.evaluateOnNewDocument(() => {
      window.open = () => null;
    });

    // Enable request interception so we can block ads and detect .m3u8
    await page.setRequestInterception(true);

    let resolveHls: ((url: string) => void) | null = null;
    const hlsFound = new Promise<string>((resolve) => {
      resolveHls = resolve;
    });

    page.on("request", (request: { url: () => string; abort: (r?: string) => Promise<void>; continue: () => Promise<void> }) => {
      const url = request.url();

      // Block ad/tracker requests
      if (isAdUrl(url)) {
        request.abort("blockedbyclient").catch(() => {});
        return;
      }

      // Detect .m3u8 manifest URLs (skip known ad manifest patterns)
      if (
        resolveHls &&
        url.includes(".m3u8") &&
        !url.includes("/ads/") &&
        !url.includes("ad-") &&
        !url.includes("advertisement")
      ) {
        resolveHls(url);
      }

      request.continue().catch(() => {});
    });

    // Navigate; DOMContentLoaded is enough — video loads after JS runs
    page
      .goto(embedUrl, { waitUntil: "domcontentloaded", timeout: EXTRACT_TIMEOUT_MS })
      .catch(() => {
        /* timeout here is OK — we continue waiting for the m3u8 request */
      });

    // Race: first .m3u8 request vs overall timeout
    const hlsUrl = await Promise.race<string | null>([
      hlsFound,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), EXTRACT_TIMEOUT_MS)
      ),
    ]);

    if (hlsUrl) {
      console.info(`[voidstream-hls] found HLS: ${hlsUrl}`);
      hlsCache.set(embedUrl, { hlsUrl, expiresAt: Date.now() + CACHE_TTL_MS });
    } else {
      console.info(`[voidstream-hls] timed out, no m3u8 found for: ${embedUrl}`);
    }

    return hlsUrl;
  } catch (err) {
    console.warn(
      "[voidstream-hls] extraction error:",
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
