import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      // Any test that imports src/lib/firestore.ts talks to the local
      // Firestore emulator (`npm run emulators:up`), never real Firestore.
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    },
  },
});
