// Parses one Server-Sent Events frame ("event: x\ndata: {...}", separated
// from the next frame by a blank line) into its event name and parsed JSON
// data. A frame with no "event:" line (e.g. a ":heartbeat" comment) returns
// null — callers should treat that as liveness only, not a real event.
export function parseSseFrame(frame: string): { event: string; data: unknown } | null {
  let event = "";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  if (!event || dataLines.length === 0) return null;
  return { event, data: JSON.parse(dataLines.join("\n")) };
}

// Splits a growing buffer of raw SSE bytes into complete frames as they
// become available, leaving any trailing partial frame in the buffer for
// the next chunk. Shared by the server-side client (quizGenerator.ts,
// reading from GOD-Auth-Service) and the browser-side client
// (GenerateQuizForm.tsx, reading from this app's own passthrough route).
export function extractSseFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;
  let frameBreak = rest.indexOf("\n\n");
  while (frameBreak !== -1) {
    frames.push(rest.slice(0, frameBreak));
    rest = rest.slice(frameBreak + 2);
    frameBreak = rest.indexOf("\n\n");
  }
  return { frames, rest };
}
