import { redis } from "@/lib/redis";

/** Cumulative score across the whole session, per Story 5.1's leaderboard reads. */
export function leaderboardKey(pin: string): string {
  return `game:${pin}:leaderboard`;
}

/** Immediately reflects a graded answer's points in the live leaderboard (Story 4.4). */
export async function addPoints(pin: string, playerId: string, points: number): Promise<void> {
  await redis.zincrby(leaderboardKey(pin), points, playerId);
}
