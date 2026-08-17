// End-to-end smoke test for the questions.ts rewrite (Phase 4) against the
// emulator: advance -> submit answers from multiple players -> lock ->
// verify the incrementally-maintained counters match -> repeat for the last
// question -> confirm finalizeSession fires. Manually builds the frozen
// GameSessionQuestion docs here since sessions.ts (createGameSession) isn't
// rewritten yet.
// Redis is intentionally not started for this script — it's out of scope
// for this migration (leaderboard.ts's Redis calls are unchanged), so the
// Redis-touching assertions below are best-effort/skipped if it's down
// rather than a hard dependency for validating the Firestore rewrite.
import "dotenv/config";
import { firestore } from "../../src/lib/firestore";
import { advanceToNextQuestion, lockCurrentQuestion, submitAnswer } from "../../src/lib/questions";
import { redis } from "../../src/lib/redis";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  const redisAvailable = await redis
    .ping()
    .then(() => true)
    .catch(() => false);
  if (!redisAvailable) {
    console.log("Redis not reachable — skipping leaderboard-score assertions (out of scope for this migration).");
  }

  const pin = "555" + Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  const sessionRef = firestore.collection("gameSessions").doc();
  await sessionRef.set({
    pin,
    status: "ACTIVE",
    quizId: "smoke-quiz",
    currentQuestionIndex: -1,
    showLeaderboard: true,
    showTimer: false, // avoid deadline flakiness in a scripted test
    scoringMode: "SPEED",
    leadTimeSecs: 0,
  });

  // "sessionQuestions", not "questions" — avoids colliding with the Quiz's
  // own questions subcollection in collection-group queries (see the naming
  // note in src/lib/sessions.ts's createGameSession).
  const questionsRef = sessionRef.collection("sessionQuestions");
  const q0 = questionsRef.doc();
  const q1 = questionsRef.doc();
  await q0.set({
    order: 0,
    type: "MULTIPLE_CHOICE",
    question: "Q0",
    choices: ["A", "B", "C", "D"],
    correctChoices: ["A"],
    explanation: "",
    timeLimitSecs: 20,
    startedAt: null,
    optionsRevealedAt: null,
    lockedAt: null,
    answeredCount: 0,
    choiceCounts: { "0": 0, "1": 0, "2": 0, "3": 0 },
    correctCount: 0,
    incorrectCount: 0,
    quoteText: null,
    quoteAttribution: null,
  });
  await q1.set({
    order: 1,
    type: "MULTIPLE_CHOICE",
    question: "Q1 (last)",
    choices: ["A", "B", "C", "D"],
    correctChoices: ["B"],
    explanation: "",
    timeLimitSecs: 20,
    startedAt: null,
    optionsRevealedAt: null,
    lockedAt: null,
    answeredCount: 0,
    choiceCounts: { "0": 0, "1": 0, "2": 0, "3": 0 },
    correctCount: 0,
    incorrectCount: 0,
    quoteText: null,
    quoteAttribution: null,
  });

  const playersRef = sessionRef.collection("players");
  const playerIds = ["p1", "p2", "p3", "p4", "p5"];
  await Promise.all(playerIds.map((id) => playersRef.doc(id).set({ nickname: id, estimatedLatencyMs: 0, joinedAt: new Date() })));

  // --- Question 0: advance, everyone answers, one player double-submits (should be rejected) ---
  const startPayload = await advanceToNextQuestion(pin);
  assert(startPayload?.questionId === q0.id, "advanceToNextQuestion should start q0");

  // p1-p3 answer A (correct), p4-p5 answer B (incorrect)
  await Promise.all([
    submitAnswer(pin, "p1", q0.id, [0]),
    submitAnswer(pin, "p2", q0.id, [0]),
    submitAnswer(pin, "p3", q0.id, [0]),
    submitAnswer(pin, "p4", q0.id, [1]),
    submitAnswer(pin, "p5", q0.id, [1]),
  ]);

  let doubleSubmitRejected = false;
  try {
    await submitAnswer(pin, "p1", q0.id, [1]);
  } catch (err) {
    doubleSubmitRejected = err instanceof Error && err.name === "AnswerRejectedError";
  }
  assert(doubleSubmitRejected, "double submission must be rejected");

  await lockCurrentQuestion(pin);

  const q0After = (await q0.get()).data()!;
  assert(q0After.answeredCount === 5, `answeredCount should be 5, got ${q0After.answeredCount}`);
  assert(q0After.correctCount === 3, `correctCount should be 3, got ${q0After.correctCount}`);
  assert(q0After.incorrectCount === 2, `incorrectCount should be 2, got ${q0After.incorrectCount}`);
  assert(q0After.choiceCounts["0"] === 3, `choiceCounts.0 should be 3, got ${q0After.choiceCounts["0"]}`);
  assert(q0After.choiceCounts["1"] === 2, `choiceCounts.1 should be 2, got ${q0After.choiceCounts["1"]}`);
  console.log("Question 0 counters correct after lock:", JSON.stringify(q0After.choiceCounts), { correctCount: q0After.correctCount, incorrectCount: q0After.incorrectCount });

  const redisScore = await redis.zscore(`game:${pin}:leaderboard`, "p1");
  assert(redisScore !== null && Number(redisScore) > 0, "p1 should have positive Redis leaderboard points after a correct answer");
  console.log(`p1's Redis leaderboard score after Q0: ${redisScore}`);

  // --- Question 1 (last): advance, answer, lock -> should trigger finalizeSession ---
  const q1Payload = await advanceToNextQuestion(pin);
  assert(q1Payload?.questionId === q1.id, "advanceToNextQuestion should start q1");
  await Promise.all(playerIds.map((id) => submitAnswer(pin, id, q1.id, [1]))); // everyone answers B (correct)
  await lockCurrentQuestion(pin);

  const sessionAfter = (await sessionRef.get()).data()!;
  assert(sessionAfter.status === "COMPLETED", `session status should be COMPLETED after last question locks, got ${sessionAfter.status}`);

  const resultsSnap = await sessionRef.collection("results").get();
  assert(resultsSnap.size === playerIds.length, `expected ${playerIds.length} SessionResult docs, got ${resultsSnap.size}`);
  const p1Result = resultsSnap.docs.find((d) => d.id === "p1")?.data();
  assert(p1Result?.totalPoints > 0, "p1's finalized totalPoints should be positive");
  console.log("SessionResult docs written:", resultsSnap.docs.map((d) => `${d.id}: rank ${d.data().rank}, points ${d.data().totalPoints}`));

  console.log("GO: questions.ts end-to-end flow (advance/submit/lock/finalize) behaves correctly against the emulator.");

  // cleanup
  await redis.del(`game:${pin}:leaderboard`, `game:${pin}:answer-count-throttle`);
  process.exit(0);
}

main().catch((err) => {
  console.error("NO-GO:", err);
  process.exit(1);
});
