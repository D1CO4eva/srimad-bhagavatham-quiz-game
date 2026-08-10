import { createGameSession, QuizNotFoundError } from "@/lib/sessions";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const quizId = typeof body?.quizId === "string" ? body.quizId : null;
  if (!quizId) {
    return Response.json({ error: "quizId is required." }, { status: 400 });
  }

  try {
    const session = await createGameSession(quizId);
    return Response.json({
      id: session.id,
      pin: session.pin,
      status: session.status,
      questionCount: session.questions.length,
    });
  } catch (error) {
    if (error instanceof QuizNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
