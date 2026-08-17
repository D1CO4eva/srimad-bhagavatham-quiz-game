import { firestore } from "@/lib/firestore";

export async function GET() {
  const quizzesSnap = await firestore.collection("quizzes").orderBy("createdAt", "desc").get();
  // One count() aggregate per quiz — infrequent admin-page load, not a hot
  // path, so N+1 aggregate queries here is the right tradeoff (see the
  // migration plan's Phase 5 notes).
  const quizzes = await Promise.all(
    quizzesSnap.docs.map(async (doc) => {
      const data = doc.data();
      const countSnap = await doc.ref.collection("questions").count().get();
      return {
        id: doc.id,
        title: data.title as string,
        description: data.description as string,
        createdAt: data.createdAt?.toDate?.() ?? null,
        questionCount: countSnap.data().count,
      };
    })
  );

  return Response.json({ quizzes });
}
