import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  // The sound library takes whatever the archives hand it rather than
  // re-encoding: every browser this app targets plays all four.
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

// Every response carries this: browsers only seek media (and Safari only
// plays it at all) when the server says it honours byte ranges.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export type ByteRange = { start: number; end: number };

// One `bytes=` range against a file of `size` bytes, per RFC 9110 14.1.2:
// `bytes=a-b` (b clamped to the last byte), `bytes=a-` (to the end) and
// `bytes=-n` (the last n bytes). Returns null when there is no range to
// honour, which means the whole file goes out as a 200: no header, a unit
// other than bytes, or several ranges (a server may ignore those).
// "unsatisfiable" is a 416: a start past the end, an empty suffix, or a
// range that reads backwards.
export function parseRangeHeader(
  header: string | null | undefined,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) {
    return null;
  }
  const match = /^\s*bytes\s*=\s*(.*)$/i.exec(header);
  if (!match) {
    return null;
  }
  const spec = match[1].trim();
  if (spec.includes(",")) {
    return null;
  }
  const parts = /^(\d*)\s*-\s*(\d*)$/.exec(spec);
  if (!parts || (parts[1] === "" && parts[2] === "")) {
    return null;
  }
  if (parts[1] === "") {
    // Suffix: the last n bytes.
    const suffix = Number(parts[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0 || size === 0) {
      return "unsatisfiable";
    }
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(parts[1]);
  if (!Number.isSafeInteger(start) || start >= size) {
    return "unsatisfiable";
  }
  if (parts[2] === "") {
    return { start, end: size - 1 };
  }
  const end = Number(parts[2]);
  if (!Number.isSafeInteger(end) || end < start) {
    return "unsatisfiable";
  }
  return { start, end: Math.min(end, size - 1) };
}

// Streams a runtime-generated file from under public/. Needed because this
// Next.js build only statically serves public/ files that existed at build
// time; images and narration audio are written while the server runs.
// Traversal-safe: the resolved path must stay inside the allowed root.
//
// Pass the request so a `Range` header is answered with a 206 of just those
// bytes; without one the whole file goes out as before. The CORS headers the
// apps rely on are added by src/proxy.ts on the way out, not here.
export async function serveGeneratedFile(
  rootDir: string,
  segments: string[],
  request?: Pick<Request, "headers"> | null,
): Promise<Response> {
  const root = path.join(process.cwd(), "public", rootDir);
  const resolved = path.resolve(root, ...segments);
  if (!resolved.startsWith(root + path.sep)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const extension = path.extname(resolved).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  let size: number;
  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }
    size = info.size;
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const range = parseRangeHeader(request?.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  }
  if (range) {
    const stream = Readable.toWeb(
      createReadStream(resolved, { start: range.start, end: range.end }),
    ) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  }
  const stream = Readable.toWeb(createReadStream(resolved)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
