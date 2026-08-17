// Spike target 3 (migration plan, Phase 2) — the highest-risk item: does
// submitAnswer's design (create the Answer doc at a per-player path, doc-ID
// = playerId, replacing the P2002-catch pattern; and increment
// answeredCount/choiceCounts on the shared parent GameSessionQuestion doc,
// replacing the groupBy/JS-loop tally) hold up under ~190 concurrent
// players answering the same question at once — the app's own documented
// worst case (everyone taps in the last 1-2s before the deadline).
//
// Adapted from load-test/answer-burst.js's "everyone fires at once"
// concurrency shape, but against the emulator instead of the real HTTP API.
import { db } from "./_client";
import { FieldValue } from "firebase-admin/firestore";

const PLAYER_COUNT = 190; // MAX_PLAYERS_PER_SESSION, src/lib/players.ts:16
const CHOICE_COUNT = 4;

async function submitAnswer(questionRef: FirebaseFirestore.DocumentReference, playerId: string, choiceIndex: number) {
  const answerRef = questionRef.collection("answers").doc(playerId);
  await db.runTransaction(async (tx) => {
    tx.create(answerRef, { choiceIndices: [choiceIndex], correct: choiceIndex === 0, serverReceivedAt: FieldValue.serverTimestamp() });
    tx.update(questionRef, {
      answeredCount: FieldValue.increment(1),
      [`choiceCounts.${choiceIndex}`]: FieldValue.increment(1),
      ...(choiceIndex === 0
        ? { correctCount: FieldValue.increment(1) }
        : { incorrectCount: FieldValue.increment(1) }),
    });
  });
}

async function main() {
  const sessionRef = db.collection("gameSessions").doc();
  const questionRef = sessionRef.collection("questions").doc();
  // choiceCounts is a MAP (string index -> count), not an array — Firestore
  // dotted-path updates address map fields, not array indices; a dotted
  // path against an array field silently converts it to a map and drops
  // the other elements (confirmed empirically, see spike notes).
  await questionRef.set({
    order: 0,
    question: "Concurrency spike question",
    choices: ["A", "B", "C", "D"],
    answeredCount: 0,
    choiceCounts: { "0": 0, "1": 0, "2": 0, "3": 0 },
    correctCount: 0,
    incorrectCount: 0,
  });

  const playerIds = Array.from({ length: PLAYER_COUNT }, (_, i) => `player-${i}`);

  const start = Date.now();
  const results = await Promise.allSettled(
    playerIds.map((playerId, i) => submitAnswer(questionRef, playerId, i % CHOICE_COUNT))
  );
  const totalMs = Date.now() - start;

  const failures = results.filter((r) => r.status === "rejected");
  const successes = results.length - failures.length;

  // Read back the maintained counters (no aggregation at read time — this
  // is exactly the "lockCurrentQuestion just reads one doc" payoff).
  const finalSnap = await questionRef.get();
  const final = finalSnap.data()!;
  const choiceSum = Object.values(final.choiceCounts as Record<string, number>).reduce((a, b) => a + b, 0);

  console.log(`${PLAYER_COUNT} concurrent submitAnswer calls: ${successes} succeeded, ${failures.length} failed, total wall time ${totalMs}ms (${(totalMs / PLAYER_COUNT).toFixed(1)}ms/submit avg).`);
  console.log(`Final answeredCount=${final.answeredCount}, choiceCounts=[${final.choiceCounts}] (sum=${choiceSum}), correctCount=${final.correctCount}, incorrectCount=${final.incorrectCount}`);

  if (failures.length > 0) {
    console.error("Sample failure:", (failures[0] as PromiseRejectedResult).reason);
  }

  const correct =
    failures.length === 0 &&
    final.answeredCount === PLAYER_COUNT &&
    choiceSum === PLAYER_COUNT &&
    final.correctCount + final.incorrectCount === PLAYER_COUNT;

  // Verify per-player doc-ID-as-key uniqueness actually held (no double-counting).
  const answersSnap = await questionRef.collection("answers").get();
  const uniqueDocsOk = answersSnap.size === PLAYER_COUNT;

  console.log(`Answer subcollection doc count: ${answersSnap.size} (expected ${PLAYER_COUNT}): ${uniqueDocsOk ? "OK" : "MISMATCH"}`);
  console.log(
    correct && uniqueDocsOk
      ? `GO: plain runTransaction + FieldValue.increment() handled ${PLAYER_COUNT}-way concurrency correctly with no failures, no sharded counters needed.`
      : "NO-GO: counters or answer docs are inconsistent under this concurrency level — reconsider sharded counters."
  );

  await sessionRef.delete();
  process.exit(correct && uniqueDocsOk ? 0 : 1);
}

main().catch((err) => {
  console.error("NO-GO:", err);
  process.exit(1);
});
