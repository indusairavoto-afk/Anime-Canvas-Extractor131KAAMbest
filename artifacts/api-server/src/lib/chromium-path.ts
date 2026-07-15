/**
 * Detect the Chromium / Chrome executable path at runtime.
 *
 * Priority order:
 *  1. PUPPETEER_EXECUTABLE_PATH env var (explicit override, always wins)
 *  2. `which` search for known binary names (works on any Linux distro)
 *  3. Hard-coded Nix store path (Replit NixOS fallback)
 */

import { execFileSync } from "node:child_process";

const NIX_PATH =
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser";

function detectChromium(): string {
  // 1. Explicit env override
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // 2. Auto-detect via `which`
  const candidates = [
    "chromium-browser",   // Debian/Ubuntu
    "chromium",           // Alpine, Arch, some Ubuntu
    "google-chrome-stable",
    "google-chrome",
  ];
  for (const name of candidates) {
    try {
      const found = execFileSync("which", [name], { encoding: "utf8" }).trim();
      if (found) {
        console.info(`[chromium-path] detected: ${found}`);
        return found;
      }
    } catch {
      // not found, try next
    }
  }

  // 3. Nix store fallback (Replit)
  console.info(`[chromium-path] falling back to Nix store path`);
  return NIX_PATH;
}

/** Resolved once at module load — synchronous, fast. */
export const CHROMIUM_PATH = detectChromium();
