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
 * Fraction of full credit earned for a set of selected choice indices
 * against a question's correct choices: (correctPicks - incorrectPicks) /
 * totalCorrectChoices, clamped to 0. For single-select questions (exactly
 * one correct choice, exactly one pick) this collapses to the original
 * all-or-nothing 1 or 0.
 */
export function computeCorrectFraction(choices: string[], correctChoices: string[], choiceIndices: number[]): number {
  const correctSet = new Set(correctChoices);
  const picked = choiceIndices.map((i) => choices[i]);
  const correctPicks = picked.filter((choice) => correctSet.has(choice)).length;
  const incorrectPicks = picked.length - correctPicks;
  return Math.max(0, (correctPicks - incorrectPicks) / correctChoices.length);
}

/**
 * Kahoot-style linear decay: a fully correct answer (correctFraction=1) at
 * t=0 scores full BASE_POINTS, decaying to half of BASE_POINTS at
 * t=timeLimit. An answer with no credit (correctFraction<=0) always scores
 * 0 (Story 4.3).
 *
 * `correctFraction` is 0..1 — 1/0 for a single-select question's
 * right/wrong answer, or a partial value for multi-select questions graded
 * on (correctPicks - incorrectPicks) / totalCorrectChoices. Points scale
 * linearly with it, on top of whatever the mode/speed curve would award a
 * fully correct answer.
 *
 * `mode: "ACCURACY"` ignores reaction time entirely — flat BASE_POINTS
 * (scaled by correctFraction) — for hosts who'd rather rank by correctness
 * alone than reward speed.
 */
export function computePoints(
  correctFraction: number,
  trueReactionTimeMs: number,
  timeLimitMs: number,
  mode: ScoringMode = "SPEED"
): number {
  if (correctFraction <= 0) return 0;
  const fullCreditPoints =
    mode === "ACCURACY" ? BASE_POINTS : BASE_POINTS * (1 - trueReactionTimeMs / timeLimitMs / 2);
  return Math.round(fullCreditPoints * correctFraction);
}
