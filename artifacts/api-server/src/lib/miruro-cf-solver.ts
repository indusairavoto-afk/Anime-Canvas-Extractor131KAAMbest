/**
 * Miruro CF Session Solver
 *
 * Uses puppeteer-extra + puppeteer-extra-plugin-stealth + system Chromium
 * to solve Cloudflare Turnstile / JS challenges on miruro.bz.
 *
 * Improvements over the basic puppeteer-core approach:
 *  - puppeteer-extra-plugin-stealth patches 20+ browser fingerprint vectors:
 *    navigator.webdriver, canvas, WebGL, chrome runtime, permission query,
 *    source-url stack traces, sec-ch-ua, iframe content-window, etc.
 *  - Realistic browser context: matching UA, viewport, locale, timezone,
 *    language list, Accept-Language, and sec-ch-ua headers
 *  - Optional proxy routing via MIRURO_PROXY_URL env var
 *    (e.g. http://user:pass@residential-proxy.com:8000)
 *  - Cookie persistence to /tmp (avoids re-launch on warm restarts)
 *  - 10-min cooldown on hard IP blocks
 *  - Concurrent solve deduplication (one browser launch for N waiting requests)
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Register the stealth plugin — must be done before any launch() call
puppeteer.use(StealthPlugin());

const MIRURO_ORIGIN = "https://www.miruro.bz";

/** Cookie persistence file — survives hot restarts without re-launching Chrome */
const COOKIES_CACHE_FILE = "/tmp/miruro-cf-session.json";

/** Cache a valid session for 25 min (cf_clearance is valid ~30 min) */
const SESSION_TTL_MS = 25 * 60 * 1000;
/** How long to wait for CF challenge to pass */
const CHALLENGE_TIMEOUT_MS = 40_000;
/** After a hard IP block, back off this long before trying again */
const COOLDOWN_MS = 10 * 60 * 1000;

/**
 * System Chromium path — installed by Nix, its wrapper script already sets
 * up the correct LD_LIBRARY_PATH.
 */
const CHROMIUM_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser";

/**
 * CF bypass extension path — provides an extra layer of Cloudflare challenge
 * solving on top of what the stealth plugin provides.
 */
const EXTENSION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../cf-extension"
);

export interface CfSession {
  cookieHeader: string;
  userAgent: string;
  expiresAt: number;
}

let currentSession: CfSession | null = null;
/** When > Date.now(), skip solve attempts (IP is hard-blocked) */
let cooldownUntil = 0;
/** Deduplicate concurrent solve requests — share one in-flight promise */
let solvePromise: Promise<CfSession | null> | null = null;

/** CF hard-block phrases — when found the IP is banned and solving is pointless */
const HARD_BLOCK_PHRASES = [
  "Sorry, you have been blocked",
  "Attention Required",
  "This website is using a security service",
  "You have been blocked",
  "Access denied",
];

// ---------------------------------------------------------------------------
// Cookie persistence
// ---------------------------------------------------------------------------

function loadDiskSession(): CfSession | null {
  try {
    const raw = fs.readFileSync(COOKIES_CACHE_FILE, "utf-8");
    const s = JSON.parse(raw) as CfSession;
    if (s.expiresAt > Date.now()) return s;
  } catch {
    /* file missing or corrupt */
  }
  return null;
}

function saveDiskSession(s: CfSession): void {
  try {
    fs.writeFileSync(COOKIES_CACHE_FILE, JSON.stringify(s));
  } catch {
    /* non-fatal */
  }
}

function deleteDiskSession(): void {
  try {
    fs.unlinkSync(COOKIES_CACHE_FILE);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Extension check (non-fatal)
// ---------------------------------------------------------------------------

if (!fs.existsSync(EXTENSION_PATH)) {
  console.warn(
    `[miruro-cf] Extension not found at ${EXTENSION_PATH} — stealth plugin covers most CF evasion without it.`
  );
} else {
  console.info(`[miruro-cf] CF bypass extension ready at ${EXTENSION_PATH}`);
}

// ---------------------------------------------------------------------------
// Browser launch + CF solve
// ---------------------------------------------------------------------------

async function launchSolve(): Promise<CfSession | null> {
  console.info("[miruro-cf] Launching Puppeteer + stealth + CF extension…");

  const proxyUrl = process.env.MIRURO_PROXY_URL;

  const args = [
    // Load the CF bypass extension for an extra challenge-solving layer
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    // Stealth / sandbox
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1280,800",
    // Realistic language signals
    "--lang=en-US,en;q=0.9",
    "--accept-lang=en-US,en;q=0.9",
  ];

  // Parse proxy credentials separately — Chromium's --proxy-server flag
  // accepts host:port only; credentials must be supplied via page.authenticate().
  let proxyServer: string | undefined;
  let proxyAuth: { username: string; password: string } | undefined;
  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      proxyServer = `${u.protocol}//${u.host}`;
      args.push(`--proxy-server=${proxyServer}`);
      if (u.username) {
        proxyAuth = {
          username: decodeURIComponent(u.username),
          password: decodeURIComponent(u.password),
        };
      }
      console.info(`[miruro-cf] Using proxy: ${proxyServer}`);
    } catch {
      console.warn("[miruro-cf] Could not parse MIRURO_PROXY_URL — ignoring proxy");
    }
  }

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;

  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      // headless: true uses Chrome's --headless=new (Chrome 112+) which
      // supports loading Chrome extensions.
      headless: true,
      args,
    });
  } catch (err) {
    console.error("[miruro-cf] Failed to launch Puppeteer:", err);
    return null;
  }

  try {
    const page = await browser.newPage();

    // Authenticate with proxy if credentials were provided
    if (proxyAuth) {
      await page.authenticate(proxyAuth);
    }

    // Stealth plugin already patches most fingerprint vectors.
    // Belt-and-suspenders: also patch via evaluateOnNewDocument.
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      if (!navigator.plugins.length) {
        Object.defineProperty(navigator, "plugins", {
          get: () => [1, 2, 3, 4, 5] as unknown as PluginArray,
        });
      }
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
    });

    // Realistic UA matching the Chromium binary version
    const UA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 800 });

    // Inject realistic browser-level headers
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      "sec-ch-ua":
        '"Chromium";v="138", "Google Chrome";v="138", "Not=A?Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    });

    await page.goto(`${MIRURO_ORIGIN}/health`, {
      waitUntil: "domcontentloaded",
      timeout: CHALLENGE_TIMEOUT_MS,
    });

    // Fast-fail: detect hard IP block (string eval avoids TS "document not found" in Node scope)
    const bodyText: string = await page
      .evaluate("document.body ? document.body.innerText : ''")
      .then((v: unknown) => String(v ?? ""))
      .catch(() => "");

    const isHardBlocked = HARD_BLOCK_PHRASES.some((phrase) =>
      bodyText.includes(phrase)
    );
    if (isHardBlocked) {
      console.warn(
        `[miruro-cf] CF hard-block detected — cooling down for ${COOLDOWN_MS / 60_000} min`
      );
      cooldownUntil = Date.now() + COOLDOWN_MS;
      return null;
    }

    // Wait for CF JS challenge to self-resolve
    await page
      .waitForFunction(
        () => {
          const txt = document.body?.innerText ?? "";
          return (
            !txt.includes("Just a moment") &&
            !txt.includes("security verification") &&
            !txt.includes("Checking your browser") &&
            !txt.includes("Please wait")
          );
        },
        { timeout: CHALLENGE_TIMEOUT_MS, polling: 500 }
      )
      .catch(() => {
        console.warn(
          "[miruro-cf] Challenge wait timed out — extracting cookies anyway"
        );
      });

    const cookies = await page.cookies();
    const userAgent: string = await page
      .evaluate(() => navigator.userAgent)
      .catch(() => UA);

    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const cfCookie = cookies.find((c) => c.name === "cf_clearance");

    if (!cfCookie) {
      console.warn(
        "[miruro-cf] cf_clearance not found — CF challenge did not resolve. Setting cooldown."
      );
      cooldownUntil = Date.now() + COOLDOWN_MS;
      return null;
    }

    console.info("[miruro-cf] CF solved ✓  cf_clearance acquired");
    const session: CfSession = {
      cookieHeader,
      userAgent,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    currentSession = session;
    saveDiskSession(session);
    return session;
  } catch (err) {
    console.error("[miruro-cf] Error during CF solve:", err);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a valid CF session (memory → disk → browser solve).
 * Returns null if:
 *  - CF hard-blocked this IP (cooldown active)
 *  - Browser launch failed
 */
export async function getCfSession(): Promise<CfSession | null> {
  // 1. Memory cache
  if (currentSession && Date.now() < currentSession.expiresAt)
    return currentSession;

  // 2. Disk cache (survives hot restarts without re-launching Chrome)
  const disk = loadDiskSession();
  if (disk) {
    currentSession = disk;
    console.debug("[miruro-cf] Restored CF session from disk cache");
    return disk;
  }

  // 3. Cooldown guard
  if (Date.now() < cooldownUntil) {
    const remainSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
    console.debug(
      `[miruro-cf] IP cooldown active (${remainSec}s remaining), skipping solve`
    );
    return null;
  }

  // 4. Deduplicated browser solve
  if (solvePromise) return solvePromise;
  solvePromise = launchSolve().finally(() => {
    solvePromise = null;
  });
  return solvePromise;
}

/** Invalidate cached session (call when a fetch returns 403). */
export function invalidateCfSession(): void {
  currentSession = null;
  deleteDiskSession();
  console.info("[miruro-cf] Session invalidated");
}

/**
 * Kick off a background CF solve at startup to pre-warm the session.
 * First user request to Miruro will find cookies ready.
 */
export function warmCfSession(): void {
  if (currentSession && Date.now() < currentSession.expiresAt) return;
  if (Date.now() < cooldownUntil) return;
  getCfSession().catch(() => {});
}
