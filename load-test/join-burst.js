// Simulates N players joining a session at once (Story 9.3's join burst).
// Usage: k6 run load-test/join-burst.js -e BASE_URL=... -e PIN=123456 -e COUNT=500
// Capture stdout to a file — answer-burst.js needs the PLAYER lines it logs:
//   k6 run load-test/join-burst.js -e PIN=123456 -e COUNT=500 | tee join-log.txt
import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const PIN = __ENV.PIN;
const COUNT = Number(__ENV.COUNT || 50);

if (!PIN) {
  throw new Error("Set -e PIN=<pin> (from setup-session.mjs).");
}

export const options = {
  scenarios: {
    join: {
      executor: "shared-iterations",
      vus: Math.min(COUNT, 200), // k6 VUs are OS threads-ish; cap concurrency, iterations still equal COUNT
      iterations: COUNT,
      maxDuration: "2m",
    },
  },
};

export default function joinBurst() {
  const nickname = `LoadTest-${__VU}-${__ITER}`;
  const response = http.post(
    `${BASE_URL}/api/players`,
    JSON.stringify({ pin: PIN, nickname }),
    { headers: { "Content-Type": "application/json" } }
  );

  const ok = check(response, { "join succeeded": (res) => res.status === 200 });
  if (ok) {
    const body = JSON.parse(response.body);
    console.log(`PLAYER ${body.playerId} ${body.nickname}`);
  } else {
    console.log(`JOIN_FAILED ${response.status} ${response.body}`);
  }
}
