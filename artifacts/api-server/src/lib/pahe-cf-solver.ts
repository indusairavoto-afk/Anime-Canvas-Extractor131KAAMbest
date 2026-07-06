/**
 * AnimePahe CF Session Solver
 *
 * animepahe.pw serves a real Cloudflare "Just a moment..." JS/Turnstile
 * challenge (not a plain IP block like miruro.bz), so neither a simple
 * CF-edge relay nor curl_cffi TLS impersonation can get past it — both
 * were tested and returned the challenge page. Only an actual browser
 * that can run the challenge JS (Turnstile) works.
 *
 * Reuses the same puppeteer-extra + stealth approach as miruro-cf-solver.ts,
 * pointed at animepahe.pw with its own cookie cache / cooldown state.
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const PAHE_ORIGIN = "https://animepahe.pw";

const COOKIES_CACHE_FILE = "/tmp/pahe-cf-session.json";
const SESSION_TTL_MS = 25 * 60 * 1000;
const CHALLENGE_TIMEOUT_MS = 40_000;
const COOLDOWN_MS = 10 * 60 * 1000;

const CHROMIUM_PATH =
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser";

export interface CfSession {
  cookieHeader: string;
  userAgent: string;
  expiresAt: number;
}

let currentSession: CfSession | null = null;
let cooldownUntil = 0;
let solvePromise: Promise<CfSession | null> | null = null;

const HARD_BLOCK_PHRASES = [
  "Sorry, you have been blocked",
  "This website is using a security service",
  "You have been blocked",
  "Access denied",
];

import fs from "node:fs";

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

async function launchSolve(): Promise<CfSession | null> {
  console.info("[pahe-cf] Launching Puppeteer + stealth for animepahe.pw…");

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1280,800",
    "--lang=en-US,en;q=0.9",
    "--accept-lang=en-US,en;q=0.9",
  ];

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;

  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args,
    });
  } catch (err) {
    console.error("[pahe-cf] Failed to launch Puppeteer:", err);
    return null;
  }

  try {
    const page = await browser.newPage();

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

    const UA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 800 });

    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      "sec-ch-ua":
        '"Chromium";v="138", "Google Chrome";v="138", "Not=A?Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    });

    await page.goto(`${PAHE_ORIGIN}/`, {
      waitUntil: "domcontentloaded",
      timeout: CHALLENGE_TIMEOUT_MS,
    });

    const bodyText: string = await page
      .evaluate("document.body ? document.body.innerText : ''")
      .then((v: unknown) => String(v ?? ""))
      .catch(() => "");

    const isHardBlocked = HARD_BLOCK_PHRASES.some((phrase) =>
      bodyText.includes(phrase)
    );
    if (isHardBlocked) {
      console.warn(
        `[pahe-cf] CF hard-block detected — cooling down for ${COOLDOWN_MS / 60_000} min`
      );
      cooldownUntil = Date.now() + COOLDOWN_MS;
      return null;
    }

    // Wait for the Turnstile "Just a moment..." challenge to self-resolve
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
        console.warn("[pahe-cf] Challenge wait timed out — extracting cookies anyway");
      });

    // Give Turnstile's async verification callback a moment to finish setting
    // the cf_clearance cookie after the visible challenge text disappears.
    await new Promise((r) => setTimeout(r, 1500));

    const cookies = await page.cookies();
    const userAgent: string = await page
      .evaluate(() => navigator.userAgent)
      .catch(() => UA);

    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const cfCookie = cookies.find((c) => c.name === "cf_clearance");

    if (!cfCookie) {
      console.warn(
        "[pahe-cf] cf_clearance not found — CF challenge did not resolve. Setting cooldown."
      );
      cooldownUntil = Date.now() + COOLDOWN_MS;
      return null;
    }

    console.info("[pahe-cf] CF solved ✓  cf_clearance acquired");
    const session: CfSession = {
      cookieHeader,
      userAgent,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    currentSession = session;
    saveDiskSession(session);
    return session;
  } catch (err) {
    console.error("[pahe-cf] Error during CF solve:", err);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

export async function getCfSession(): Promise<CfSession | null> {
  if (currentSession && Date.now() < currentSession.expiresAt) return currentSession;

  const disk = loadDiskSession();
  if (disk) {
    currentSession = disk;
    console.debug("[pahe-cf] Restored CF session from disk cache");
    return disk;
  }

  if (Date.now() < cooldownUntil) {
    const remainSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
    console.debug(`[pahe-cf] IP cooldown active (${remainSec}s remaining), skipping solve`);
    return null;
  }

  if (solvePromise) return solvePromise;
  solvePromise = launchSolve().finally(() => {
    solvePromise = null;
  });
  return solvePromise;
}

export function invalidateCfSession(): void {
  currentSession = null;
  deleteDiskSession();
  console.info("[pahe-cf] Session invalidated");
}

export function warmCfSession(): void {
  if (currentSession && Date.now() < currentSession.expiresAt) return;
  if (Date.now() < cooldownUntil) return;
  getCfSession().catch(() => {});
}
