# SinoBee.ai — web (Next.js standalone) and worker images
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN npm run db:generate && npx next build

# ── web ──
FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p /data/storage && chown node /data/storage
USER node
EXPOSE 3000
CMD ["node", "server.js"]

# ── worker + migrations (full source, tsx) ──
FROM deps AS worker
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production
CMD ["npx", "tsx", "worker/index.ts"]
