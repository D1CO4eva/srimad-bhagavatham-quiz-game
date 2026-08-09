import { startGameSession, SessionNotStartableError } from "@/lib/sessions";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ pin: string }> }
) {
  const { pin } = await params;
  try {
    await startGameSession(pin);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof SessionNotStartableError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
