import { firestore } from "@/lib/firestore";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const responseId = new URL(request.url).searchParams.get("responseId");
  if (!responseId) {
    return Response.json({ error: "responseId is required." }, { status: 400 });
  }

  const quizSnap = await firestore.collection("quizzes").where("slug", "==", slug).limit(1).get();
  if (quizSnap.empty) {
    return Response.json({ error: "Response not found." }, { status: 404 });
  }

  // responseId is the response doc's own ID (a hash of the respondent's
  // registration number — see submit/route.ts), already scoped under this
  // specific quiz's responses subcollection, so a direct get() is both
  // simpler and more precise than the original's `quiz: { slug }` join
  // filter — there's no cross-quiz ambiguity to guard against here.
  const responseSnap = await quizSnap.docs[0].ref.collection("responses").doc(responseId).get();
  if (!responseSnap.exists) {
    return Response.json({ error: "Response not found." }, { status: 404 });
  }
  const response = responseSnap.data()!;

  return Response.json({
    responseId: responseSnap.id,
    score: response.score,
    totalQuestions: response.totalQuestions,
    answers: response.answers,
  });
}
