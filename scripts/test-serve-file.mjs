// serve-file: Range header parsing, and the responses the five media routes
// hand back (200 whole file, 206 partial, 416 unsatisfiable, 404 missing)
// with the headers the apps and the browsers' media elements rely on.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { parseRangeHeader, serveGeneratedFile } = await import("../src/lib/serve-file.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// ---- parsing ----

await test("no header, or a unit other than bytes, means the whole file", () => {
  assert.equal(parseRangeHeader(null, 100), null);
  assert.equal(parseRangeHeader(undefined, 100), null);
  assert.equal(parseRangeHeader("", 100), null);
  assert.equal(parseRangeHeader("items=0-9", 100), null);
  assert.equal(parseRangeHeader("bytes", 100), null);
  assert.equal(parseRangeHeader("bytes=", 100), null);
  assert.equal(parseRangeHeader("bytes=-", 100), null);
  assert.equal(parseRangeHeader("bytes=abc", 100), null);
});

await test("several ranges are ignored, so the whole file goes out", () => {
  assert.equal(parseRangeHeader("bytes=0-9,20-29", 100), null);
});

await test("a closed range is honoured and clamped to the last byte", () => {
  assert.deepEqual(parseRangeHeader("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRangeHeader("bytes=10-20", 1000), { start: 10, end: 20 });
  assert.deepEqual(parseRangeHeader("bytes=990-5000", 1000), { start: 990, end: 999 });
  assert.deepEqual(parseRangeHeader("BYTES = 0 - 1", 1000), { start: 0, end: 1 });
});

await test("an open range runs to the end", () => {
  assert.deepEqual(parseRangeHeader("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRangeHeader("bytes=0-", 1), { start: 0, end: 0 });
});

await test("a suffix range is the last n bytes, capped at the file", () => {
  assert.deepEqual(parseRangeHeader("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRangeHeader("bytes=-5000", 1000), { start: 0, end: 999 });
});

await test("unsatisfiable ranges are reported as such", () => {
  assert.equal(parseRangeHeader("bytes=1000-", 1000), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=1000-1010", 1000), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=50-10", 1000), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=-0", 1000), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=0-", 0), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=-10", 0), "unsatisfiable");
});

// ---- responses ----

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-serve-file-"));
const audioDir = path.join(dir, "public", "generated-audio", "camp");
fs.mkdirSync(audioDir, { recursive: true });
const bytes = Buffer.alloc(1000);
for (let i = 0; i < bytes.length; i += 1) {
  bytes[i] = i % 251;
}
fs.writeFileSync(path.join(audioDir, "take.mp3"), bytes);
fs.writeFileSync(path.join(audioDir, "notes.txt"), "not media");
const previousCwd = process.cwd();
process.chdir(dir);

const withRange = (range) => (range ? new Request("http://x/", { headers: { range } }) : undefined);

await test("without a Range the whole file goes out as a 200, now advertising ranges", async () => {
  const response = await serveGeneratedFile("generated-audio", ["camp", "take.mp3"], withRange());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("content-length"), "1000");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("content-range"), null);
  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(body.equals(bytes));
});

await test("the request argument is optional", async () => {
  const response = await serveGeneratedFile("generated-audio", ["camp", "take.mp3"]);
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 1000);
});

await test("a Range gets a 206 with exactly those bytes", async () => {
  const response = await serveGeneratedFile(
    "generated-audio",
    ["camp", "take.mp3"],
    withRange("bytes=100-199"),
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("content-length"), "100");
  assert.equal(response.headers.get("content-range"), "bytes 100-199/1000");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(body.equals(bytes.subarray(100, 200)));
});

await test("an open-ended Range streams to the last byte", async () => {
  const response = await serveGeneratedFile(
    "generated-audio",
    ["camp", "take.mp3"],
    withRange("bytes=990-"),
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 990-999/1000");
  assert.equal(response.headers.get("content-length"), "10");
  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(body.equals(bytes.subarray(990)));
});

await test("a Range past the end is a 416 naming the size", async () => {
  const response = await serveGeneratedFile(
    "generated-audio",
    ["camp", "take.mp3"],
    withRange("bytes=5000-"),
  );
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes */1000");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
});

await test("a missing file, a non-media extension and a traversal are all 404", async () => {
  for (const segments of [
    ["camp", "gone.mp3"],
    ["camp", "notes.txt"],
    ["..", "..", "package.json"],
    ["camp"],
  ]) {
    const response = await serveGeneratedFile("generated-audio", segments, withRange("bytes=0-9"));
    assert.equal(response.status, 404, segments.join("/"));
  }
});

process.chdir(previousCwd);
removeTempDir(dir);
console.log(`\n${passed} serve-file tests passed.`);
