# Load testing (Story 9.3)

Simulates the plan's explicit worst case: 500-1000 players joining, then all
answering within the last 1-2 seconds of a question. Targets our own HTTP
API (join, answer) — not Ably's realtime transport, which is Ably's own
infrastructure to scale, not ours.

`realtime-bot.mjs` is the exception: it's a *real player*, not an HTTP-only
script. Each bot joins, opens a genuine `Ably.Realtime` connection, reports
`estimatedLatencyMs` the same way the browser client does, and answers
in-band off real `question_start`/`question_locked` events — see the header
comment in that file for usage. Use it when you need to exercise the actual
realtime path (connection counts, event fan-out latency), not just the HTTP
endpoints.

Needs [k6](https://k6.io) on PATH (or point at a portable binary — no admin
install required, just download+unzip the release for your OS).

## Running it

```bash
# 1. Seed a quiz if you haven't already, grab its id
npm run seed

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
500-1000-scale performance — localhost with a throwaway dev
Firestore-emulator/Redis proves the scripts are correct, not that production
will hold up.

## What to watch (per the plan)

- Server CPU/memory during the burst
- p99 time from answer submit to the `answer_count_update` broadcast
  reaching clients
- Redis latency under the `ZINCRBY` burst (Feature 4) and `ZREVRANGE` reads
  (Feature 5, fired once per question when it locks)
- Firestore write/transaction latency for `submitAnswer` — this is on the
  synchronous path for every answer; the Phase 2 migration spike
  (`scripts/firestore-spike/03-counter-concurrency.ts`) confirmed plain
  `runTransaction` handles 190 concurrent submits with zero failures against
  the local emulator, but that's not the same as production Firestore under
  a real 500-1000-player burst — if this is where things degrade under load,
  that's exactly the signal to revisit it (see `docs/firestore-migration.md`)

Fix anything that degrades here before the real event, not during it.

## Sanity-checked, not scale-proven

This tooling was run end-to-end against a local dev server — join burst,
parse, advance, answer burst — confirming every script and the grading
pipeline behind it are correct. It was **not** run at 500-1000 scale: that
needs a real deployed environment (Feature 8), which is this session's
decision to stand up, not something to do unprompted.

**Historical finding, from before the Firestore migration** (kept for
context — no longer applicable, since Prisma/`prisma dev` are gone): at
COUNT=20 against `prisma dev`'s local database, 35-55% of joins failed with
Postgres connection-reset errors, confirmed to be that dev tool's own
concurrency ceiling rather than a bug in the app's connection handling. The
Firestore emulator has not shown an equivalent local ceiling in this app's
own testing so far, but hasn't been pushed to the same concurrency either —
worth keeping an eye on the same way if local `emulators:up` runs start
showing errors under a join/answer burst.

**Before trusting a real load-testing run**: repeat this against a real
deployed Firestore project, not the local emulator — the emulator is a
correctness check, not a capacity one. If write/transaction latency degrades
under the actual target concurrency there, that's a real capacity problem to
fix before the event, not a local-tooling artifact to explain away.
