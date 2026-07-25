import type { NextConfig } from "next";

// Extra hostnames/IPs allowed to reach the dev server (e.g. a phone on your
// tailnet). Comma-separated, set in .env.local: ALLOWED_DEV_ORIGINS=ip1,host2
const extraDevOrigins = (process.env.ALLOWED_DEV_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// The Docker image builds with output: "standalone" so the runtime stage needs
// no node_modules. It is gated behind DOCKER_BUILD because "next start" refuses
// to run against a standalone build, and that is how the app is served on a
// plain host (npm run start:lan).
const dockerBuild = process.env.DOCKER_BUILD === "1";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1", ...extraDevOrigins],
  devIndicators: false,
  serverExternalPackages: ["better-sqlite3-multiple-ciphers"],
  turbopack: {
    root: process.cwd(),
  },
  ...(dockerBuild
    ? {
        output: "standalone" as const,
        // File tracing misses both native modules: better-sqlite3 is kept out
        // of the bundle by serverExternalPackages, and onnxruntime-node (the
        // embedding runtime) resolves its .node binding by a computed path.
        // Only the linux/x64 binding is shipped; embeddings are CPU-only.
        outputFileTracingIncludes: {
          "/*": [
            "node_modules/better-sqlite3-multiple-ciphers/**/*",
            "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**/*",
          ],
        },
      }
    : {}),
};

export default nextConfig;
