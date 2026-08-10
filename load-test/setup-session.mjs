// Creates a fresh LOBBY session from an existing quiz, ready for a join
// burst. Usage: node load-test/setup-session.mjs <quizId> [baseUrl]
const [, , quizId, baseUrl = "http://localhost:3000"] = process.argv;

if (!quizId) {
  console.error("Usage: node load-test/setup-session.mjs <quizId> [baseUrl]");
  console.error("Find a quizId with: curl " + baseUrl + "/api/quizzes");
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ quizId }),
});
const data = await response.json();
if (!response.ok) {
  console.error("Failed to create session:", data);
  process.exit(1);
}

console.log(`PIN=${data.pin}`);
console.log(`Session ${data.id} created with ${data.questionCount} questions, status LOBBY.`);
console.log(`Next: k6 run load-test/join-burst.js -e BASE_URL=${baseUrl} -e PIN=${data.pin} -e COUNT=500`);
