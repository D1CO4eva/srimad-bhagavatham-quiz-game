import { describe, expect, it } from "vitest";
import {
  assignQuotePositions,
  buildQuoteAssignment,
  pickQuoteCount,
  pickRandomQuotes,
  quoteDisplayDurationMs,
} from "@/lib/swamijiQuotes";

describe("pickQuoteCount", () => {
  it("returns the product's stated minimum at the shortest supported game length", () => {
    expect(pickQuoteCount(8)).toBe(3);
  });

  it("returns the product's stated maximum at the longest supported game length", () => {
    expect(pickQuoteCount(30)).toBe(7);
  });

  it("interpolates between min and max for a mid-length game", () => {
    const count = pickQuoteCount(19);
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(7);
  });

  it("clamps below the min game length up to the minimum quote count", () => {
    expect(pickQuoteCount(5)).toBe(3);
  });

  it("clamps above the max game length down to the maximum quote count", () => {
    expect(pickQuoteCount(50)).toBe(7);
  });

  it("never exceeds the number of gaps between questions", () => {
    expect(pickQuoteCount(2)).toBe(1);
    expect(pickQuoteCount(1)).toBe(0);
    expect(pickQuoteCount(0)).toBe(0);
  });
});

describe("assignQuotePositions", () => {
  it("never assigns a quote before question 0", () => {
    const positions = assignQuotePositions(10, 5);
    expect(positions.every((p) => p >= 1)).toBe(true);
  });

  it("never assigns a position past the last question", () => {
    const positions = assignQuotePositions(10, 5);
    expect(positions.every((p) => p <= 9)).toBe(true);
  });

  it("returns quoteCount positions", () => {
    expect(assignQuotePositions(20, 6)).toHaveLength(6);
  });

  it("spreads positions across the game rather than clustering", () => {
    // Divided into 4 equal segments of a 21-question game (indices 1..20),
    // each position should land in its own ~5-wide segment.
    const positions = assignQuotePositions(21, 4).sort((a, b) => a - b);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("returns nothing when quoteCount is 0", () => {
    expect(assignQuotePositions(10, 0)).toEqual([]);
  });
});

describe("pickRandomQuotes", () => {
  it("returns the requested count with no duplicates", () => {
    const quotes = pickRandomQuotes(7);
    expect(quotes).toHaveLength(7);
    expect(new Set(quotes.map((q) => q.id)).size).toBe(7);
  });

  it("returns quotes with non-empty text and attribution", () => {
    const [quote] = pickRandomQuotes(1);
    expect(quote.quote.length).toBeGreaterThan(0);
    expect(quote.attribution.length).toBeGreaterThan(0);
  });
});

describe("quoteDisplayDurationMs", () => {
  it("floors at 3 seconds for an empty quote", () => {
    expect(quoteDisplayDurationMs("")).toBe(3_000);
  });

  it("stays close to the floor for a very short quote", () => {
    expect(quoteDisplayDurationMs("Hi")).toBeGreaterThanOrEqual(3_000);
    expect(quoteDisplayDurationMs("Hi")).toBeLessThan(3_200);
  });

  it("caps at 6 seconds for a very long quote", () => {
    expect(quoteDisplayDurationMs("x".repeat(500))).toBe(6_000);
  });

  it("scales up for a medium-length quote", () => {
    const short = quoteDisplayDurationMs("x".repeat(10));
    const long = quoteDisplayDurationMs("x".repeat(100));
    expect(long).toBeGreaterThan(short);
  });
});

describe("buildQuoteAssignment", () => {
  it("produces exactly pickQuoteCount entries, keyed by valid question positions", () => {
    const questionCount = 15;
    const assignment = buildQuoteAssignment(questionCount);
    expect(assignment.size).toBe(pickQuoteCount(questionCount));
    for (const position of assignment.keys()) {
      expect(position).toBeGreaterThanOrEqual(1);
      expect(position).toBeLessThanOrEqual(questionCount - 1);
    }
  });

  it("never assigns the same quote to two positions", () => {
    const assignment = buildQuoteAssignment(30);
    const ids = [...assignment.values()].map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
