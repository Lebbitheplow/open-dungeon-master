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
  // mediasoup spawns a native worker binary and resolves it by path, so
  // bundling it breaks the lookup exactly the way it does for better-sqlite3.
  serverExternalPackages: ["better-sqlite3-multiple-ciphers", "mediasoup"],
  turbopack: {
    root: process.cwd(),
  },
  ...(dockerBuild
    ? {
        output: "standalone" as const,
        // File tracing misses all three native modules: better-sqlite3 is kept
        // out of the bundle by serverExternalPackages, onnxruntime-node (the
        // embedding runtime) resolves its .node binding by a computed path,
        // and mediasoup spawns a standalone worker executable that nothing
        // ever imports, so tracing has no reference to follow.
        // Only the linux/x64 binding is shipped; embeddings are CPU-only.
        outputFileTracingIncludes: {
          "/*": [
            "node_modules/better-sqlite3-multiple-ciphers/**/*",
            "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**/*",
            "node_modules/mediasoup/worker/out/Release/**/*",
          ],
        },
      }
    : {}),
};

export default nextConfig;
