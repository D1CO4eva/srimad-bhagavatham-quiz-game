# Bhagavatam Quiz Live

A Kahoot-style live quiz game for the Bhagavatam self-study program. Host
picks a previously generated quiz, players join from their phones with a PIN,
and everyone answers in real time with server-authoritative,
latency-compensated scoring.

Built feature by feature, on stacked branches, against
`kahoot-dev-plan.md`. See task list / PRs for current status.

## Stack

- **Next.js 16** (App Router, TypeScript) — host/player UI + API routes
- **Prisma 7** + **Postgres** — quizzes, sessions, players, answers, results
- **Redis** — live leaderboard (`ZINCRBY` / `ZREVRANGE`) during a session
- **Ably** — realtime pub/sub per game PIN (`game:{pin}` channel)
- **Vitest** — unit tests, especially the scoring formula

## Local development

Requires Docker (for Postgres + Redis) and an [Ably](https://ably.com) API
key (free tier is fine).

```bash
cp .env.example .env   # already done for local docker-compose defaults
npm install
npm run docker:up      # starts Postgres + Redis
npm run db:migrate
npx tsx prisma/seed.ts # loads one sample quiz so /host has something to pick
npm run dev
```

No Docker? `npx prisma dev` starts a local Postgres without it — point
`DATABASE_URL` at the connection string it prints, then run the same
`db:migrate`/seed/`dev` steps.

Other scripts:

```bash
npm run test           # vitest
npm run lint
npm run build
npm run db:studio      # Prisma Studio DB browser
npm run docker:down
```

## Quiz content

Quiz generation itself (RAG over Bhagavatam course-note markdowns) lives in
the separate `GOD-Auth-Service` repo (`POST /api/quiz/generate`). This app
owns its own `Quiz`/`Question` tables — a generated quiz is imported/saved
here before it can be turned into a live session.

## Deployment

Config is entirely environment-based (see `.env.example`) — dev and prod
never share credentials.

1. **Postgres**: any hosted Postgres works (Neon, Supabase, Vercel Postgres,
   etc.). Run `npx prisma migrate deploy` against it once before first
   traffic — this applies existing migration files, it does not generate
   new ones (that only happens locally, via `prisma migrate dev`).
2. **Redis**: any hosted Redis works (Upstash's free tier is enough for a
   single-class event). Set `REDIS_URL`.
3. **Ably**: a **separate, real** API key from the dev one — set
   `ABLY_API_KEY`.
4. **`NEXT_PUBLIC_APP_URL`**: the real prod domain (used to build the
   join-link shown on the host screen).
5. Deploy the Next.js app itself anywhere that supports it (Vercel is the
   path of least resistance for this stack — git push, no server to manage).
   HTTPS/WSS is automatic on Vercel and most other platforms; Ably's client
   SDK always negotiates a secure connection on its own regardless.

**Monitoring** (Story 8.2): `GET /api/health` checks Postgres and Redis live
and Ably's config presence, returning 503 if anything's down. Point an
external uptime monitor at it (UptimeRobot's free tier is enough) so an
outage mid-class is caught within seconds instead of being discovered from a
confused host. A root error boundary (`src/app/error.tsx`) also logs
uncaught errors with a stack trace instead of the app just going blank.

Not built: an admin view of active sessions (Story 8.3) — explicitly a cut
candidate in the dev plan, cut here too given the time budget.
