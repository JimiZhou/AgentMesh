# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

# Copy manifests first for layer-cache friendliness
COPY package.json package-lock.json ./
RUN npm ci

# Copy source + scripts
COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/

RUN npm run build

# ─── Stage 2: production ──────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Only production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Compiled assets from builder
COPY --from=builder /build/dist ./dist

# Create data directory for persistent config/state
RUN mkdir -p /app/data

# Persist config & state outside the container image
VOLUME /app/data

EXPOSE 8787

# AGENTMESH_BOOTSTRAP_PASSWORD must be set on first boot (or pre-seed data/config.json).
# Data files use /app/data to match the mounted volume.
ENV NODE_ENV=production \
    AGENTMESH_HOST=0.0.0.0 \
    AGENTMESH_DATA_FILE=/app/data/state.json \
    AGENTMESH_CONFIG_FILE=/app/data/config.json

CMD ["node", "dist/index.js"]
