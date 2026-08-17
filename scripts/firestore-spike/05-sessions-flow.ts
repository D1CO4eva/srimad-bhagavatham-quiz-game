// End-to-end smoke test for sessions.ts against the emulator: create a real
// Quiz + Questions, createGameSession (frozen-copy batch), join players via
// the real players.ts joinSession, startGameSession (transaction pattern 1),
// updateSessionSettings, then endGameSession -> finalizeSession.
import "dotenv/config";
import { firestore } from "../../src/lib/firestore";
import { createGameSession, startGameSession, updateSessionSettings, endGameSession } from "../../src/lib/sessions";
import { joinSession } from "../../src/lib/players";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  const quizRef = firestore.collection("quizzes").doc();
  await quizRef.set({
    title: "Sessions Flow Smoke Quiz",
    status: "PUBLISHED",
    mode: "LIVE",
    showLeaderboardDefault: true,
    showTimerDefault: true,
    scoringMode: "SPEED",
    leadTimeSecs: 0,
  });
  const questionsRef = quizRef.collection("questions");
  await Promise.all(
    [0, 1].map((order) =>
      questionsRef.add({
        order,
        type: "MULTIPLE_CHOICE",
        question: `Q${order}`,
        choices: ["A", "B"],
        correctChoices: ["A"],
        explanation: "",
        timeLimitSecs: 20,
        quizCreatedAt: new Date(),
      })
    )
  );

  const created = await createGameSession(quizRef.id);
  assert(created.status === "LOBBY", `expected LOBBY, got ${created.status}`);
  assert(created.questions.length === 2, `expected 2 frozen questions, got ${created.questions.length}`);
  console.log(`createGameSession: pin=${created.pin}, id=${created.id}, questions=${created.questions.length}`);

  // startGameSession should fail with 0 players
  let failedWithNoPlayers = false;
  try {
    await startGameSession(created.pin);
  } catch (err) {
    failedWithNoPlayers = err instanceof Error && err.name === "SessionNotStartableError";
  }
  assert(failedWithNoPlayers, "startGameSession must reject a session with 0 players");

  const player = await joinSession(created.pin, "Alice");
  assert(player.nickname === "Alice", "joinSession should return the requested nickname unmodified");
  console.log(`joinSession: playerId=${player.id}, nickname=${player.nickname}, sessionStatus=${player.sessionStatus}`);

  const startPayload = await startGameSession(created.pin);
  assert(startPayload.questionIndex === 0, "startGameSession should start question 0");
  console.log(`startGameSession: started question ${startPayload.questionId} (index ${startPayload.questionIndex})`);

  const settings = await updateSessionSettings(created.pin, { showLeaderboard: false });
  assert(settings.showLeaderboard === false, "updateSessionSettings should persist showLeaderboard=false");
  console.log(`updateSessionSettings: showLeaderboard=${settings.showLeaderboard}, showTimer=${settings.showTimer}`);

  const podium = await endGameSession(created.pin);
  assert(Array.isArray(podium), "endGameSession should return a podium array");
  console.log(`endGameSession: podium has ${podium!.length} entries`);

  const sessionAfter = (await firestore.collection("gameSessions").doc(created.id).get()).data()!;
  assert(sessionAfter.status === "COMPLETED", `session should be COMPLETED after endGameSession, got ${sessionAfter.status}`);

  const secondEnd = await endGameSession(created.pin);
  assert(secondEnd === null, "ending an already-COMPLETED session should be a no-op returning null");

  console.log("GO: sessions.ts end-to-end flow (create/join/start/settings/end) behaves correctly against the emulator.");
  process.exit(0);
}

main().catch((err) => {
  console.error("NO-GO:", err);
  process.exit(1);
});
