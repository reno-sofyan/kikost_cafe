# syntax=docker/dockerfile:1

# ---- Builder ----
FROM node:24.22.1-bookworm-slim AS builder
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Pangkas dependency menjadi hanya production.
RUN npm ci --omit=dev

# ---- Runtime ----
FROM node:24.22.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# tini untuk reaping sinyal yang benar; upgrade menarik patch keamanan Debian
# (mis. openssl, libbrotli) yang terbit setelah image dasar dibuat.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
