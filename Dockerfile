# syntax=docker/dockerfile:1
# Image web PWA Kikost Cafe POS (build statis dilayani oleh nginx).

# ---- Builder ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# URL API relatif secara default ("" -> same-origin /api). Reverse proxy meneruskan /api ke backend.
ARG VITE_API_BASE_URL=""
ARG VITE_BUILD_LABEL="kikost-cafe-pos"
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_BUILD_LABEL=$VITE_BUILD_LABEL

RUN npm run build

# ---- Runtime ----
FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache curl
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:80/healthz || exit 1

EXPOSE 80
