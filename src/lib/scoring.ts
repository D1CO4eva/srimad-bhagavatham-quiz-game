/**
 * Server-authoritative, latency-compensated scoring (Stories 4.1-4.3). Pure
 * functions, no I/O — this is the one piece of logic in the whole app that
 * must be provably correct, so it's unit-tested directly against
 * hand-calculated fixed cases before anything wires it into the live flow.
 */

export const BASE_POINTS = 1000;

/** serverReceivedAt and questionBroadcastAt are both epoch ms (Story 4.1). */
export function computeRawReactionTimeMs(serverReceivedAtMs: number, questionBroadcastAtMs: number): number {
  return serverReceivedAtMs - questionBroadcastAtMs;
}

/**
 * Subtracts half the player's estimated one-way network latency from their
 * raw reaction time, then clamps to [0, timeLimit] to guard against a
 * corrupt/negative estimate producing a nonsensical result (Story 4.2).
 */
export function computeTrueReactionTimeMs(
  rawReactionTimeMs: number,
  estimatedLatencyMs: number,
  timeLimitMs: number
): number {
  const compensated = rawReactionTimeMs - estimatedLatencyMs / 2;
  return Math.min(Math.max(compensated, 0), timeLimitMs);
}

export type ScoringMode = "SPEED" | "ACCURACY";

/**
 * Kahoot-style linear decay: a correct answer at t=0 scores full
 * BASE_POINTS, decaying to half of BASE_POINTS at t=timeLimit. An incorrect
 * answer always scores 0 (Story 4.3).
 *
 * `mode: "ACCURACY"` ignores reaction time entirely — flat BASE_POINTS for
 * correct, 0 for incorrect — for hosts who'd rather rank by correctness
 * alone than reward speed.
 */
export function computePoints(
  correct: boolean,
  trueReactionTimeMs: number,
  timeLimitMs: number,
  mode: ScoringMode = "SPEED"
): number {
  if (!correct) return 0;
  if (mode === "ACCURACY") return BASE_POINTS;
  return Math.round(BASE_POINTS * (1 - trueReactionTimeMs / timeLimitMs / 2));
}
