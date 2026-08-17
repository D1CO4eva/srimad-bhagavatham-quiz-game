import { firestore } from "../../src/lib/firestore";

async function main() {
  const quizzesSnap = await firestore.collection("quizzes").get();
  console.log(`Firestore quizzes: ${quizzesSnap.size}`);

  let totalQuestions = 0;
  let totalResponses = 0;
  for (const doc of quizzesSnap.docs) {
    const [qSnap, rSnap] = await Promise.all([
      doc.ref.collection("questions").count().get(),
      doc.ref.collection("responses").count().get(),
    ]);
    totalQuestions += qSnap.data().count;
    totalResponses += rSnap.data().count;
    console.log(`- "${doc.data().title}": ${qSnap.data().count} questions, ${rSnap.data().count} responses`);
  }
  console.log(`\nTotals: ${quizzesSnap.size} quizzes, ${totalQuestions} questions, ${totalResponses} responses.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
