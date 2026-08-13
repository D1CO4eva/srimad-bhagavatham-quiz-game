import Ably from "ably";

const globalForAbly = globalThis as unknown as {
  ablyRest: Ably.Rest | undefined;
};

function getApiKey(): string {
  const key = process.env.ABLY_API_KEY;
  if (!key) throw new Error("ABLY_API_KEY is not set.");
  return key;
}

/** Server-side REST client used to publish events and mint client tokens. */
export function getAblyRest(): Ably.Rest {
  if (!globalForAbly.ablyRest) {
    globalForAbly.ablyRest = new Ably.Rest({ key: getApiKey() });
  }
  return globalForAbly.ablyRest;
}

/** Every realtime event for a session flows through this single channel, scoped by PIN. */
export function sessionChannelName(pin: string): string {
  return `game:${pin}`;
}

/**
 * Publishes a named event to every client (players + host) subscribed to a
 * session's channel. Never throws: by the time anything calls this, the
 * actual state change (DB write, score update, session finalization) has
 * already succeeded, and a broadcast hiccup — e.g. Ably's per-channel
 * publish-rate limit — must not fail the request or strand the session.
 */
export async function publishToSession(
  pin: string,
  eventName: string,
  data: unknown
): Promise<void> {
  const channel = getAblyRest().channels.get(sessionChannelName(pin));
  try {
    await channel.publish(eventName, data);
  } catch (error) {
    console.error(`Ably publish failed for ${sessionChannelName(pin)}/${eventName}:`, error);
  }
}
