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

The host generates quizzes from `/host` by picking a class week (or several)
and topic(s). Generation is entirely in-house
(`src/lib/localQuizGenerator.ts`): each question is its own call to an LLM
via [OpenRouter](https://openrouter.ai) (`openai/gpt-4o-mini` by default,
falling back to `google/gemini-2.5-flash` on a repair retry), scoped to the
selected week/topic via this app's own catalog (`src/data/courseCatalog.json`,
regenerated with `python scripts/build_course_catalog.py` from
`course-materials/raw/` — see that script's docstring).

Each question is grounded in the actual course-note text for the selected
week(s) — `src/data/courseNotes.json` (regenerated with
`node scripts/build_course_notes.mjs` from `content/course-notes/`) is
included directly in the generation prompt, and every candidate is scored
against it with [autoevals](https://github.com/braintrustdata/autoevals)'
RAGAS-style `Faithfulness` metric (`src/lib/faithfulness.ts`, LLM-as-judge,
using whichever of the two models *didn't* write the question) before it's
accepted — below a 0.7 score, it's treated like any other validation
failure in the retry ladder (repair retry, then fallback model, then the
slot is dropped rather than kept).

The same generator is also exposed as a standalone backend endpoint,
`POST /generate-quiz` (`src/app/generate-quiz/route.ts`), for other services
to call directly — same request shape
(`{ weekIds, topics?, questionCount, difficulty }`), gated by a shared
bearer token (`GENERATE_QUIZ_API_KEY`), no DB persistence. It streams
`progress`/`complete`/`error` Server-Sent Events if the caller sends
`Accept: text/event-stream`, otherwise it awaits generation and returns
plain JSON.

This app owns its own `Quiz`/`Question` tables — a generated quiz is saved
as a draft, previewed, and Published before it can be turned into a live
session. `/host` and all of `/api/quizzes/*` (which now spends the app's own
OpenRouter budget on generation) sit behind a shared passcode
(`HOST_PASSCODE`).

## Deployment

Config is entirely environment-based (see `.env.example`) — dev and prod
never share credentials.

1. **Postgres**: any hosted Postgres works (Neon, Supabase, Vercel Postgres,
   etc.). Run `npx prisma migrate deploy` against it once before first
   traffic — this applies existing migration files, it does not generate
   new ones (that only happens locally, via `prisma migrate dev`). Prefer a
   pooled/PgBouncer-style connection string if the host offers one — Vercel's
   serverless functions each open their own connection, and Feature 9's
   load-testing notes already flagged connection exhaustion as a real risk
   worth re-checking against the actual prod database.
2. **Redis**: any hosted Redis works (Upstash's free tier is enough for a
   single-class event). Set `REDIS_URL`.
3. **Ably**: a **separate, real** API key from the dev one — set
   `ABLY_API_KEY`.
4. **`NEXT_PUBLIC_APP_URL`**: the real prod domain (used to build the
   join-link shown on the host screen).
5. **`HOST_PASSCODE`**: a real passcode only hosts should know — do not reuse
   any value from a local `.env`.
6. **`SESSION_SECRET`**: signs the host's session cookie. Generate a fresh
   one for prod (`openssl rand -base64 32`) — do not reuse the local dev
   value.
7. **`OPENROUTER_API_KEY`**: an [OpenRouter](https://openrouter.ai/keys) key
   for quiz generation. `OPENROUTER_MODEL_PRIMARY`/`OPENROUTER_MODEL_FALLBACK`
   are optional overrides of the built-in model defaults. **`GENERATE_QUIZ_API_KEY`**:
   a random shared secret (`openssl rand -base64 32`) other services must
   present as a bearer token to call `POST /generate-quiz` — do not reuse
   any other secret for this.
8. Deploy the Next.js app itself anywhere that supports it (Vercel is the
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

## QA (Feature 9 — the long pole)

- `docs/qa-checklist.md` — what's verified vs. what still needs a human
  (real devices, real remote testers, a real deployment)
- `docs/formula-audit.md` — the scoring formula's correctness verification
- `load-test/` — k6 scripts simulating the plan's worst case (500-1000
  players joining, then all answering within the last 1-2 seconds)
