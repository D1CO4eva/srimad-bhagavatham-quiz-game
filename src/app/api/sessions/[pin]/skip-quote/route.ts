import { skipActiveQuote } from "@/lib/questions";

export async function POST(_request: Request, { params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  await skipActiveQuote(pin);
  return Response.json({ ok: true });
}
