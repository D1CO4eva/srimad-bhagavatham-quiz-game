import { submitAnswer, AnswerRejectedError } from "@/lib/questions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ pin: string }> }
) {
  const { pin } = await params;
  const body = await request.json().catch(() => null);
  const playerId = typeof body?.playerId === "string" ? body.playerId : null;
  const questionId = typeof body?.questionId === "string" ? body.questionId : null;
  const choiceIndices = Array.isArray(body?.choiceIndices)
    ? body.choiceIndices.map((i: unknown) => Number(i))
    : null;

  if (
    !playerId ||
    !questionId ||
    !choiceIndices ||
    choiceIndices.length === 0 ||
    !choiceIndices.every((i: number) => Number.isInteger(i))
  ) {
    return Response.json(
      { error: "playerId, questionId, and a non-empty array of integer choiceIndices are required." },
      { status: 400 }
    );
  }

  try {
    await submitAnswer(pin, playerId, questionId, choiceIndices);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AnswerRejectedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
