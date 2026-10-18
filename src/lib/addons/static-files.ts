import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { safeEntryPath } from "@/lib/addons/archive";
import { resolveInside } from "@/lib/addons/paths";

// Serving an addon's static files: the pages its board views draw in (its
// package's ui/ folder) and the assets its setup put in its data folder's
// public/ (models, sprite sheets, textures). Both are served to anyone who
// asks, like the app's own scripts, because the frame that loads them is
// sandboxed without allow-same-origin and its requests carry no cookie.
// What keeps them harmless is in the headers, on every file:
//
//   - Content-Security-Policy "sandbox allow-scripts": a page is sandboxed
//     even when opened on its own, not only inside the table's frame.
//   - Nothing loads from, or connects to, anywhere but this server; no
//     forms, no <base>, no plugins.
//   - Framing is allowed from anywhere (next.config.ts leaves these paths
//     out of the app's frame-ancestors rule), because the desktop app draws
//     the table from its own file:// page and frames the host from there.
//   - Access-Control-Allow-Origin: *, because the frame's opaque origin
//     makes even its own module scripts cross-origin requests.

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  // Binary glTF only: it carries its buffers and textures inside itself.
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
  // Godot Web resource packs and ordinary board-view UI audio.
  ".pck": "application/octet-stream",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".ktx2": "image/ktx2",
};

const ADDON_FILE_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "sandbox allow-scripts",
].join("; ");

function notFound() {
  return Response.json({ error: "Not found." }, { status: 404 });
}

// One file under `root`, named by the route's path segments, or a 404 for
// anything that is not a plain file of a served type inside it.
export async function serveAddonFile(root: string, segments: string[], maxBytes: number): Promise<Response> {
  let joined: string;
  try {
    joined = segments.map((segment) => decodeURIComponent(segment)).join("/");
  } catch {
    return notFound();
  }
  const relative = safeEntryPath(joined);
  if (!relative || relative.split("/").some((part) => part.startsWith("."))) return notFound();
  const file = resolveInside(root, relative);
  const type = CONTENT_TYPES[path.extname(relative).toLowerCase()];
  if (!file || !type) return notFound();
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size > maxBytes) return notFound();
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(info.size),
      "Content-Security-Policy": ADDON_FILE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cache-Control": "no-cache",
    },
  });
}
