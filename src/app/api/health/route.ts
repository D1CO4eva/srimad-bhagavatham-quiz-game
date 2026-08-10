import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

/**
 * Uptime-check target (Story 8.2): point an external monitor (UptimeRobot,
 * a platform's own health check, etc.) at this so a mid-game outage is
 * noticed within seconds instead of from a confused host mid-class.
 *
 * Checks Postgres and Redis live, since either going down is the actual
 * "game just broke" scenario. Ably isn't checked live here — a config
 * check is enough, and it avoids putting an external API call on the
 * critical path of every uptime ping.
 */
export async function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (error) {
    healthy = false;
    checks.database = `error: ${error instanceof Error ? error.message : String(error)}`;
  }

  try {
    await redis.ping();
    checks.redis = "ok";
  } catch (error) {
    healthy = false;
    checks.redis = `error: ${error instanceof Error ? error.message : String(error)}`;
  }

  checks.ablyConfigured = process.env.ABLY_API_KEY ? "ok" : "error: ABLY_API_KEY is not set";
  if (!process.env.ABLY_API_KEY) healthy = false;

  return Response.json(
    { ok: healthy, checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 }
  );
}
