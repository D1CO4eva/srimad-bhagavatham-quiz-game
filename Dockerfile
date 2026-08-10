# syntax=docker/dockerfile:1
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_ vars are inlined into the bundle at build time, not read at
# container runtime — must come in as a build arg (Cloud Run's
# --set-build-env-vars maps to --build-arg for Dockerfile-based source builds).
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# Prisma Client is generated against the schema at build time; no DB access needed.
RUN npx prisma generate
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
