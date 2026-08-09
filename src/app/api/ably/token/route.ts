import { getAblyRest, sessionChannelName } from "@/lib/ably";
import { db } from "@/lib/db";
import { NextRequest } from "next/server";

/**
 * Mints an Ably token scoped to a single session's channel. Clients only
 * ever subscribe over Ably — every state change is a server API call that
 * validates, persists, then publishes, so a token never grants publish
 * capability.
 */
export async function GET(request: NextRequest) {
  const pin = request.nextUrl.searchParams.get("pin");
  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!pin || !clientId) {
    return Response.json({ error: "pin and clientId are required." }, { status: 400 });
  }

  const session = await db.gameSession.findFirst({
    where: { pin, status: { not: "COMPLETED" } },
    select: { id: true },
  });
  if (!session) {
    return Response.json({ error: "No active session for that PIN." }, { status: 404 });
  }

  const channel = sessionChannelName(pin);
  const tokenRequest = await getAblyRest().auth.createTokenRequest({
    clientId,
    capability: {
      [channel]: ["subscribe", "presence"],
      [`${channel}:*`]: ["subscribe"],
    },
    ttl: 60 * 60 * 1000,
  });

  return Response.json(tokenRequest);
}
