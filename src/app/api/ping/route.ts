/** Trivial round-trip probe for client-side latency measurement (Story 2.2). No DB access. */
export async function GET() {
  return Response.json({ serverTime: Date.now() });
}
