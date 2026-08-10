import { redis } from "@/lib/redis";
import { db } from "@/lib/db";
import { publishToSession } from "@/lib/ably";
import { SessionEvent } from "@/lib/events";

const TOP_N = 5;
const PODIUM_SIZE = 3;

/** Cumulative score across the whole session, per Story 5.1's leaderboard reads. */
export function leaderboardKey(pin: string): string {
  return `game:${pin}:leaderboard`;
}

/** Immediately reflects a graded answer's points in the live leaderboard (Story 4.4). */
export async function addPoints(pin: string, playerId: string, points: number): Promise<void> {
  await redis.zincrby(leaderboardKey(pin), points, playerId);
}

type LeaderboardEntry = { playerId: string; points: number; rank: number };

function parseWithScores(flat: string[]): { playerId: string; points: number }[] {
  const entries: { playerId: string; points: number }[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    entries.push({ playerId: flat[i], points: Number(flat[i + 1]) });
  }
  return entries;
}

/** Highest-score-first, via ZREVRANGE (Story 5.1). `n: "all"` for the whole leaderboard. */
async function getTopN(pin: string, n: number | "all"): Promise<LeaderboardEntry[]> {
  const stop = n === "all" ? -1 : n - 1;
  const flat = await redis.zrevrange(leaderboardKey(pin), 0, stop, "WITHSCORES");
  return parseWithScores(flat).map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/** The player's own rank even when outside the top N, via ZREVRANK (Story 5.2). */
export async function getPlayerRank(
  pin: string,
  playerId: string
): Promise<{ rank: number; points: number } | null> {
  const [rank, points] = await Promise.all([
    redis.zrevrank(leaderboardKey(pin), playerId),
    redis.zscore(leaderboardKey(pin), playerId),
  ]);
  if (rank === null || points === null) return null;
  return { rank: rank + 1, points: Number(points) };
}

async function withNicknames(entries: LeaderboardEntry[]) {
  if (!entries.length) return [];
  const players = await db.player.findMany({
    where: { id: { in: entries.map((entry) => entry.playerId) } },
    select: { id: true, nickname: true },
  });
  const nicknameById = new Map(players.map((player) => [player.id, player.nickname]));
  return entries.map((entry) => ({
    ...entry,
    nickname: nicknameById.get(entry.playerId) ?? "Unknown",
  }));
}

/** Broadcasts the top-N leaderboard after a question's grading window closes (Story 5.1). */
export async function publishLeaderboardUpdate(pin: string): Promise<void> {
  const top = await withNicknames(await getTopN(pin, TOP_N));
  await publishToSession(pin, SessionEvent.LeaderboardUpdate, { leaderboard: top });
}

/**
 * Ends the session: snapshots the full Redis leaderboard into SessionResult
 * rows (so standings survive Redis eventually expiring the key), marks the
 * session COMPLETED, and broadcasts the top-3 podium (Story 5.3).
 */
export async function finalizeSession(pin: string): Promise<void> {
  const session = await db.gameSession.findFirst({ where: { pin }, select: { id: true } });
  if (!session) return;

  const full = await withNicknames(await getTopN(pin, "all"));

  await db.$transaction([
    db.gameSession.update({
      where: { id: session.id },
      data: { status: "COMPLETED", endedAt: new Date() },
    }),
    ...full.map((entry) =>
      db.sessionResult.upsert({
        where: { gameSessionId_playerId: { gameSessionId: session.id, playerId: entry.playerId } },
        create: {
          gameSessionId: session.id,
          playerId: entry.playerId,
          nickname: entry.nickname,
          rank: entry.rank,
          totalPoints: entry.points,
        },
        update: { rank: entry.rank, totalPoints: entry.points, nickname: entry.nickname },
      })
    ),
  ]);

  await publishToSession(pin, SessionEvent.Podium, { podium: full.slice(0, PODIUM_SIZE) });
}
