import { describe, expect, it } from "vitest";
import { extractSseFrames, parseSseFrame } from "@/lib/sse";

describe("parseSseFrame", () => {
  it("parses an event frame's name and JSON data", () => {
    const parsed = parseSseFrame('event: progress\ndata: {"phase":"draft","completed":2,"total":8}');
    expect(parsed).toEqual({ event: "progress", data: { phase: "draft", completed: 2, total: 8 } });
  });

  it("returns null for a heartbeat comment with no event line", () => {
    expect(parseSseFrame(":heartbeat")).toBeNull();
  });

  it("joins multiple data: lines before parsing JSON", () => {
    const parsed = parseSseFrame('event: complete\ndata: {"a":1,\ndata: "b":2}');
    expect(parsed).toEqual({ event: "complete", data: { a: 1, b: 2 } });
  });
});

describe("extractSseFrames", () => {
  it("splits multiple complete frames and leaves a trailing partial frame in rest", () => {
    const buffer = 'event: progress\ndata: {"completed":1}\n\nevent: progress\ndata: {"completed":2}\n\nevent: comp';
    const { frames, rest } = extractSseFrames(buffer);
    expect(frames).toEqual([
      'event: progress\ndata: {"completed":1}',
      'event: progress\ndata: {"completed":2}',
    ]);
    expect(rest).toBe("event: comp");
  });

  it("produces a complete frame once a chunk boundary is filled in by a later read", () => {
    const first = extractSseFrames('event: complete\ndata: {"ok":true');
    expect(first.frames).toEqual([]);
    expect(first.rest).toBe('event: complete\ndata: {"ok":true');

    const second = extractSseFrames(first.rest + '}\n\n');
    expect(second.frames).toEqual(['event: complete\ndata: {"ok":true}']);
    expect(second.rest).toBe("");
  });
});
