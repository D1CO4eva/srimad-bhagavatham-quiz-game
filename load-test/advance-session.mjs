// Starts the game and advances to question 1, without needing a browser.
// Usage: node load-test/advance-session.mjs <pin> [baseUrl]
const [, , pin, baseUrl = "http://localhost:3000"] = process.argv;

if (!pin) {
  console.error("Usage: node load-test/advance-session.mjs <pin> [baseUrl]");
  process.exit(1);
}

const startResponse = await fetch(`${baseUrl}/api/sessions/${pin}/start`, { method: "POST" });
if (!startResponse.ok) {
  console.error("Failed to start session:", await startResponse.json());
  process.exit(1);
}

const nextResponse = await fetch(`${baseUrl}/api/sessions/${pin}/next`, { method: "POST" });
const question = await nextResponse.json();
if (!nextResponse.ok) {
  console.error("Failed to advance question:", question);
  process.exit(1);
}

console.log(`QUESTION_ID=${question.questionId}`);
console.log(`TIME_LIMIT_SECS=${question.timeLimitSecs}`);
console.log(`STARTED_AT=${question.startedAt}`);
const deadline = question.startedAt + question.timeLimitSecs * 1000;
console.log(`Deadline: ${new Date(deadline).toISOString()} (${question.timeLimitSecs}s from now)`);
console.log(
  `Next: k6 run load-test/answer-burst.js -e BASE_URL=${baseUrl} -e PIN=${pin} ` +
    `-e QUESTION_ID=${question.questionId} -e DEADLINE_MS=${deadline} -e CHOICE_COUNT=${4}`
);
