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
npm run dev
```

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
