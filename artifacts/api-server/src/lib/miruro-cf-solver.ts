/**
 * Miruro CF Session Solver
 *
 * Uses Puppeteer with the system Chromium + cloudflare-bypass-extension
 * to solve Cloudflare challenges on miruro.bz, caches the resulting
 * cookies, and provides them for all miruro fetch() calls.
 *
 * Strategy:
 *  1. `miruroFetch()` in miruro.ts tries a plain fetch first.
 *  2. On 403, `getCfSession()` is called — launches Chrome with the CF bypass
 *     extension loaded, which gives a realistic browser fingerprint.
 *  3. If the page shows a CF hard-block ("Sorry, you have been blocked"),
 *     we detect it quickly, set a 10-min cooldown, and return null so the
 *     caller can report 503 to the frontend immediately.
 *  4. If CF is solvable, cf_clearance is extracted and cached for 25 min.
 *
 * Extension: cf-extension/ (Manifest V2, loaded from source dir)
 * Chromium: system Chromium installed via Nix (v138, supports --headless=new)
 */

import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIRURO_ORIGIN = "https://www.miruro.bz";
/** Cache a valid session for 25 min (cf_clearance is valid ~30 min) */
const SESSION_TTL_MS = 25 * 60 * 1000;
/** How long to wait for CF challenge to pass */
const CHALLENGE_TIMEOUT_MS = 35_000;
/** After a hard IP block, back off this long before trying again */
const COOLDOWN_MS = 10 * 60 * 1000;

/**
 * System Chromium path — installed by Nix, its wrapper script already sets
 * up the correct LD_LIBRARY_PATH so we don't need to patch it manually.
 */
const CHROMIUM_PATH =
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser";

/**
 * CF bypass extension path — resolved from the package root (one level above
 * dist/) so it works whether run from source or compiled output.
 * cf-extension/ lives at artifacts/api-server/cf-extension/.
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
/** When > Date.now(), skip solve attempts (IP known to be hard-blocked) */
let cooldownUntil = 0;
/** De-dup: concurrent callers share the same in-flight solve promise */
let solvePromise: Promise<CfSession | null> | null = null;

/** CF hard-block phrases — when present, IP is banned and solving is impossible */
const HARD_BLOCK_PHRASES = [
  "Sorry, you have been blocked",
  "Attention Required",
  "This website is using a security service",
  "You have been blocked",
];

async function launchSolve(): Promise<CfSession | null> {
  console.info(
    "[miruro-cf] Launching Puppeteer + CF bypass extension…",
    `extension=${EXTENSION_PATH}`
  );

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      // headless: true uses Chrome's --headless=new mode (Chrome 112+)
      // which supports loading Chrome extensions — unlike the old headless shell.
      headless: true,
      args: [
        // Load the CF bypass extension
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        // Stealth / sandbox flags
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,800",
        // Realistic language / platform
        "--lang=en-US,en;q=0.9",
        "--accept-lang=en-US,en;q=0.9",
      ],
    });
  } catch (err) {
    console.error("[miruro-cf] Failed to launch Puppeteer:", err);
    return null;
  }

  try {
    const page = await browser.newPage();

    // Spoof navigator.webdriver = false (Puppeteer sets it to true by default)
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(`${MIRURO_ORIGIN}/health`, {
      waitUntil: "domcontentloaded",
      timeout: CHALLENGE_TIMEOUT_MS,
    });

    // Fast-fail: if CF shows a hard-block page, the IP is banned — no challenge to solve.
    const bodyText: string = await page
      .evaluate(() => document.body?.innerText ?? "")
      .catch(() => "");

    const isHardBlocked = HARD_BLOCK_PHRASES.some((phrase) =>
      bodyText.includes(phrase)
    );
    if (isHardBlocked) {
      console.warn(
        `[miruro-cf] CF hard-block detected — this IP is banned. ` +
          `Cooling down for ${COOLDOWN_MS / 60_000} min.`
      );
      cooldownUntil = Date.now() + COOLDOWN_MS;
      return null;
    }

    // Wait for the CF JS challenge to auto-clear (the extension + real Chrome helps here).
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
      .catch(() => "");
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
    return session;
  } catch (err) {
    console.error("[miruro-cf] Error during CF solve:", err);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

/**
 * Get a valid CF session, launching Puppeteer if necessary.
 * Returns null if:
 *  - CF hard-blocked this IP (sets a cooldown to prevent hammering)
 *  - Still in cooldown from a previous hard-block
 *  - Browser launch failed
 */
export async function getCfSession(): Promise<CfSession | null> {
  if (currentSession && Date.now() < currentSession.expiresAt)
    return currentSession;

  if (Date.now() < cooldownUntil) {
    const remainSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
    console.debug(
      `[miruro-cf] IP cooldown active (${remainSec}s remaining), skipping solve`
    );
    return null;
  }

  if (solvePromise) return solvePromise;
  solvePromise = launchSolve().finally(() => {
    solvePromise = null;
  });
  return solvePromise;
}

/** Invalidate the cached session (call when a fetch returns 403). */
export function invalidateCfSession(): void {
  currentSession = null;
}

/**
 * Kick off a background solve at startup to pre-warm the session.
 * Completes in ~10-20s; subsequent miruro requests will have CF cookies ready.
 */
export function warmCfSession(): void {
  if (currentSession && Date.now() < currentSession.expiresAt) return;
  if (Date.now() < cooldownUntil) return;
  getCfSession().catch(() => {});
}
