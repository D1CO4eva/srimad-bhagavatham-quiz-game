import { useEffect, useState } from "react";

/**
 * Seconds remaining until `startedAtMs + timeLimitSecs`, recomputed fresh on
 * every render and forced to re-render every 250ms. Purely a display sync
 * (Story 3.3) — the server enforces the real deadline independent of this.
 */
export function useCountdown(startedAtMs: number | null, timeLimitSecs: number): number {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (startedAtMs === null) return;
    const interval = setInterval(() => forceTick((tick) => tick + 1), 250);
    return () => clearInterval(interval);
  }, [startedAtMs, timeLimitSecs]);

  return secondsLeft(startedAtMs, timeLimitSecs);
}

function secondsLeft(startedAtMs: number | null, timeLimitSecs: number): number {
  if (startedAtMs === null) return timeLimitSecs;
  const deadline = startedAtMs + timeLimitSecs * 1000;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}
