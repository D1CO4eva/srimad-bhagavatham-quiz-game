import { endGameSession, SessionNotFoundError } from "@/lib/sessions";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ pin: string }> }
) {
  const { pin } = await params;
  try {
    await endGameSession(pin);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
