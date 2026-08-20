# syntax=docker/dockerfile:1

# Open Dungeon Master as a single image. Everything the app needs is baked in:
# the Next.js build, the Open5e content pack, and the MiniLM embedding model.
# Only the AI services stay outside (llama.cpp, ComfyUI, Kokoro TTS, STT).
#
# Built on glibc rather than Alpine: better-sqlite3-multiple-ciphers and
# onnxruntime-node both publish glibc prebuilds, and musl would force a slow
# source compile of both.

# --------------------------------------------------------------- dependencies
FROM node:22.23.2-trixie-slim AS deps
WORKDIR /app

# Toolchain for the two native modules, in case no prebuild matches the platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# The postinstall hook runs this; copy it in before the rest of the source so
# the install layer stays cached across ordinary code changes.
COPY scripts/copy-dice-assets.mjs ./scripts/
# A full install, not --ignore-scripts: better-sqlite3-multiple-ciphers and
# onnxruntime-node fetch their native binaries from an install script.
RUN npm ci

# --------------------------------------------------------------------- build
FROM deps AS build
WORKDIR /app

COPY . .

# 3D dice textures and sounds. The postinstall hook already ran in the deps
# stage; rerunning is cheap and keeps this independent of the COPY order.
RUN node scripts/copy-dice-assets.mjs

# Bake the content pack (spells, monsters, items, feats, subclasses) from
# api.open5e.com and the MiniLM embedding model, so a running container never
# needs the internet to answer a rules lookup or a semantic story recall.
RUN node scripts/import-open5e.mjs
RUN npm run fetch-model

ENV NEXT_TELEMETRY_DISABLED=1
RUN DOCKER_BUILD=1 npm run build

# Trim the standalone bundle here, not in the runner stage: deleting a file in a
# later layer does not reclaim the bytes the earlier COPY already wrote.
#
# onnxruntime-node ships every platform plus the CUDA and TensorRT execution
# providers (~400MB), and this app only ever embeds on CPU. File tracing also
# drags in whole directories whenever it sees a path.join(process.cwd(), ...),
# which is how data/, models/ and the repo docs end up here; the runner stage
# re-adds the parts that are actually needed, at paths a volume cannot hide.
RUN cd .next/standalone \
  && rm -rf node_modules/onnxruntime-node/bin/napi-v6/darwin \
            node_modules/onnxruntime-node/bin/napi-v6/win32 \
            node_modules/onnxruntime-node/bin/napi-v6/linux/arm64 \
  && rm -f  node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_cuda.so \
            node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_tensorrt.so \
  && rm -rf data models docs package-lock.json tsconfig.tsbuildinfo \
            README.md CLAUDE.md AGENTS.md eslint.config.mjs postcss.config.mjs

# -------------------------------------------------------------------- runner
FROM node:22.23.2-trixie-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3005 \
    CONTENT_DB_PATH=/app/content/open5e.sqlite

# Every COPY sets ownership inline. A trailing `chown -R /app` would rewrite
# every file into a second 250MB layer instead.
#
# The standalone bundle carries its own trimmed node_modules plus server.js.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# The embedding cache directory is hard-coded to <cwd>/models/embeddings in
# src/lib/embeddings.ts, so it has to live here and must not be a mount point.
COPY --from=build --chown=node:node /app/models/embeddings ./models/embeddings

# The content pack lives outside /app/data so the data volume cannot hide it.
COPY --from=build --chown=node:node /app/data/content/open5e.sqlite ./content/open5e.sqlite

# Source and scripts, so maintenance commands work through `docker compose exec`
# (make-admin.mjs and backfill-embeddings.mjs import TypeScript from src/).
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json

# Runtime state. Creating these before any volume is attached is what seeds a
# fresh named volume with ownership the unprivileged user can write to.
RUN mkdir -p data public/uploads public/generated public/generated-audio logs \
  && chmod +x scripts/docker-entrypoint.sh \
  && chown node:node data public/uploads public/generated public/generated-audio logs

USER node
EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3005)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "server.js"]
