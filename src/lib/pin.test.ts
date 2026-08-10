import { describe, expect, it } from "vitest";
import { randomPin } from "@/lib/pin";

describe("randomPin", () => {
  it("generates a 6-digit numeric string", () => {
    for (let i = 0; i < 50; i++) {
      const pin = randomPin();
      expect(pin).toMatch(/^\d{6}$/);
    }
  });
});
