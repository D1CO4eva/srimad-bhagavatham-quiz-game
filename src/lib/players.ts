import { db } from "@/lib/db";
import { publishToSession } from "@/lib/ably";
import { SessionEvent } from "@/lib/events";

export class SessionNotJoinableError extends Error {
  constructor(pin: string) {
    super(`No joinable session for PIN ${pin}.`);
    this.name = "SessionNotJoinableError";
  }
}

// Ably's plan caps concurrent connections at 200 — every joined player holds
// one for the life of the session. Capped a bit below that hard ceiling
// (rather than exactly at it) to leave headroom for the host's own
// connection and any in-flight reconnects.
export const MAX_PLAYERS_PER_SESSION = 190;

export class SessionFullError extends Error {
  constructor(pin: string) {
    super(`Session ${pin} is full (max ${MAX_PLAYERS_PER_SESSION} players).`);
    this.name = "SessionFullError";
  }
}

/** Appends " (2)", " (3)", ... until the nickname is free within the session. */
async function uniqueNickname(gameSessionId: string, requested: string): Promise<string> {
  const existing = await db.player.findMany({
    where: { gameSessionId },
    select: { nickname: true },
  });
  const taken = new Set(existing.map((player) => player.nickname));
  if (!taken.has(requested)) return requested;

  let suffix = 2;
  while (taken.has(`${requested} (${suffix})`)) suffix += 1;
  return `${requested} (${suffix})`;
}

/**
 * Joins a player to a session by PIN: any session that hasn't ended yet is
 * joinable, including one already in progress — a late joiner lands in a
 * waiting state until the next question (QA 9.1's mid-question join case),
 * rather than being rejected outright. Auto-suffixes colliding nicknames and
 * broadcasts player_joined so the host's live roster updates within ~1s
 * (Story 2.1).
 */
export async function joinSession(pin: string, requestedNickname: string) {
  const session = await db.gameSession.findFirst({
    where: { pin, status: { not: "COMPLETED" } },
    select: { id: true, pin: true, status: true },
  });
  if (!session) throw new SessionNotJoinableError(pin);

  const existingCount = await db.player.count({ where: { gameSessionId: session.id } });
  if (existingCount >= MAX_PLAYERS_PER_SESSION) throw new SessionFullError(pin);

  const nickname = await uniqueNickname(session.id, requestedNickname);
  const player = await db.player.create({
    data: { gameSessionId: session.id, nickname },
  });

  const playerCount = await db.player.count({ where: { gameSessionId: session.id } });

  await publishToSession(session.pin, SessionEvent.PlayerJoined, {
    playerId: player.id,
    nickname: player.nickname,
    playerCount,
  });

  return { ...player, sessionStatus: session.status };
}
