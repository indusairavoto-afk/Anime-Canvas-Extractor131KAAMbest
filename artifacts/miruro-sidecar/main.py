"""
Miruro sidecar service.

Talks directly to miruro's `/api/secure/pipe` backend using curl_cffi's
Chrome-110 TLS fingerprint impersonation instead of a headless browser.
The "secure" pipe is not encrypted — payloads are just base64(json) requests
and base64(gzip(json)) responses — so once we have a TLS fingerprint that
Cloudflare accepts, this is a handful of plain HTTP requests.

This process is started alongside the Node API server and is only ever
called from within the container (127.0.0.1) — it is not exposed publicly.
"""

import base64
import gzip
import json
import os

import httpx
from curl_cffi.requests import AsyncSession
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, Response as FastAPIResponse

app = FastAPI(title="Miruro Sidecar")

MIRURO_SIDECAR_ORIGIN = os.environ.get("MIRURO_SIDECAR_ORIGIN", "https://www.miruro.bz")
MIRURO_PIPE_URL = f"{MIRURO_SIDECAR_ORIGIN}/api/secure/pipe"

# ── Cloudflare Worker relay (preferred bypass) ────────────────────────────────
# When MIRURO_RELAY_URL is set (pointing at the deployed CF Worker), pipe
# requests are forwarded through it rather than going direct.  CF Worker IPs
# (ASN 13335) are Cloudflare's own edge — miruro.bz's firewall that blocks
# Replit/DigitalOcean IPs does not apply to them.
MIRURO_RELAY_URL = os.environ.get("MIRURO_RELAY_URL", "").strip().rstrip("/")
MIRURO_RELAY_SECRET = os.environ.get("MIRURO_RELAY_SECRET", "")

# ── Legacy HTTP proxy (fallback) ──────────────────────────────────────────────
# When set, routes curl_cffi requests through a residential/rotating proxy.
MIRURO_PROXY_URL = os.environ.get("MIRURO_PROXY_URL")
PROXIES = {"http": MIRURO_PROXY_URL, "https": MIRURO_PROXY_URL} if MIRURO_PROXY_URL else None

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
    "Referer": f"{MIRURO_SIDECAR_ORIGIN}/",
    "Origin": MIRURO_SIDECAR_ORIGIN,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "sec-ch-ua": '"Chromium";v="110", "Not A(Brand";v="24", "Google Chrome";v="110"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
}


def _encode_pipe_request(payload: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")


def _decode_pipe_response(encoded_str: str) -> dict:
    try:
        padded = encoded_str + "=" * (4 - len(encoded_str) % 4)
        compressed = base64.urlsafe_b64decode(padded)
        return json.loads(gzip.decompress(compressed).decode("utf-8"))
    except Exception as exc:
        raise ValueError(f"Failed to decode pipe response: {exc}")


async def _pipe_request(path: str, query: dict) -> dict:
    payload = {"path": path, "method": "GET", "query": query, "body": None, "version": "0.1.0"}
    encoded_req = _encode_pipe_request(payload)

    if MIRURO_RELAY_URL:
        # Route through Cloudflare Worker — CF edge IPs are not blocked by miruro
        worker_url = f"{MIRURO_RELAY_URL}/pipe"
        req_headers: dict = {}
        if MIRURO_RELAY_SECRET:
            req_headers["x-relay-secret"] = MIRURO_RELAY_SECRET
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(
                worker_url,
                params={"e": encoded_req, "origin": MIRURO_SIDECAR_ORIGIN},
                headers=req_headers,
            )
    else:
        # Direct curl_cffi with TLS impersonation (works when not IP-blocked,
        # or when MIRURO_PROXY_URL points to a residential proxy)
        async with AsyncSession(impersonate="chrome110", proxies=PROXIES, timeout=15) as client:
            res = await client.get(f"{MIRURO_PIPE_URL}?e={encoded_req}", headers=HEADERS)

    if res.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail={"upstreamStatus": res.status_code, "body": res.text[:300]},
        )
    try:
        return _decode_pipe_response(res.text.strip())
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


def _inject_source_slugs(data: dict, anilist_id: int) -> dict:
    providers = data.get("providers", {})
    for provider_name, provider_data in providers.items():
        if not isinstance(provider_data, dict):
            continue
        episodes = provider_data.get("episodes", {})
        if not isinstance(episodes, dict):
            continue
        for category, ep_list in episodes.items():
            if not isinstance(ep_list, list):
                continue
            for ep in ep_list:
                if not isinstance(ep, dict) or "id" not in ep or "number" not in ep:
                    continue
                orig_id = ep["id"]
                prefix = orig_id.split(":")[0] if ":" in orig_id else orig_id
                ep["slug"] = f"{prefix}-{ep['number']}"
    return data


@app.get("/cdn-fetch")
async def cdn_fetch(
    url: str = Query(..., description="CDN URL to fetch"),
    referer: str = Query("https://kwik.cx/", description="Referer header value"),
):
    """
    Fetch a CDN resource using curl_cffi Chrome TLS impersonation.
    Used for owocdn.top / uwucdn.top streams that require kwik.cx Referer
    and block Node.js/undici by TLS fingerprint.
    """
    cdn_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        "Referer": referer,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
    }
    async with AsyncSession(impersonate="chrome110", proxies=PROXIES, timeout=20) as client:
        res = await client.get(url, headers=cdn_headers)

    if res.status_code not in (200, 206):
        raise HTTPException(
            status_code=res.status_code,
            detail=f"CDN returned HTTP {res.status_code}",
        )

    content_type = res.headers.get("content-type", "application/octet-stream")
    return FastAPIResponse(
        content=res.content,
        status_code=res.status_code,
        media_type=content_type,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        },
    )


@app.get("/health")
async def health():
    return {
        "ok": True,
        "relayConfigured": bool(MIRURO_RELAY_URL),
        "proxyConfigured": bool(MIRURO_PROXY_URL),
    }


@app.get("/episodes/{anilist_id}")
async def get_episodes(anilist_id: int):
    data = await _pipe_request("episodes", {"anilistId": anilist_id})
    return JSONResponse(_inject_source_slugs(data, anilist_id))


@app.get("/sources")
async def get_sources(
    episode_id: str = Query(..., alias="episodeId"),
    provider: str = Query(...),
    anilist_id: int = Query(..., alias="anilistId"),
    category: str = Query("sub"),
):
    enc_id = base64.urlsafe_b64encode(episode_id.encode()).decode().rstrip("=")
    data = await _pipe_request(
        "sources",
        {"episodeId": enc_id, "provider": provider, "category": category, "anilistId": anilist_id},
    )
    return JSONResponse(data)


@app.get("/watch/{provider}/{anilist_id}/{category}/{slug}")
async def get_watch(provider: str, anilist_id: int, category: str, slug: str):
    episodes = await _pipe_request("episodes", {"anilistId": anilist_id})
    provider_data = episodes.get("providers", {}).get(provider, {})
    ep_list = provider_data.get("episodes", {}).get(category, [])

    target_id = None
    for ep in ep_list:
        orig_id = ep.get("id", "")
        prefix = orig_id.split(":")[0] if ":" in orig_id else orig_id
        if f"{prefix}-{ep.get('number')}" == slug:
            target_id = orig_id
            break

    if not target_id:
        raise HTTPException(status_code=404, detail=f"Episode slug '{slug}' not found for provider {provider}")

    # target_id is already base64-encoded by miruro's pipe — pass it directly.
    # Do NOT re-encode: double-encoding produces a garbled episodeId that the
    # pipe rejects with a non-200 response (→ sidecar 502).
    data = await _pipe_request(
        "sources",
        {"episodeId": target_id, "provider": provider, "category": category, "anilistId": anilist_id},
    )
    return JSONResponse(data)
