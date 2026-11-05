# syntax=docker/dockerfile:1

# --- Build stage: install deps and build the Astro SSR bundle ---
FROM node:22.14-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runtime stage: production deps + built output only, non-root ---
FROM node:22.14-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=app:app /app/dist ./dist
USER app
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:4321/ || exit 1
CMD ["node", "./dist/server/entry.mjs"]
