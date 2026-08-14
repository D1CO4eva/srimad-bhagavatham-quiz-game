import { db } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const responseId = new URL(request.url).searchParams.get("responseId");
  if (!responseId) {
    return Response.json({ error: "responseId is required." }, { status: 400 });
  }

  const response = await db.quizResponse.findFirst({
    where: { id: responseId, quiz: { slug } },
    select: { id: true, score: true, totalQuestions: true, answers: true },
  });
  if (!response) {
    return Response.json({ error: "Response not found." }, { status: 404 });
  }

  return Response.json({
    responseId: response.id,
    score: response.score,
    totalQuestions: response.totalQuestions,
    answers: response.answers,
  });
}
