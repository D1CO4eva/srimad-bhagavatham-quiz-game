import { submitAnswer, AnswerRejectedError } from "@/lib/questions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ pin: string }> }
) {
  const { pin } = await params;
  const body = await request.json().catch(() => null);
  const playerId = typeof body?.playerId === "string" ? body.playerId : null;
  const questionId = typeof body?.questionId === "string" ? body.questionId : null;
  const choiceIndex = Number(body?.choiceIndex);

  if (!playerId || !questionId || !Number.isInteger(choiceIndex)) {
    return Response.json(
      { error: "playerId, questionId, and an integer choiceIndex are required." },
      { status: 400 }
    );
  }

  try {
    await submitAnswer(pin, playerId, questionId, choiceIndex);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AnswerRejectedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
