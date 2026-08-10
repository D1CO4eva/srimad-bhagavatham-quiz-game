import { getPlayerRank } from "@/lib/leaderboard";
import { NextRequest } from "next/server";

/**
 * A player's own current rank, even outside the leaderboard's top 10
 * (Story 5.2). An HTTP response to the requesting player's own call is as
 * private as "sent privately to that socket" needs to be here — no need for
 * a dedicated per-player Ably channel and the fan-out cost that'd add at
 * scale (relevant for Feature 9's 500-1000 player load test).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  const playerId = request.nextUrl.searchParams.get("playerId");
  if (!playerId) {
    return Response.json({ error: "playerId is required." }, { status: 400 });
  }

  const rank = await getPlayerRank(pin, playerId);
  if (!rank) {
    return Response.json({ rank: null, points: 0 });
  }
  return Response.json(rank);
}
