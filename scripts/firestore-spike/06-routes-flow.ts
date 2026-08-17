// End-to-end smoke test for the Phase 5 route rewrites against the
// emulator, calling the real exported handlers with constructed Request
// objects: reorder-delete (spike target 2 in real usage), quiz DELETE
// (recursiveDelete + gameSession/response guard counts), self-paced submit
// (hashed doc-ID uniqueness), and players PATCH (collectionGroup lookup).
import "dotenv/config";
import { firestore } from "../../src/lib/firestore";
import { DELETE as deleteQuestion } from "../../src/app/api/quizzes/[id]/questions/[questionId]/route";
import { DELETE as deleteQuiz } from "../../src/app/api/quizzes/[id]/route";
import { POST as submitResponse } from "../../src/app/api/quiz/[slug]/submit/route";
import { GET as myResponse } from "../../src/app/api/quiz/[slug]/my-response/route";
import { PATCH as patchPlayer } from "../../src/app/api/players/[playerId]/route";
import { joinSession } from "../../src/lib/players";
import { createGameSession } from "../../src/lib/sessions";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// Every real Quiz-creation route (src/app/api/quizzes/generate/route.ts) sets
// every one of these — Firestore has no schema-level defaults the way
// Prisma did, so a doc missing any of them isn't a faithful fixture.
function defaultQuizFields() {
  return {
    showLeaderboardDefault: true,
    showTimerDefault: true,
    scoringMode: "SPEED" as const,
    leadTimeSecs: 5,
  };
}

async function main() {
  // --- Reorder-delete route, real HTTP shape ---
  const quizRef = firestore.collection("quizzes").doc();
  await quizRef.set({ title: "Routes Smoke Quiz", status: "PUBLISHED", mode: "LIVE", ...defaultQuizFields() });
  const questionsRef = quizRef.collection("questions");
  const qDocs = await Promise.all(
    [0, 1, 2, 3].map((order) =>
      questionsRef.add({
        order,
        question: `Q${order}`,
        type: "MULTIPLE_CHOICE",
        choices: ["A", "B"],
        correctChoices: ["A"],
        explanation: "",
        timeLimitSecs: 20,
      })
    )
  );
  await deleteQuestion(new Request("http://x", { method: "DELETE" }), {
    params: Promise.resolve({ id: quizRef.id, questionId: qDocs[1].id }), // delete order=1
  });
  const remaining = await questionsRef.orderBy("order").get();
  const orders = remaining.docs.map((d) => d.data().order);
  assert(JSON.stringify(orders) === JSON.stringify([0, 1, 2]), `expected [0,1,2] after reorder, got [${orders}]`);
  console.log("Reorder-delete route: orders repacked correctly to", orders);

  // --- Quiz DELETE: should reject while a game session exists ---
  const session = await createGameSession(quizRef.id);
  const blockedDeleteRes = await deleteQuiz(new Request("http://x", { method: "DELETE" }), {
    params: Promise.resolve({ id: quizRef.id }),
  });
  assert(blockedDeleteRes.status === 400, `expected 400 while a session exists, got ${blockedDeleteRes.status}`);
  console.log("Quiz DELETE correctly blocked while a game session exists.");

  // Clean up the session doc directly (not part of what we're testing) then confirm recursiveDelete works
  await firestore.recursiveDelete(firestore.collection("gameSessions").doc(session.id));
  const okDeleteRes = await deleteQuiz(new Request("http://x", { method: "DELETE" }), {
    params: Promise.resolve({ id: quizRef.id }),
  });
  assert(okDeleteRes.status === 200, `expected 200 after session removed, got ${okDeleteRes.status}`);
  const questionsAfterDelete = await questionsRef.get();
  assert(questionsAfterDelete.empty, "recursiveDelete should have removed the questions subcollection too");
  console.log("Quiz DELETE: recursiveDelete removed the quiz and its questions subcollection.");

  // --- Self-paced submit: hashed doc-ID uniqueness ---
  const spQuizRef = firestore.collection("quizzes").doc();
  const slug = `smoke-self-paced-${Date.now()}`;
  await spQuizRef.set({
    title: "Self-paced smoke quiz",
    status: "PUBLISHED",
    mode: "SELF_PACED",
    slug,
    responsesOpen: true,
    opensAt: null,
    closesAt: null,
  });
  await spQuizRef.collection("questions").add({
    order: 0,
    question: "2+2?",
    choices: ["3", "4"],
    correctChoices: ["4"],
    explanation: "",
  });

  const submitBody = {
    name: "Test User",
    email: "test@example.com",
    phone: "1234567890",
    countryCode: "+1",
    registrationNumber: "REG-001",
    answers: [],
  };
  const firstSubmit = await submitResponse(
    new Request("http://x", { method: "POST", body: JSON.stringify(submitBody) }),
    { params: Promise.resolve({ slug }) }
  );
  assert(firstSubmit.status === 200, `expected first submit to succeed, got ${firstSubmit.status}`);
  const firstBody = await firstSubmit.json();
  console.log(`Self-paced submit: responseId=${firstBody.responseId}, score=${firstBody.score}`);

  const dupeSubmit = await submitResponse(
    new Request("http://x", { method: "POST", body: JSON.stringify(submitBody) }),
    { params: Promise.resolve({ slug }) }
  );
  assert(dupeSubmit.status === 409, `expected duplicate submit to 409, got ${dupeSubmit.status}`);
  console.log("Self-paced submit: duplicate registrationNumber correctly rejected with 409.");

  const myResponseRes = await myResponse(new Request(`http://x?responseId=${firstBody.responseId}`), {
    params: Promise.resolve({ slug }),
  });
  assert(myResponseRes.status === 200, `expected my-response to succeed, got ${myResponseRes.status}`);
  console.log("Self-paced my-response: fetched successfully by responseId.");

  await firestore.recursiveDelete(spQuizRef);

  // --- Players PATCH: collectionGroup lookup by playerId alone ---
  const liveQuizRef = firestore.collection("quizzes").doc();
  await liveQuizRef.set({ title: "Players PATCH smoke quiz", status: "PUBLISHED", mode: "LIVE", ...defaultQuizFields() });
  await liveQuizRef.collection("questions").add({
    order: 0,
    question: "Q",
    type: "MULTIPLE_CHOICE",
    choices: ["A", "B"],
    correctChoices: ["A"],
    explanation: "",
    timeLimitSecs: 20,
  });
  const liveSession = await createGameSession(liveQuizRef.id);
  const joined = await joinSession(liveSession.pin, "PatchTestPlayer");

  const patchRes = await patchPlayer(
    new Request("http://x", { method: "PATCH", body: JSON.stringify({ estimatedLatencyMs: 42 }) }),
    { params: Promise.resolve({ playerId: joined.id }) }
  );
  assert(patchRes.status === 200, `expected players PATCH to succeed, got ${patchRes.status}`);
  const playerSnap = await firestore
    .collection("gameSessions")
    .doc(liveSession.id)
    .collection("players")
    .doc(joined.id)
    .get();
  assert(playerSnap.data()?.estimatedLatencyMs === 42, "estimatedLatencyMs should be updated to 42");
  console.log("Players PATCH: resolved playerId across sessions via collectionGroup and updated latency.");

  await firestore.recursiveDelete(firestore.collection("gameSessions").doc(liveSession.id));
  await firestore.recursiveDelete(liveQuizRef);

  console.log("GO: all Phase 5 route rewrites behave correctly against the emulator.");
  process.exit(0);
}

main().catch((err) => {
  console.error("NO-GO:", err);
  process.exit(1);
});
