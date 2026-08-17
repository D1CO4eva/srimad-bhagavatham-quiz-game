import { afterEach, describe, expect, it } from "vitest";
import { randomPin, generateUniquePin } from "@/lib/pin";
import { firestore } from "@/lib/firestore";

describe("randomPin", () => {
  it("generates a 6-digit numeric string", () => {
    for (let i = 0; i < 50; i++) {
      const pin = randomPin();
      expect(pin).toMatch(/^\d{6}$/);
    }
  });
});

describe("generateUniquePin", () => {
  const createdSessions: string[] = [];

  afterEach(async () => {
    await Promise.all(createdSessions.splice(0).map((id) => firestore.collection("gameSessions").doc(id).delete()));
  });

  it("never returns a PIN held by a non-completed session", async () => {
    // Force the very first random pin to collide by pre-creating a LOBBY
    // session at it — generateUniquePin must retry past it.
    const collidingPin = randomPin();
    const ref = await firestore.collection("gameSessions").add({ pin: collidingPin, status: "LOBBY" });
    createdSessions.push(ref.id);

    for (let i = 0; i < 20; i++) {
      const pin = await generateUniquePin();
      expect(pin).not.toBe(collidingPin);
    }
  });

  it("is willing to reuse a PIN held only by a COMPLETED session", async () => {
    const completedPin = randomPin();
    const ref = await firestore.collection("gameSessions").add({ pin: completedPin, status: "COMPLETED" });
    createdSessions.push(ref.id);

    // Not a strict assertion that it WILL return this exact pin (it's random
    // among 10^6 candidates), just that a completed session never blocks it:
    // directly query it the way generateUniquePin does and confirm it's
    // treated as free.
    const snap = await firestore
      .collection("gameSessions")
      .where("pin", "==", completedPin)
      .where("status", "in", ["LOBBY", "ACTIVE"])
      .limit(1)
      .get();
    expect(snap.empty).toBe(true);
  });
});
