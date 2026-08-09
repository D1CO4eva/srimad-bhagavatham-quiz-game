# Load testing (Story 9.3)

Simulates the plan's explicit worst case: 500-1000 players joining, then all
answering within the last 1-2 seconds of a question. Targets our own HTTP
API (join, answer) — not Ably's realtime transport, which is Ably's own
infrastructure to scale, not ours.

Needs [k6](https://k6.io) on PATH (or point at a portable binary — no admin
install required, just download+unzip the release for your OS).

## Running it

```bash
# 1. Seed a quiz if you haven't already, grab its id
npx tsx prisma/seed.ts

# 2. Create a fresh LOBBY session
node load-test/setup-session.mjs <quizId>
# -> prints PIN=123456

# 3. Join burst — capture stdout, you need the PLAYER lines
k6 run load-test/join-burst.js -e PIN=123456 -e COUNT=500 | tee load-test/join-log.txt

# 4. Extract player ids for the answer stage
node load-test/parse-players.mjs load-test/join-log.txt load-test/players.json

# 5. Start the game and advance to question 1 (no browser needed)
node load-test/advance-session.mjs 123456
# -> prints QUESTION_ID, DEADLINE_MS, and the exact next command

# 6. Answer burst — every VU sleeps until ~1.5s before the deadline, then
#    fires at once
k6 run load-test/answer-burst.js -e PIN=123456 -e QUESTION_ID=<id> -e DEADLINE_MS=<ms>
```

`-e BASE_URL=https://your-deployed-app` targets a real deployment instead of
localhost; that's the only way this actually tests anything about
500-1000-scale performance — localhost with a throwaway dev Postgres/Redis
proves the scripts are correct, not that production will hold up.

## What to watch (per the plan)

- Server CPU/memory during the burst
- p99 time from answer submit to the `answer_count_update` broadcast
  reaching clients
- Redis latency under the `ZINCRBY` burst (Feature 4) and `ZREVRANGE` reads
  (Feature 5, fired once per question when it locks)
- Postgres write latency for the `Answer` insert — this is on the
  synchronous path for every answer (see the deliberate deviation noted in
  the Feature 4 commit); if this is where things degrade under load, that's
  exactly the signal to revisit it

Fix anything that degrades here before the real event, not during it.

## Sanity-checked, not scale-proven

This tooling was run end-to-end against a local dev server — join burst,
parse, advance, answer burst — confirming every script and the grading
pipeline behind it are correct. It was **not** run at 500-1000 scale: that
needs a real deployed environment (Feature 8), which is this session's
decision to stand up, not something to do unprompted.

**A real finding from that sanity check, not just a caveat**: at COUNT=20
against `npx prisma dev`'s local database, 35-55% of joins failed with
Postgres connection-reset errors; at COUNT=5, 100% succeeded. Isolated with
a standalone script hitting the same database directly through a bare `pg`
pool (no app code involved) — it reproduced the same drops at 20 concurrent
queries. That confirms the ceiling is `prisma dev`'s own local instance (a
solo-dev convenience tool, not built for concurrency) rather than a bug in
this app's connection handling. Added explicit pool sizing to
`src/lib/db.ts` anyway (cheap, standard hardening, and it's what a real
deployment should have regardless) — but it did not raise this specific
local ceiling, which is the expected outcome if the bottleneck really is
the dev database and not the pool config.

**Before trusting a real load-testing run**: repeat this against
docker-compose Postgres or a real hosted instance (Neon, Supabase, etc.),
not `prisma dev`. If connection errors show up there too under the actual
target concurrency, that's a real capacity problem to fix before the event
— not a dev-tool artifact to explain away.
