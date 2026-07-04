/**
 * Cloudflare Bypass for Miruro Relay
 *
 * Uses playwright-extra + puppeteer-extra-plugin-stealth to solve CF challenges,
 * then caches the resulting cf_clearance cookie for subsequent plain fetches.
 *
 * Features:
 *  - Full browser fingerprint spoofing via stealth plugin (canvas, WebGL,
 *    navigator.webdriver, sec-ch-ua, etc.)
 *  - Cookie persistence to /tmp (survives relay process restarts)
 *  - Optional proxy routing via PROXY_URL env var
 *    (e.g. http://user:pass@host:port or socks5://host:port)
 *  - 10-min cooldown on hard IP blocks to avoid hammering CF
 *  - Deduplicated in-flight solve (concurrent requests share one browser launch)
 */

import fs from "node:fs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIRURO_ORIGIN = "https://www.miruro.bz";
const COOKIES_CACHE_FILE = "/tmp/miruro-cf-cookies.json";
/** Cache valid session for 25 min (cf_clearance lasts ~30 min) */
const SESSION_TTL_MS = 25 * 60 * 1000;
/** Max wait for CF JS challenge to clear */
const CHALLENGE_TIMEOUT_MS = 40_000;
/** After hard block, back off before retrying */
const COOLDOWN_MS = 10 * 60 * 1000;

/** Known Chromium binary paths to check, in priority order */
const CHROMIUM_CANDIDATES = [
  // Replit / Nix-installed Chromium
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser",
  // Common Linux paths (Render, Fly, Railway, etc.)
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
];

/** CF hard-block signature phrases */
const HARD_BLOCK_PHRASES = [
  "Sorry, you have been blocked",
  "Attention Required",
  "You have been blocked",
  "Access denied",
  "cf-error-details",
  "Cloudflare Ray ID",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CfSession {
  cookieHeader: string;
  userAgent: string;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let cachedSession: CfSession | null = null;
let cooldownUntil = 0;
let solvePromise: Promise<CfSession | null> | null = null;

// ---------------------------------------------------------------------------
// Cookie persistence
// ---------------------------------------------------------------------------

function loadDiskSession(): CfSession | null {
  try {
    const raw = fs.readFileSync(COOKIES_CACHE_FILE, "utf-8");
    const s = JSON.parse(raw) as CfSession;
    if (s.expiresAt > Date.now()) return s;
  } catch {
    // file missing or corrupt — ignore
  }
  return null;
}

function saveDiskSession(s: CfSession): void {
  try {
    fs.writeFileSync(COOKIES_CACHE_FILE, JSON.stringify(s));
  } catch {
    // non-fatal — just skip persistence
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
// Header injection
// ---------------------------------------------------------------------------

/**
 * Merges the CF session's Cookie + User-Agent into an existing headers object.
 * If the caller already set a Cookie header, the CF cookies are appended.
 */
export function injectCfHeaders(
  headers: Record<string, string>,
  session: CfSession
): Record<string, string> {
  const existing = headers["cookie"] ?? headers["Cookie"] ?? "";
  const merged = existing
    ? `${existing}; ${session.cookieHeader}`
    : session.cookieHeader;

  return {
    ...headers,
    Cookie: merged,
    "User-Agent": session.userAgent,
    // Realistic sec-ch-ua hints (matching the UA version)
    "sec-ch-ua":
      '"Chromium";v="138", "Google Chrome";v="138", "Not=A?Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  };
}

// ---------------------------------------------------------------------------
// Chromium detection
// ---------------------------------------------------------------------------

function findSystemChromium(): string | undefined {
  for (const p of CHROMIUM_CANDIDATES) {
    if (fs.existsSync(p)) {
      console.info(`[cf-bypass] Found system Chromium: ${p}`);
      return p;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Browser-based CF solve
// ---------------------------------------------------------------------------

async function launchBrowserSolve(): Promise<CfSession | null> {
  console.info("[cf-bypass] Launching Playwright + stealth to solve CF challenge…");

  // Dynamic imports so the module loads even if playwright isn't installed yet
  // (lets the relay start and fall back to plain fetch when browser is unavailable)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chromium: any;

  try {
    const playwrightExtra = await import("playwright-extra");
    const stealthMod = await import("puppeteer-extra-plugin-stealth");
    chromium = playwrightExtra.chromium;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const StealthPlugin = (stealthMod.default as any)();
    chromium.use(StealthPlugin);
  } catch (importErr) {
    console.error("[cf-bypass] Failed to import playwright-extra / stealth:", importErr);
    return null;
  }

  const proxyUrl = process.env.PROXY_URL;
  const executablePath = findSystemChromium();

  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1280,800",
    "--lang=en-US",
    // Mimic a real user's Accept-Language
    "--accept-lang=en-US,en;q=0.9",
    // Disable WebRTC IP leak (stealth covers it, but belt+suspenders)
    "--disable-webrtc-ip-handling-policy",
    "--enforce-webrtc-ip-permission-check",
  ];

  // Parse proxy URL to extract server + credentials separately.
  // Chromium's --proxy-server flag accepts host:port (no credentials);
  // credentials must be supplied via browser context proxy auth instead.
  let parsedProxy: { server: string; username?: string; password?: string } | undefined;
  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      parsedProxy = {
        server: `${u.protocol}//${u.host}`,
        ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
        ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
      };
      // Pass server-only URL to launch arg (credentials go in newContext below)
      launchArgs.push(`--proxy-server=${parsedProxy.server}`);
      console.info(`[cf-bypass] Using proxy: ${parsedProxy.server}`);
    } catch {
      console.warn("[cf-bypass] Could not parse PROXY_URL — ignoring proxy");
    }
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath, // undefined → Playwright downloads its own Chromium
      args: launchArgs,
    });
  } catch (launchErr) {
    console.error("[cf-bypass] Failed to launch browser:", launchErr);
    return null;
  }

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      timezoneId: "America/New_York",
      // Proxy auth at context level — this is where Playwright handles credentials
      ...(parsedProxy ? { proxy: parsedProxy } : {}),
      // Realistic browser-level HTTP headers
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "sec-ch-ua":
          '"Chromium";v="138", "Google Chrome";v="138", "Not=A?Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Upgrade-Insecure-Requests": "1",
      },
    });

    const page = await context.newPage();

    // Belt-and-suspenders webdriver evasion on top of what stealth does
    // (runs in browser context — DOM globals are valid here)
    await page.addInitScript(/* @__PURE__ */ (() => {
      // This function body executes inside the browser, not Node.js
      // @ts-ignore browser context
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // @ts-ignore browser context
      if (!navigator.plugins || !navigator.plugins.length) {
        // @ts-ignore browser context
        Object.defineProperty(navigator, "plugins", {
          get: () => [1, 2, 3, 4, 5],
        });
      }
      // @ts-ignore browser context
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
    }) as () => void);

    // Navigate to health endpoint — lightweight page, no app JS to load
    const targetUrl = `${MIRURO_ORIGIN}/health`;
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: CHALLENGE_TIMEOUT_MS,
    });

    // Fast-fail: hard IP block check (string-eval avoids TS "document not found" in Node context)
    const bodyText = await page
      .evaluate("document.body?.innerText ?? ''")
      .then((v: unknown) => String(v ?? ""))
      .catch(() => "");
    const isHardBlocked = HARD_BLOCK_PHRASES.some((p) => bodyText.includes(p));
    if (isHardBlocked) {
      console.warn(
        `[cf-bypass] Hard IP block detected — cooling down for ${COOLDOWN_MS / 60_000} min`
      );
      cooldownUntil = Date.now() + COOLDOWN_MS;
      return null;
    }

    // Wait for CF JS challenge to self-resolve (string-eval avoids TS "document not found")
    await page
      .waitForFunction(
        `(function(){
          var txt = document.body ? document.body.innerText : '';
          return !txt.includes('Just a moment') &&
                 !txt.includes('Checking your browser') &&
                 !txt.includes('Please wait') &&
                 !txt.includes('security verification');
        })()`,
        { timeout: CHALLENGE_TIMEOUT_MS, polling: 500 }
      )
      .catch(() => {
        console.warn("[cf-bypass] Challenge wait timed out — extracting cookies anyway");
      });

    const cookies = await context.cookies();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userAgent = await page
      .evaluate(
        // @ts-ignore — runs in browser context where navigator is defined
        () => navigator.userAgent as string
      )
      .catch(
        () =>
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
      );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfCookie = (cookies as any[]).find((c) => c.name === "cf_clearance");
    if (!cfCookie) {
      console.warn(
        "[cf-bypass] cf_clearance cookie not found after challenge — setting cooldown"
      );
      cooldownUntil = Date.now() + COOLDOWN_MS;
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cookieHeader = (cookies as any[]).map((c) => `${c.name}=${c.value}`).join("; ");
    const session: CfSession = {
      cookieHeader,
      userAgent,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };

    cachedSession = session;
    saveDiskSession(session);
    console.info("[cf-bypass] CF solved ✓ cf_clearance acquired");
    return session;
  } catch (err) {
    console.error("[cf-bypass] Error during browser solve:", err);
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a valid CF session (memory → disk → browser solve).
 * Returns null when IP is hard-blocked or browser launch fails.
 */
export async function getCfSession(): Promise<CfSession | null> {
  // 1. Memory cache
  if (cachedSession && Date.now() < cachedSession.expiresAt) return cachedSession;

  // 2. Disk cache (survives relay restarts without re-solving)
  const disk = loadDiskSession();
  if (disk) {
    cachedSession = disk;
    console.debug("[cf-bypass] Restored CF session from disk cache");
    return disk;
  }

  // 3. Cooldown guard
  if (Date.now() < cooldownUntil) {
    const remainSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
    console.debug(`[cf-bypass] Cooldown active — ${remainSec}s remaining`);
    return null;
  }

  // 4. Deduplicate concurrent callers (one browser launch for N requests)
  if (solvePromise) return solvePromise;
  solvePromise = launchBrowserSolve().finally(() => {
    solvePromise = null;
  });
  return solvePromise;
}

/** Invalidate the cached session (call when upstream returns 403). */
export function invalidateCfSession(): void {
  cachedSession = null;
  deleteDiskSession();
  console.info("[cf-bypass] CF session invalidated");
}

/** Warm up a CF session in the background at startup. */
export function warmCfSession(): void {
  if (cachedSession && Date.now() < cachedSession.expiresAt) return;
  if (Date.now() < cooldownUntil) return;
  getCfSession().catch(() => {});
}
