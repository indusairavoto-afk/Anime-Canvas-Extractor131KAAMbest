/**
 * Detect the Chromium / Chrome executable path at runtime.
 *
 * Priority order:
 *  1. PUPPETEER_EXECUTABLE_PATH env var (explicit override, always wins)
 *  2. puppeteer's own downloaded Chrome (lives in PUPPETEER_CACHE_DIR inside
 *     the project — works on Render because the project directory persists
 *     from the build container to the runtime container)
 *  3. `which` search for known binary names (system-installed Chromium)
 *  4. Hard-coded Nix store path (Replit NixOS fallback)
 */

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import { executablePath as puppeteerExecutablePath } from "puppeteer";

const NIX_PATH =
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser";

function detectChromium(): string {
  // 1. Explicit env override
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    const p = process.env.PUPPETEER_EXECUTABLE_PATH;
    console.info(`[chromium-path] using PUPPETEER_EXECUTABLE_PATH: ${p}`);
    return p;
  }

  // 2. puppeteer's downloaded Chrome (reliable cross-platform after pnpm install)
  try {
    const downloaded = puppeteerExecutablePath();
    if (downloaded && fs.existsSync(downloaded)) {
      console.info(`[chromium-path] using puppeteer download: ${downloaded}`);
      return downloaded;
    }
  } catch {
    // puppeteer download not available or cache dir not found
  }

  // 3. Auto-detect via `which`
  for (const name of ["chromium-browser", "chromium", "google-chrome-stable", "google-chrome"]) {
    try {
      const found = execFileSync("which", [name], { encoding: "utf8" }).trim();
      if (found) {
        console.info(`[chromium-path] detected via which: ${found}`);
        return found;
      }
    } catch {
      // not found, try next
    }
  }

  // 4. Nix store fallback (Replit NixOS)
  console.info(`[chromium-path] falling back to Nix store path`);
  return NIX_PATH;
}

/** Resolved once at module load — synchronous, fast. */
export const CHROMIUM_PATH = detectChromium();
