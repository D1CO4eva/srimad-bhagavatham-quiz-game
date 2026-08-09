import { lockCurrentQuestion, QuestionFlowError } from "@/lib/questions";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ pin: string }> }
) {
  const { pin } = await params;
  try {
    await lockCurrentQuestion(pin);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof QuestionFlowError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
