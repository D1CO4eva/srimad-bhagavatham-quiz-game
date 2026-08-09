import { joinSession, SessionNotJoinableError } from "@/lib/players";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  const nickname = typeof body?.nickname === "string" ? body.nickname.trim() : "";

  if (!/^\d{4,6}$/.test(pin)) {
    return Response.json({ error: "pin must be a 4-6 digit PIN." }, { status: 400 });
  }
  if (!nickname || nickname.length > 30) {
    return Response.json(
      { error: "nickname is required and must be 30 characters or fewer." },
      { status: 400 }
    );
  }

  try {
    const player = await joinSession(pin, nickname);
    return Response.json({ playerId: player.id, nickname: player.nickname, pin });
  } catch (error) {
    if (error instanceof SessionNotJoinableError) {
      return Response.json({ error: "No active game with that PIN." }, { status: 404 });
    }
    throw error;
  }
}
