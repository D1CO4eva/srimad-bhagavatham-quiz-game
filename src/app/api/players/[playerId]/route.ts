import { firestore } from "@/lib/firestore";

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

  // playerId alone doesn't say which session's subcollection the doc lives
  // in, so this resolves it via the redundant playerId field set at join
  // time (src/lib/players.ts) rather than requiring the client to also send
  // gameSessionId.
  const snap = await firestore.collectionGroup("players").where("playerId", "==", playerId).limit(1).get();
  if (snap.empty) {
    return Response.json({ error: "Player not found." }, { status: 404 });
  }

  await snap.docs[0].ref.update({ estimatedLatencyMs: Math.round(estimatedLatencyMs) });

  return Response.json({ ok: true });
}
