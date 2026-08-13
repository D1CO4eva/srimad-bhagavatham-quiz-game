import { describe, expect, it } from "vitest";
import {
  BASE_POINTS,
  computePoints,
  computeRawReactionTimeMs,
  computeTrueReactionTimeMs,
} from "@/lib/scoring";

describe("computeRawReactionTimeMs", () => {
  it("is the wall-clock gap between broadcast and receipt", () => {
    expect(computeRawReactionTimeMs(1_000_010_000, 1_000_000_000)).toBe(10_000);
  });

  it("can be negative if inputs are malformed (caller/clamp responsibility, not this function's)", () => {
    expect(computeRawReactionTimeMs(1_000_000_000, 1_000_010_000)).toBe(-10_000);
  });
});

describe("computeTrueReactionTimeMs", () => {
  const timeLimitMs = 20_000;

  it("subtracts half the estimated latency", () => {
    // 5000ms raw, 2000ms latency -> 5000 - 1000 = 4000
    expect(computeTrueReactionTimeMs(5_000, 2_000, timeLimitMs)).toBe(4_000);
  });

  it("clamps to 0 when latency compensation would go negative", () => {
    // 500ms raw, 2000ms latency -> 500 - 1000 = -500 -> clamp to 0
    expect(computeTrueReactionTimeMs(500, 2_000, timeLimitMs)).toBe(0);
  });

  it("clamps to timeLimit when reaction time exceeds it even after compensation", () => {
    expect(computeTrueReactionTimeMs(30_000, 0, timeLimitMs)).toBe(timeLimitMs);
  });

  it("passes through unchanged with zero latency and an in-range reaction time", () => {
    expect(computeTrueReactionTimeMs(8_000, 0, timeLimitMs)).toBe(8_000);
  });
});

describe("computePoints", () => {
  const timeLimitMs = 20_000;

  it("scores 0 for an incorrect answer regardless of speed", () => {
    expect(computePoints(false, 0, timeLimitMs)).toBe(0);
    expect(computePoints(false, timeLimitMs, timeLimitMs)).toBe(0);
  });

  it("scores full BASE_POINTS for a correct, instant answer", () => {
    expect(computePoints(true, 0, timeLimitMs)).toBe(BASE_POINTS);
  });

  it("scores half of BASE_POINTS for a correct answer at exactly the deadline", () => {
    // round(1000 * (1 - (20000/20000)/2)) = round(1000 * 0.5) = 500
    expect(computePoints(true, timeLimitMs, timeLimitMs)).toBe(500);
  });

  it("scores 3/4 of BASE_POINTS for a correct answer at the halfway point", () => {
    // round(1000 * (1 - (10000/20000)/2)) = round(1000 * 0.75) = 750
    expect(computePoints(true, timeLimitMs / 2, timeLimitMs)).toBe(750);
  });

  it("matches a hand-calculated non-round-number case", () => {
    // timeLimit=15000, trueReactionTime=6000
    // round(1000 * (1 - (6000/15000)/2)) = round(1000 * (1 - 0.2)) = round(800) = 800
    expect(computePoints(true, 6_000, 15_000)).toBe(800);
  });

  it("defaults to SPEED mode when no mode is passed", () => {
    expect(computePoints(true, timeLimitMs, timeLimitMs)).toBe(500);
  });

  describe("ACCURACY mode", () => {
    it("scores flat BASE_POINTS for a correct answer regardless of speed", () => {
      expect(computePoints(true, 0, timeLimitMs, "ACCURACY")).toBe(BASE_POINTS);
      expect(computePoints(true, timeLimitMs, timeLimitMs, "ACCURACY")).toBe(BASE_POINTS);
    });

    it("scores 0 for an incorrect answer regardless of speed", () => {
      expect(computePoints(false, 0, timeLimitMs, "ACCURACY")).toBe(0);
      expect(computePoints(false, timeLimitMs, timeLimitMs, "ACCURACY")).toBe(0);
    });
  });
});
