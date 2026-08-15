import { revealQuestionAfterQuote, QuestionFlowError } from "@/lib/questions";

export async function POST(_request: Request, { params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  try {
    const question = await revealQuestionAfterQuote(pin);
    return Response.json(question);
  } catch (error) {
    if (error instanceof QuestionFlowError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
