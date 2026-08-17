// Spike target 2 (migration plan, Phase 2): reimplement the
// delete-then-repack-order transaction from
// src/app/api/quizzes/[id]/questions/[questionId]/route.ts:134-146 as a
// Firestore runTransaction, with all reads before any writes (Firestore's
// hard requirement, unlike Prisma's interactive $transaction which
// interleaves reads/writes freely). Then prove optimistic-retry produces a
// correct final contiguous order under two concurrent overlapping deletes.
import { db } from "./_client";

async function deleteAndRepack(quizId: string, questionIdToDelete: string) {
  const questionsRef = db.collection("quizzes").doc(quizId).collection("questions");
  await db.runTransaction(async (tx) => {
    // All reads before any writes — Firestore requirement.
    const snap = await tx.get(questionsRef.orderBy("order"));
    const target = snap.docs.find((d) => d.id === questionIdToDelete);
    if (!target) return; // already deleted by a concurrent transaction
    const deletedOrder = target.data().order as number;

    tx.delete(target.ref);
    for (const doc of snap.docs) {
      if (doc.id === questionIdToDelete) continue;
      const order = doc.data().order as number;
      if (order > deletedOrder) {
        tx.update(doc.ref, { order: order - 1 });
      }
    }
  });
}

async function setUpQuiz(n: number) {
  const quizRef = db.collection("quizzes").doc();
  const questionsRef = quizRef.collection("questions");
  const batch = db.batch();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const ref = questionsRef.doc();
    ids.push(ref.id);
    batch.set(ref, { order: i, question: `Q${i}` });
  }
  await batch.commit();
  return { quizId: quizRef.id, questionsRef, ids };
}

async function assertContiguous(questionsRef: FirebaseFirestore.CollectionReference, expectedCount: number) {
  const snap = await questionsRef.orderBy("order").get();
  if (snap.size !== expectedCount) {
    throw new Error(`Expected ${expectedCount} remaining questions, got ${snap.size}`);
  }
  const orders = snap.docs.map((d) => d.data().order as number);
  const expected = Array.from({ length: expectedCount }, (_, i) => i);
  const ok = JSON.stringify(orders) === JSON.stringify(expected);
  if (!ok) throw new Error(`Orders not contiguous: got [${orders.join(",")}], expected [${expected.join(",")}]`);
}

async function main() {
  // --- Test A: single delete, sequential ---
  {
    const { quizId, questionsRef, ids } = await setUpQuiz(10);
    await deleteAndRepack(quizId, ids[3]); // delete order=3
    await assertContiguous(questionsRef, 9);
    console.log("Test A (single delete) passed: orders repacked to 0..8 contiguous.");
  }

  // --- Test B: two concurrent overlapping deletes on the same quiz ---
  {
    const { quizId, questionsRef, ids } = await setUpQuiz(10);
    const start = Date.now();
    // Fire both concurrently — both will read the same original snapshot;
    // Firestore's optimistic concurrency must retry whichever commits
    // second so it re-reads the already-shifted state.
    await Promise.all([
      deleteAndRepack(quizId, ids[2]), // delete order=2
      deleteAndRepack(quizId, ids[5]), // delete order=5
    ]);
    const ms = Date.now() - start;
    await assertContiguous(questionsRef, 8);
    console.log(`Test B (concurrent overlapping deletes) passed in ${ms}ms: orders repacked to 0..7 contiguous, no gaps/dupes.`);
  }

  console.log("GO: reorder-via-transaction handles both sequential and concurrent overlapping deletes correctly.");
  process.exit(0);
}

main().catch((err) => {
  console.error("NO-GO:", err);
  process.exit(1);
});
