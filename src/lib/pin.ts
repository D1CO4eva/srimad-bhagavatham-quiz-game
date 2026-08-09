import { db } from "@/lib/db";

const PIN_LENGTH = 6;
const MAX_ATTEMPTS = 20;

export function randomPin(): string {
  let pin = "";
  for (let i = 0; i < PIN_LENGTH; i++) {
    pin += Math.floor(Math.random() * 10).toString();
  }
  return pin;
}

/** Generates a PIN not currently held by any non-completed session. */
export async function generateUniquePin(): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const pin = randomPin();
    const existing = await db.gameSession.findFirst({
      where: { pin, status: { not: "COMPLETED" } },
      select: { id: true },
    });
    if (!existing) return pin;
  }
  throw new Error("Could not generate a unique PIN after multiple attempts.");
}
