/**
 * Miruro CF Session Solver
 *
 * Uses CloakBrowser (stealth Playwright, 58 C++ patches) to solve
 * Cloudflare Turnstile/BIC on miruro.bz, caches the resulting cookies,
 * and provides them for all miruro fetch() calls.
 *
 * Strategy:
 *  1. `miruroFetch()` in miruro.ts tries a plain fetch first — on Render
 *     (where Replit IPs are NOT blocked) this succeeds immediately.
 *  2. On 403, `getCfSession()` is called — launches CloakBrowser to solve CF.
 *  3. If the page shows a CF hard-block ("Sorry, you have been blocked"),
 *     we detect it quickly, set a 10-min cooldown, and return null so the
 *     caller can report 503 to the frontend immediately.
 *  4. If CF is solvable (Render/non-blocked IP), cf_clearance is extracted
 *     and cached for 25 min.
 *
 * NixOS note: CloakBrowser downloads its own patched Chromium that expects
 * FHS library paths. On NixOS (Replit), we prepend all required nix store
 * lib dirs to LD_LIBRARY_PATH before spawning so it can find them.
 */

import { launch } from "cloakbrowser";

const MIRURO_ORIGIN = "https://www.miruro.bz";
/** Cache a valid session for 25 min (cf_clearance is valid ~30 min) */
const SESSION_TTL_MS = 25 * 60 * 1000;
/** How long to wait for CF challenge to pass (hard blocks don't need the full wait) */
const CHALLENGE_TIMEOUT_MS = 30_000;
/** After a hard IP block, back off this long before trying again */
const COOLDOWN_MS = 10 * 60 * 1000;

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

/**
 * All nix store lib dirs containing shared libraries that Chromium needs.
 * Derived from `ldd` of the system chromium + the chromium nix wrapper LD_LIBRARY_PATH.
 * Do NOT add glibc here — the binary's ELF interpreter loads it; two glibcs → SIGABRT.
 */
const NIX_LIB_DIRS = [
  // glib (libglib-2.0, libgobject-2.0, libgio-2.0, libgmodule-2.0)
  "/nix/store/y3nxdc2x8hwivppzgx5hkrhacsh87l21-glib-2.84.3/lib",
  // NSS / NSPR
  "/nix/store/2jsrwgic869zynqljiqa4g7dqzpwm2yd-nss-3.101.2/lib64",
  "/nix/store/gpb87pb8s826aggy1s3f352alp40dkj8-nspr-4.36/lib",
  // ATK / at-spi2 (libatk-1.0, libatk-bridge-2.0, libatspi)
  "/nix/store/qrij2csr7p6jsfa40d7h4ckzqg4wd5w2-at-spi2-core-2.56.2/lib",
  // dbus
  "/nix/store/231d6mmkylzr80pf30dbywa9x9aryjgy-dbus-1.14.10-lib/lib",
  // cups
  "/nix/store/xm2418a7fclainspb35n6h05xfsxb6vn-cups-2.4.11-lib/lib",
  // expat
  "/nix/store/l0d83xf43lsyhzqziy0am1cidhkcxs9q-expat-2.7.1/lib",
  // xcb
  "/nix/store/2y2hhlki6macaj9j1409q1j6i33l6igf-libxcb-1.17.0/lib",
  // xkbcommon
  "/nix/store/sisfq9wihyqqjzmrpik9b4xksifw97ha-libxkbcommon-1.8.1/lib",
  // X11 libs
  "/nix/store/1nsvsrqp5zm96r9p3rrq3yhlyw8jiy91-libX11-1.8.12/lib",
  "/nix/store/4phl6z95v2i4525y0zpmi9v6ac0n4bx7-libXcomposite-0.4.6/lib",
  "/nix/store/h8143a07cf1vw41s49h0zahnq13zim94-libXdamage-1.1.6/lib",
  "/nix/store/0046rn5sgi6l38zl81bg2r02zlzxqqbc-libXext-1.3.6/lib",
  "/nix/store/94grp8dx897wmf0x3azpdbgzj3krz7v5-libXfixes-6.0.1/lib",
  "/nix/store/5fcbi2lycw2hz7rbn3nl5nrhhk2ki8dd-libXrandr-1.5.4/lib",
  "/nix/store/58dzwlbfldrsnwah1q3cfaqrx98jajpp-libXi-1.8.2/lib",
  "/nix/store/v53v67k3s16wmak41qy0q54pd7dkbcvr-libXrender-0.9.12/lib",
  "/nix/store/f8kjcizw0kmpyrn1abm1nfsbc007418g-libXau-1.0.12/lib",
  "/nix/store/ycvsz2k1zqcg48as18fcb171rzfdn5ll-libXdmcp-1.1.5/lib",
  // mesa / gbm / drm (hash verified: fss6, not fms6)
  "/nix/store/wilz94hzz4q3fss6qvv625zvww4a6s4s-mesa-libgbm-25.0.1/lib",
  "/nix/store/xpszkfp1gaf8jfmcsll93xg0pb4c0rk7-libdrm-2.4.124/lib",
  // pango, cairo, harfbuzz, freetype, fontconfig
  "/nix/store/802n2ppbgbsk6211wjkg6dcjmifdcfr6-pango-1.56.3/lib",
  "/nix/store/prjwp9nyczsza4kga6a2bcb3qz1mvxg7-cairo-1.18.2/lib",
  "/nix/store/90qal753blhl7mrwzs2k8b00zby9r9xr-harfbuzz-10.2.0/lib",
  "/nix/store/yw429hvy80x2hg00lsfdfhkkib7gz54g-freetype-2.13.3/lib",
  "/nix/store/nm07kfl411ig0yv61rvginj665b6c0ms-fontconfig-2.16.0-lib/lib",
  // pixman, png, jpeg
  "/nix/store/fy204yn3pzlzay5xzqhpzhjl8hcp73ba-pixman-0.44.2/lib",
  "/nix/store/9izldjdrmcskxyfkd9gz8g7flwgnyysk-libpng-1.6.46/lib",
  "/nix/store/yvdmi1gvqjjil5ihka8qs9wrr92gns9j-libjpeg-turbo-3.0.4/lib",
  // zlib, bzip2, brotli
  "/nix/store/jl19fdc7gdxqz9a1s368r9d15vpirnqy-zlib-1.3.1/lib",
  "/nix/store/zkvl3npcgzc1w623pj0fag0qsczd5rxq-bzip2-1.0.8/lib",
  "/nix/store/zb406965xij4m5f793xvrr16sjaixi00-brotli-1.1.0-lib/lib",
  // gnutls, p11-kit, nettle, libtasn1
  "/nix/store/45bdjvfs5fv0vjxc4nmcb7w66z2x7drs-gnutls-3.8.9/lib",
  "/nix/store/mb646zcb4kmy5a6j13c11bkjmassqycj-p11-kit-0.25.5/lib",
  "/nix/store/1v05lfnjgrf46p958b9y9pyc9h9kw68s-nettle-3.10.1/lib",
  "/nix/store/4vmac7wk79spm60w3k5ikwm7ln63z800-libtasn1-4.20.0/lib",
  // audio
  "/nix/store/a6n62siyx22a3mcazn8lqvs19bfb0jq8-libpulseaudio-17.0/lib",
  "/nix/store/yw5xqn8lqinrifm9ij80nrmf0i6fdcbx-alsa-lib-1.2.13/lib",
  "/nix/store/0py9xncsn0s6vqxhvqblvhs2cqbb30s8-libopus-1.5.2/lib",
  "/nix/store/4r7vacgy5cvfcxj9h899b6iwf36chkix-libvorbis-1.3.7/lib",
  "/nix/store/sj9ac96a8xlk7mfbwnr86sd5mr6wh8ps-flac-1.5.0/lib",
  "/nix/store/r69nqmkbi3z18aidf8l803df73z9zrrn-libogg-1.3.5/lib",
  "/nix/store/isflcljjzxfipwa1yrwlfdi53qk8kz81-libsndfile-1.2.2/lib",
  "/nix/store/0mi5c946zyr7m6hy476g895wgs1y3g2z-libmpg123-1.32.10/lib",
  "/nix/store/l86qg2nj2nv09218wpdnbvggqjxv254v-lame-3.100-lib/lib",
  // system / misc (no glibc — binary's ELF interpreter handles it)
  "/nix/store/5flwv7rri80114p8vlz7l8qf8z5i557h-systemd-minimal-libs-257.6/lib",
  "/nix/store/n4kqvn450iwdyj83q80is8ija3lfi2iw-systemd-minimal-257.6/lib",
  "/nix/store/5gml2l2cj28yvyfyzblzjy1laqpxmyzd-libselinux-3.8.1/lib",
  "/nix/store/q2ps6hq2jr2xwvs60m39fnjrnsx94a3w-libcap-2.75-lib/lib",
  "/nix/store/bcs094l67dlbqf7idxxbljp293zms9mh-util-linux-minimal-2.41-lib/lib",
  "/nix/store/bmi5znnqk4kg2grkrhk6py0irc8phf6l-gcc-14.2.1.20250322-lib/lib",
  "/nix/store/rnn29mhynsa4ncmk0fkcrdr29n0j20l4-libffi-3.4.8/lib64",
  "/nix/store/vvp8hlss3d5q6hn0cifq04jrpnp6bini-pcre2-10.44/lib",
  // gtk (from chromium wrapper LD_LIBRARY_PATH)
  "/nix/store/6x7s7vfydrik42pk4599sm1jcqxmi1qp-gtk+3-3.24.49/lib",
  "/nix/store/hlnqqm17pj6js5c6sd5gb8a9nkhxjcr5-gtk4-4.18.6/lib",
  "/nix/store/2pnsbkhxzwwhzncz5i74714f69yzqqai-libva-2.22.0/lib",
  "/nix/store/ap3284zdwi033wsmc0wcp8ww2gf3bmha-pipewire-1.4.5/lib",
  "/nix/store/60lzwimi95ls10zwqxpb6ngzax1z7s9a-wayland-1.23.1/lib",
  "/nix/store/h2l1ivmfpsm9q573q4ah5wxp33q01lv9-krb5-1.21.3-lib/lib",
  // misc text/font
  "/nix/store/3d1gd74i76bhlxr249lmm9cv5bq30aqd-fribidi-1.0.16/lib",
  "/nix/store/dll7gaqkvw597jim01q7rpbsx2dzhsr0-graphite2-1.3.14/lib",
  "/nix/store/lr67dv6pzm628cb2v3xraxz19d9iw23z-libdatrie-2019-12-20-lib/lib",
  "/nix/store/vgk0g17bxmy0z5f6xk2d0sl36xgqxbn5-libthai-0.1.29/lib",
  "/nix/store/8y5ai2bi4s96nqb3bwphxnrlgwscir3c-libxml2-2.13.8/lib",
  "/nix/store/z8s46c3fm5mdbhi8fgw1md1hn6c3l9ik-libxslt-1.1.43/lib",
  "/nix/store/d8hnbm5hvbg2vza50garppb63y724i94-libunistring-1.3/lib",
  "/nix/store/a9n4wcqd6mvjp9n9g6nw81ir91bpwyp3-libidn2-2.3.8/lib",
  "/nix/store/qy4zsnh13nzvq9xz5n0d57d9v4pw4i7c-gmp-with-cxx-6.3.0/lib",
  "/nix/store/y4zg632jdqi24n56bik8pxyxddn0gb1l-avahi-0.8/lib",
];

/** Prepend nix store lib dirs to LD_LIBRARY_PATH so CloakBrowser's Chromium
 *  binary (compiled for standard Linux) can find its shared libraries on NixOS. */
function injectNixLibPath(): void {
  const existing = process.env.LD_LIBRARY_PATH ?? "";
  const nixPaths = NIX_LIB_DIRS.join(":");
  // Only prepend once — if we've already injected, the paths are already there.
  if (!existing.includes("glib-2.84")) {
    process.env.LD_LIBRARY_PATH = existing ? `${nixPaths}:${existing}` : nixPaths;
  }
}

/** CF hard-block phrases — when these appear, solving is impossible from this IP */
const HARD_BLOCK_PHRASES = [
  "Sorry, you have been blocked",
  "Attention Required",
  "This website is using a security service",
  "You have been blocked",
];

async function launchSolve(): Promise<CfSession | null> {
  console.info("[miruro-cf] Launching CloakBrowser to solve CF challenge…");
  injectNixLibPath();

  let browser;
  try {
    browser = await launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        // --single-process removed — it causes SIGABRT in modern Chromium
      ],
    });
  } catch (err) {
    console.error("[miruro-cf] Failed to launch CloakBrowser:", err);
    return null;
  }

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${MIRURO_ORIGIN}/health`, {
      waitUntil: "domcontentloaded",
      timeout: CHALLENGE_TIMEOUT_MS,
    });

    // Fast-fail: if the page shows a CF hard-block message, this IP is permanently
    // blocked. No challenge to solve — set a cooldown and return null immediately.
    const bodyText: string = await page
      .evaluate(() => document.body?.innerText ?? "")
      .catch(() => "");

    const isHardBlocked = HARD_BLOCK_PHRASES.some((phrase) => bodyText.includes(phrase));
    if (isHardBlocked) {
      console.warn(
        `[miruro-cf] CF hard-block detected — this IP is blocked. ` +
        `Cooling down for ${COOLDOWN_MS / 60_000} min.`
      );
      cooldownUntil = Date.now() + COOLDOWN_MS;
      return null;
    }

    // Wait for the CF challenge to auto-clear (CloakBrowser handles it).
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
        console.warn("[miruro-cf] Challenge wait timed out — extracting cookies anyway");
      });

    const cookies = await context.cookies();
    const userAgent: string = await page.evaluate(() => navigator.userAgent).catch(() => "");
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const cfCookie = cookies.find((c) => c.name === "cf_clearance");
    if (!cfCookie) {
      console.warn("[miruro-cf] cf_clearance not found — CF challenge did not resolve. Setting cooldown.");
      cooldownUntil = Date.now() + COOLDOWN_MS;
      return null;
    }

    console.info("[miruro-cf] CF solved ✓  cf_clearance acquired");
    const session: CfSession = { cookieHeader, userAgent, expiresAt: Date.now() + SESSION_TTL_MS };
    currentSession = session;
    return session;
  } catch (err) {
    console.error("[miruro-cf] Error during CF solve:", err);
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Get a valid CF session, launching CloakBrowser if necessary.
 * Returns null if:
 *  - CF hard-blocked this IP (sets a cooldown to prevent hammering)
 *  - Still in cooldown from a previous hard-block
 *  - Launch failed
 */
export async function getCfSession(): Promise<CfSession | null> {
  if (currentSession && Date.now() < currentSession.expiresAt) return currentSession;

  // Respect cooldown — don't launch a browser if we know the IP is hard-blocked.
  if (Date.now() < cooldownUntil) {
    const remainSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
    console.debug(`[miruro-cf] IP cooldown active (${remainSec}s remaining), skipping solve`);
    return null;
  }

  if (solvePromise) return solvePromise;
  solvePromise = launchSolve().finally(() => { solvePromise = null; });
  return solvePromise;
}

/** Invalidate the cached session (call when a fetch returns 403). */
export function invalidateCfSession(): void {
  currentSession = null;
}

/**
 * Kick off a background solve at startup to pre-warm the session.
 * On Render (non-blocked IP) this completes in ~5-10s and subsequent
 * requests to miruro.bz will already have CF cookies ready.
 */
export function warmCfSession(): void {
  if (currentSession && Date.now() < currentSession.expiresAt) return;
  if (Date.now() < cooldownUntil) return;
  getCfSession().catch(() => {});
}
