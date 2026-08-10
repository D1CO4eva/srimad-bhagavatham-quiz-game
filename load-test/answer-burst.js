// Worst-case burst (Story 9.3): every player answers within the last ~1.5s
// of the question's deadline. Requires players.json from parse-players.mjs
// and QUESTION_ID/DEADLINE_MS from advance-session.mjs.
// Usage: k6 run load-test/answer-burst.js -e BASE_URL=... -e PIN=123456 \
//   -e QUESTION_ID=... -e DEADLINE_MS=... -e CHOICE_COUNT=4
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const PIN = __ENV.PIN;
const QUESTION_ID = __ENV.QUESTION_ID;
const DEADLINE_MS = Number(__ENV.DEADLINE_MS);
const CHOICE_COUNT = Number(__ENV.CHOICE_COUNT || 4);
const FIRE_BEFORE_DEADLINE_MS = Number(__ENV.FIRE_BEFORE_DEADLINE_MS || 1500);

if (!PIN || !QUESTION_ID || !DEADLINE_MS) {
  throw new Error("Set -e PIN=... -e QUESTION_ID=... -e DEADLINE_MS=... (from advance-session.mjs).");
}

const players = JSON.parse(open("./players.json"));

export const options = {
  scenarios: {
    answerBurst: {
      executor: "per-vu-iterations",
      vus: players.length,
      iterations: 1,
      maxDuration: "3m",
    },
  },
};

export default function answerBurst() {
  const player = players[(__VU - 1) % players.length];
  const targetMs = DEADLINE_MS - FIRE_BEFORE_DEADLINE_MS;
  const waitSecs = Math.max(0, (targetMs - Date.now()) / 1000);
  sleep(waitSecs);

  const choiceIndex = Math.floor(Math.random() * CHOICE_COUNT);
  const response = http.post(
    `${BASE_URL}/api/sessions/${PIN}/answers`,
    JSON.stringify({ playerId: player.playerId, questionId: QUESTION_ID, choiceIndex }),
    { headers: { "Content-Type": "application/json" } }
  );

  check(response, { "answer accepted": (res) => res.status === 200 });
}
