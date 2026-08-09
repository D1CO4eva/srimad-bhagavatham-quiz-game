import { db } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ playerId: string }> }
) {
  const { playerId } = await params;
  const body = await request.json().catch(() => null);
  const estimatedLatencyMs = Number(body?.estimatedLatencyMs);

  if (!Number.isFinite(estimatedLatencyMs) || estimatedLatencyMs < 0 || estimatedLatencyMs > 30_000) {
    return Response.json({ error: "estimatedLatencyMs must be a number in [0, 30000]." }, { status: 400 });
  }

  await db.player.update({
    where: { id: playerId },
    data: { estimatedLatencyMs: Math.round(estimatedLatencyMs) },
  });

  return Response.json({ ok: true });
}
