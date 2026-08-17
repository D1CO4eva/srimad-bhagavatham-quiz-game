import { getAblyRest, sessionChannelName } from "@/lib/ably";
import { firestore } from "@/lib/firestore";
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

  // Any session for this PIN, completed or not: clients (host and players)
  // stay mounted through the podium after the game ends and keep
  // re-authing on Ably's normal token-refresh cycle, so this must keep
  // succeeding rather than 404 the moment the last question locks.
  const sessionSnap = await firestore
    .collection("gameSessions")
    .where("pin", "==", pin)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (sessionSnap.empty) {
    return Response.json({ error: "No session for that PIN." }, { status: 404 });
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
