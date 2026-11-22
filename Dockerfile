FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=10000 \
    PYTHON_BIN=/opt/venv/bin/python \
    PYTHONPATH=/app \
    WORKSPACE_ROOT=/app \
    FFCS_STORE_PATH=/var/data/ffcs_store.json

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv

COPY api-server/package.json api-server/package-lock.json ./api-server/
RUN npm ci --include=dev --prefix ./api-server
COPY api-server/build.mjs ./api-server/
COPY api-server/src ./api-server/src
RUN npm run build --prefix ./api-server \
    && npm prune --prefix ./api-server --omit=dev

COPY backend/requirements.txt ./backend/requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r ./backend/requirements.txt
COPY backend/ ./backend/

RUN useradd --system --uid 10001 --create-home ffcs \
    && mkdir -p /var/data \
    && chown -R ffcs:ffcs /app /var/data
USER ffcs

EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--enable-source-maps", "/app/api-server/dist/index.mjs"]
