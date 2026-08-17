// Spike target 1 (migration plan, Phase 2): does a batch-write "freeze
// a copy of the source questions into the session" work the way
// createGameSession (src/lib/sessions.ts:35-74) needs, and does editing the
// source Quiz afterward leave the frozen copy untouched?
import { db } from "./_client";

async function main() {
  const quizRef = db.collection("quizzes").doc();
  await quizRef.set({ title: "Spike Quiz", status: "PUBLISHED" });

  const questionsRef = quizRef.collection("questions");
  const N = 25; // realistic upper end of a real quiz's question count
  const batch1 = db.batch();
  for (let i = 0; i < N; i++) {
    batch1.set(questionsRef.doc(), {
      order: i,
      type: "MULTIPLE_CHOICE",
      question: `Question ${i}`,
      choices: ["A", "B", "C", "D"],
      correctChoices: ["A"],
      explanation: "",
      timeLimitSecs: 20,
    });
  }
  await batch1.commit();

  // --- createGameSession equivalent: read source questions, batch-write frozen copies ---
  const sourceSnap = await questionsRef.orderBy("order").get();
  if (sourceSnap.size !== N) throw new Error(`Expected ${N} source questions, got ${sourceSnap.size}`);

  const sessionRef = db.collection("gameSessions").doc();
  await sessionRef.set({ pin: "999999", status: "LOBBY", quizId: quizRef.id, currentQuestionIndex: -1 });

  const gsQuestionsRef = sessionRef.collection("questions");
  const batch2 = db.batch();
  const start = Date.now();
  sourceSnap.docs.forEach((doc) => {
    const data = doc.data();
    batch2.set(gsQuestionsRef.doc(), {
      order: data.order,
      type: data.type,
      question: data.question,
      choices: data.choices,
      correctChoices: data.correctChoices,
      explanation: data.explanation,
      timeLimitSecs: data.timeLimitSecs,
      startedAt: null,
      optionsRevealedAt: null,
      lockedAt: null,
      answeredCount: 0,
      choiceCounts: [0, 0, 0, 0],
      correctCount: 0,
      incorrectCount: 0,
    });
  });
  await batch2.commit();
  const batchMs = Date.now() - start;

  const frozenSnap = await gsQuestionsRef.orderBy("order").get();
  if (frozenSnap.size !== N) throw new Error(`Expected ${N} frozen questions, got ${frozenSnap.size}`);

  // --- mutate the source AFTER the copy exists ---
  const firstSourceDoc = sourceSnap.docs[0].ref;
  await firstSourceDoc.update({ question: "MUTATED — should not appear in the frozen copy" });

  const frozenFirst = frozenSnap.docs[0].data();
  const isolated = frozenFirst.question === "Question 0";

  console.log(`Batch write of ${N} docs took ${batchMs}ms`);
  console.log(`Frozen copy isolated from source mutation: ${isolated}`);
  console.log(isolated ? "GO: frozen-copy batch write behaves as designed." : "NO-GO: frozen copy was affected by source mutation.");

  await quizRef.delete();
  await sessionRef.delete();
  process.exit(isolated ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
