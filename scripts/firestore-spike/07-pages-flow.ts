// Smoke test for the Phase 6 page rewrites (host/[pin] and play/[pin]) —
// the two hardest reads in the migration plan. Calls the exported Server
// Component functions directly (they're just async functions returning
// React elements) and inspects the props passed to HostLobby/PlayerLobby.
import "dotenv/config";
import { firestore } from "../../src/lib/firestore";
import { createGameSession, startGameSession } from "../../src/lib/sessions";
import { joinSession } from "../../src/lib/players";
import { submitAnswer, lockCurrentQuestion } from "../../src/lib/questions";
import HostLobbyPage from "../../src/app/host/[pin]/page";
import PlayPage from "../../src/app/play/[pin]/page";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

type HostLobbyProps = {
  quizTitle: string;
  initialPlayerCount: number;
  initialAnsweredCount: number;
  initialStarted: boolean;
  initialQuestion: { questionId: string } | null;
  initialPodium: { nickname: string }[] | null;
};

type PlayerLobbyProps = {
  initialGameStarted: boolean;
  initialQuestion: { questionId: string } | null;
  initialMyChoices: number[];
  initialTotalPlayers: number;
};

function propsOf<T>(element: unknown): T {
  return (element as { props: T }).props;
}

async function main() {
  const quizRef = firestore.collection("quizzes").doc();
  await quizRef.set({
    title: "Pages Smoke Quiz",
    status: "PUBLISHED",
    mode: "LIVE",
    showLeaderboardDefault: true,
    showTimerDefault: false,
    scoringMode: "SPEED",
    leadTimeSecs: 0,
  });
  await quizRef.collection("questions").add({
    order: 0,
    type: "MULTIPLE_CHOICE",
    question: "Q0",
    choices: ["A", "B"],
    correctChoices: ["A"],
    explanation: "",
    timeLimitSecs: 20,
    quizCreatedAt: new Date(),
  });

  const created = await createGameSession(quizRef.id);
  const alice = await joinSession(created.pin, "Alice");
  const bob = await joinSession(created.pin, "Bob");
  await startGameSession(created.pin);

  const q0Id = created.questions[0].id;
  await submitAnswer(created.pin, alice.id, q0Id, [0]); // correct

  // --- host page mid-game ---
  const hostProps = propsOf<HostLobbyProps>(
    await HostLobbyPage({ params: Promise.resolve({ pin: created.pin }) })
  );
  assert(hostProps.quizTitle === "Pages Smoke Quiz", `expected quiz title, got ${hostProps.quizTitle}`);
  assert(hostProps.initialPlayerCount === 2, `expected 2 players, got ${hostProps.initialPlayerCount}`);
  assert(hostProps.initialAnsweredCount === 1, `expected answeredCount 1, got ${hostProps.initialAnsweredCount}`);
  assert(hostProps.initialStarted === true, "expected initialStarted true");
  assert(hostProps.initialQuestion?.questionId === q0Id, "expected initialQuestion to be q0");
  console.log("Host page mid-game: title, player count, answered count all correct.");

  // --- play page mid-game, resuming Bob (who hasn't answered yet) ---
  const bobProps = propsOf<PlayerLobbyProps>(
    await PlayPage({
      params: Promise.resolve({ pin: created.pin }),
      searchParams: Promise.resolve({ playerId: bob.id, nickname: "Bob" }),
    })
  );
  assert(bobProps.initialGameStarted === true, "expected Bob's initialGameStarted true");
  assert(bobProps.initialQuestion?.questionId === q0Id, "expected Bob to resume onto q0");
  assert(bobProps.initialMyChoices.length === 0, "Bob hasn't answered yet, expected empty choices");
  console.log("Play page (Bob, hasn't answered): resumes onto live question with no prior answer.");

  // --- play page mid-game, resuming Alice (who already answered) ---
  const aliceProps = propsOf<PlayerLobbyProps>(
    await PlayPage({
      params: Promise.resolve({ pin: created.pin }),
      searchParams: Promise.resolve({ playerId: alice.id, nickname: "Alice" }),
    })
  );
  assert(JSON.stringify(aliceProps.initialMyChoices) === "[0]", `expected Alice's choice [0], got ${JSON.stringify(aliceProps.initialMyChoices)}`);
  console.log("Play page (Alice, already answered): resumes with her prior choice intact.");

  // --- lock + finalize, then re-check both pages show the podium ---
  await lockCurrentQuestion(created.pin); // last question -> finalizes

  const hostAfterProps = propsOf<HostLobbyProps>(
    await HostLobbyPage({ params: Promise.resolve({ pin: created.pin }) })
  );
  assert(hostAfterProps.initialPodium !== null, "expected host podium after finalize");
  assert(hostAfterProps.initialPodium[0].nickname === "Alice", "Alice (the only correct answer) should be rank 1");
  console.log("Host page post-game: podium populated, Alice ranked first.");

  const bobAfterProps = propsOf<PlayerLobbyProps>(
    await PlayPage({
      params: Promise.resolve({ pin: created.pin }),
      searchParams: Promise.resolve({ playerId: bob.id, nickname: "Bob" }),
    })
  );
  // Bob never answered, so he was never in the Redis ZSET (addPoints is
  // only called on a scored answer) — finalizeSession only writes
  // SessionResult docs for players who scored at least once. This is
  // faithful to the pre-migration behavior, not a migration bug: totalPlayers
  // reflects "players with a result," not "players who joined."
  assert(bobAfterProps.initialTotalPlayers === 1, `expected totalPlayers 1 (only Alice scored), got ${bobAfterProps.initialTotalPlayers}`);
  console.log("Play page post-game: totalPlayers correctly reflects only the player who scored.");

  console.log("GO: host/[pin] and play/[pin] pages behave correctly against the emulator.");

  await firestore.recursiveDelete(firestore.collection("gameSessions").doc(created.id));
  await firestore.recursiveDelete(quizRef);
  process.exit(0);
}

main().catch((err) => {
  console.error("NO-GO:", err);
  process.exit(1);
});
