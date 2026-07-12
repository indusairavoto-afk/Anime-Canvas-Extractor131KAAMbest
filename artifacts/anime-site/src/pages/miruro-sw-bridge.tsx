/**
 * MiruroSwBridge — service-worker race-condition trampoline
 *
 * Problem: When a user opens a watch page before the /sw-miruro.js Service
 * Worker is active (first install), the parent page sets the iframe src to
 * /miruro-sw/watch/...  Before the SW is controlling the page, the browser
 * sends that navigation straight to the Vite dev server.  Vite serves
 * index.html (React SPA catch-all).  React renders at /miruro-sw/watch/…
 * with no matching route — wouter falls through to <NotFound>, but since
 * React itself may briefly blank out, Chrome sometimes shows its native
 * "The webpage might be temporarily down" error inside the iframe instead of
 * a React component.
 *
 * Fix: Add a dedicated route for /miruro-sw/* that renders a loading screen
 * and waits for the SW to take control, then immediately reloads so the SW
 * can intercept the navigation.  A one-shot sessionStorage flag prevents
 * infinite reload loops if the SW genuinely cannot intercept.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";

const BRIDGE_LOOP_KEY = "miruro_sw_bridge_loop";

export default function MiruroSwBridge() {
  const [location] = useLocation();
  const [status, setStatus] = useState<"waiting" | "reloading" | "failed">("waiting");

  useEffect(() => {
    // Guard against infinite reload loops.
    const loopCount = parseInt(sessionStorage.getItem(BRIDGE_LOOP_KEY) ?? "0", 10);
    if (loopCount >= 2) {
      // SW is not intercepting even after multiple reloads — give up.
      sessionStorage.removeItem(BRIDGE_LOOP_KEY);
      setStatus("failed");
      // Notify parent watch page so it can fall back to the relay/overlay.
      try {
        window.parent.postMessage({ type: "miruro-sw-failed", error: "SW bridge exceeded reload limit" }, "*");
      } catch (_) {}
      return;
    }

    const doReload = () => {
      sessionStorage.setItem(BRIDGE_LOOP_KEY, String(loopCount + 1));
      setStatus("reloading");
      // Use location.reload() so the SW (now active) intercepts the navigation.
      window.location.reload();
    };

    if (!("serviceWorker" in navigator)) {
      setStatus("failed");
      try {
        window.parent.postMessage({ type: "miruro-sw-failed", error: "SW not supported" }, "*");
      } catch (_) {}
      return;
    }

    // If the SW is already controlling this page, a reload will be intercepted.
    if (navigator.serviceWorker.controller) {
      doReload();
      return;
    }

    // Wait for the SW to claim this client (fires after clients.claim() in activate).
    const onControllerChange = () => { doReload(); };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange, { once: true });

    // Also register the SW in case this is the very first load.
    navigator.serviceWorker.register("/sw-miruro.js", { scope: "/miruro-sw/" }).catch(() => {
      setStatus("failed");
      try {
        window.parent.postMessage({ type: "miruro-sw-failed", error: "SW registration failed in bridge" }, "*");
      } catch (_) {}
    });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear the loop counter once the SW successfully intercepts (i.e. this
  // component is no longer rendered because the SW served the real page).
  useEffect(() => {
    return () => { sessionStorage.removeItem(BRIDGE_LOOP_KEY); };
  }, []);

  if (status === "failed") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0a0a0a" }}>
        <p style={{ color: "#ffffff80", fontFamily: "monospace", fontSize: "0.75rem" }}>
          Service Worker unavailable
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0a0a0a" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 32, height: 32, border: "2px solid #7c3aed40", borderTopColor: "#7c3aed",
          borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 0.75rem",
        }} />
        <p style={{ color: "#ffffff60", fontFamily: "monospace", fontSize: "0.7rem", margin: 0 }}>
          {status === "reloading" ? "Activating player…" : "Loading player…"}
        </p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
