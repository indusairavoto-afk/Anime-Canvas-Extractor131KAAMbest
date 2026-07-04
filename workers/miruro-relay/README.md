# Miruro Relay — Cloudflare Worker

A lightweight Cloudflare Worker that proxies requests to miruro.bz on behalf of the Nexa Anime API server and Python sidecar. Because it runs on Cloudflare's own edge network (ASN 13335), miruro's Cloudflare firewall rule that blocks Replit/DigitalOcean datacenter IPs does not apply.

## Deploy (one-time, ~2 minutes)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up). No credit card required.

```bash
cd workers/miruro-relay

# Install wrangler
npm install

# Log in to Cloudflare (opens browser)
npx wrangler login

# Set a shared secret (recommended — prevents open-proxy abuse)
npx wrangler secret put RELAY_SECRET
# Type any random string, e.g.: openssl rand -hex 32

# Deploy
npx wrangler deploy
```

Wrangler prints the Worker URL at the end, e.g.:
```
https://miruro-relay.<your-subdomain>.workers.dev
```

## Configure Replit secrets

In your Replit project → Secrets, add:

| Secret | Value |
|--------|-------|
| `MIRURO_RELAY_URL` | `https://miruro-relay.<you>.workers.dev` |
| `MIRURO_RELAY_SECRET` | *(same value you gave `wrangler secret put`)* |

Then restart the "Start application" workflow — streams will work immediately.

## How it works

```
Replit API server  ──/relay──►  CF Worker  ──►  miruro.bz
Replit sidecar     ──/pipe───►  CF Worker  ──►  miruro.bz/api/secure/pipe
```

The Worker allow-lists only miruro domains and ultracloud.cc — it cannot be
used to proxy arbitrary URLs.

## Free tier limits

Cloudflare Workers free tier: **100,000 requests/day**. For a personal streaming
site this is more than enough. If you need more, the $5/month paid plan has
10 million requests/day.
