import zlib from "node:zlib";

// A route's JSON answer, packed when it is big and the caller takes it.
// `next start` gzips its pages and static files but not a route handler's
// answer, so a 4,000-entry world went over the wire as 12.7 MB of JSON
// (audit WF-24, docs/worldforge-large-worlds.md). Packed it is about 2 MB.
// A small answer is sent as Response.json would send it.
//
// Brotli at its fastest packs that world in about 40 ms and gzip at its
// fastest in about 70 ms; either beats sending 12.7 MB on anything slower
// than the machine itself. Both run synchronously on purpose: zlib's own
// pool, shared with the server's other work, took 3 to 4 seconds for the
// same answer in the running server (measured in the docs above).

const FROM_BYTES = 64 * 1024;

function codings(request: Request): string[] {
  return (request.headers.get("accept-encoding") ?? "").split(",").map((part) => part.split(";")[0].trim());
}

export function compressedJson(request: Request, body: unknown, init: ResponseInit = {}): Response {
  const text = JSON.stringify(body);
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const accepted = text.length < FROM_BYTES ? [] : codings(request);
  if (accepted.includes("br")) {
    headers.set("content-encoding", "br");
    headers.append("vary", "Accept-Encoding");
    return new Response(new Uint8Array(zlib.brotliCompressSync(text, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } })), { ...init, headers });
  }
  if (accepted.includes("gzip")) {
    headers.set("content-encoding", "gzip");
    headers.append("vary", "Accept-Encoding");
    return new Response(new Uint8Array(zlib.gzipSync(text, { level: 1 })), { ...init, headers });
  }
  return new Response(text, { ...init, headers });
}
