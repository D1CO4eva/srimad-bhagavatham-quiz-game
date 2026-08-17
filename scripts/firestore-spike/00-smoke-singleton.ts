// Smoke test for src/lib/firestore.ts (Phase 3) against the local emulator.
import "dotenv/config";
import { firestore } from "../../src/lib/firestore";

async function main() {
  const ref = firestore.collection("_smoke_test").doc("ping");
  await ref.set({ ok: true, at: new Date().toISOString() });
  const snap = await ref.get();
  console.log("smoke test read back:", JSON.stringify(snap.data()));
  await ref.delete();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
