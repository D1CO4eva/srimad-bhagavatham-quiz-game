import { updateSessionSettings, SessionNotFoundError } from "@/lib/sessions";

export async function POST(request: Request, { params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  const body = await request.json().catch(() => null);

  const settings: { showLeaderboard?: boolean; showTimer?: boolean } = {};
  if (typeof body?.showLeaderboard === "boolean") settings.showLeaderboard = body.showLeaderboard;
  if (typeof body?.showTimer === "boolean") settings.showTimer = body.showTimer;

  if (Object.keys(settings).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const updated = await updateSessionSettings(pin, settings);
    return Response.json(updated);
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
