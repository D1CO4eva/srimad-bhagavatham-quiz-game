/** Median of `samples` round trips to /api/ping, in ms (Story 2.2). */
export async function measureLatency(samples = 5): Promise<number> {
  const rtts: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await fetch("/api/ping", { cache: "no-store" });
    rtts.push(performance.now() - start);
  }
  rtts.sort((a, b) => a - b);
  const mid = Math.floor(rtts.length / 2);
  return rtts.length % 2 === 0 ? (rtts[mid - 1] + rtts[mid]) / 2 : rtts[mid];
}
