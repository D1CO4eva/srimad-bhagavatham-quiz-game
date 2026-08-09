import Ably from "ably";

/**
 * Browser-side realtime client for one session channel. Auths against
 * /api/ably/token, which scopes the token to `game:{pin}` and never grants
 * publish capability — all writes go through our own API routes instead.
 */
export function createSessionRealtimeClient(pin: string, clientId: string): Ably.Realtime {
  return new Ably.Realtime({
    authUrl: `/api/ably/token?pin=${encodeURIComponent(pin)}&clientId=${encodeURIComponent(clientId)}`,
    autoConnect: typeof window !== "undefined",
  });
}
