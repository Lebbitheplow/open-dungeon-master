import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

// Streams a runtime-generated file from under public/. Needed because this
// Next.js build only statically serves public/ files that existed at build
// time; images and narration audio are written while the server runs.
// Traversal-safe: the resolved path must stay inside the allowed root.
export function serveGeneratedFile(rootDir: string, segments: string[]): Response {
  const root = path.join(process.cwd(), "public", rootDir);
  const resolved = path.resolve(root, ...segments);
  if (!resolved.startsWith(root + path.sep)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const extension = path.extname(resolved).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType || !existsSync(resolved)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const { size } = statSync(resolved);
  const stream = Readable.toWeb(createReadStream(resolved)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
