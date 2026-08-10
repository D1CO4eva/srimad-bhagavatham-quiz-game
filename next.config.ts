import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lean, self-contained server output for the Cloud Run container image —
  // bundles only the traced dependencies instead of shipping node_modules.
  output: "standalone",
};

export default nextConfig;
