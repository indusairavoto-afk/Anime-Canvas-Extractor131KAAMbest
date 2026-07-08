# Single-container deployment: Node/Express API + built React frontend +
# Python Miruro sidecar (curl_cffi), all running together in one process
# group. Render's native "node" runtime image does not include Python, so a
# Docker runtime is required to run both languages in the same service.

FROM node:20-slim

# Python 3 + pip for the Miruro sidecar.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

ENV CI=true

COPY . .

RUN pnpm install --frozen-lockfile \
    && pnpm --filter @workspace/anime-site run build \
    && pnpm --filter @workspace/api-server run build \
    && pip3 install --break-system-packages --no-cache-dir -r artifacts/miruro-sidecar/requirements.txt

ENV NODE_ENV=production

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 8080

CMD ["/app/start.sh"]
