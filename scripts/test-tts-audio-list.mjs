// listNarrationAudio: the snapshot's list of narrated messages is cached per
// campaign and trusted only while the folder's mtime stands, so a take that
// lands from anywhere (this process, another, a restart) shows up on the
// next read without a readdir on every snapshot.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-tts-list-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const previousCwd = process.cwd();
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { listNarrationAudio: listVersioned } = await import("../src/lib/tts.ts");

// Each take is addressed with the moment it was written (?v=), so a passage
// narrated again is never answered from a browser's copy of the first take.
// The listing itself is checked without it; the version has its own test.
function listNarrationAudio(campaignId) {
  return Object.fromEntries(Object.entries(listVersioned(campaignId)).map(([id, url]) => [id, url.replace(/\?v=\d+$/, "")]));
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const audioDir = path.join(dir, "public", "generated-audio", "camp-1");

// Directory mtimes have at worst one-second resolution on some file
// systems; step the clock by hand so each write is a distinct instant.
let tick = Date.now() / 1000 - 100;
function touchDir() {
  tick += 2;
  fs.utimesSync(audioDir, tick, tick);
}

await test("a campaign with no folder lists nothing", () => {
  assert.deepEqual(listNarrationAudio("camp-1"), {});
});

await test("takes on disk are listed by message id", () => {
  fs.mkdirSync(audioDir, { recursive: true });
  fs.writeFileSync(path.join(audioDir, "m1.mp3"), "a");
  fs.writeFileSync(path.join(audioDir, "notes.txt"), "not audio");
  touchDir();
  assert.deepEqual(listNarrationAudio("camp-1"), { m1: "/generated-audio/camp-1/m1.mp3" });
});

await test("a repeated read is served from memory and cannot be mutated by the caller", () => {
  const first = listNarrationAudio("camp-1");
  first.m1 = "tampered";
  first.extra = "x";
  assert.deepEqual(listNarrationAudio("camp-1"), { m1: "/generated-audio/camp-1/m1.mp3" });
});

await test("a take written by anyone else shows up on the next read", () => {
  fs.writeFileSync(path.join(audioDir, "m2.mp3"), "b");
  touchDir();
  assert.deepEqual(listNarrationAudio("camp-1"), {
    m1: "/generated-audio/camp-1/m1.mp3",
    m2: "/generated-audio/camp-1/m2.mp3",
  });
});

await test("a take written again gets a new address", () => {
  const first = listVersioned("camp-1").m2;
  assert.match(first, /^\/generated-audio\/camp-1\/m2\.mp3\?v=\d+$/);
  fs.writeFileSync(path.join(audioDir, "m2.mp3"), "second take");
  fs.utimesSync(path.join(audioDir, "m2.mp3"), tick + 50, tick + 50);
  touchDir();
  assert.notEqual(listVersioned("camp-1").m2, first);
});

await test("a take removed from disk drops out", () => {
  fs.rmSync(path.join(audioDir, "m1.mp3"));
  touchDir();
  assert.deepEqual(listNarrationAudio("camp-1"), { m2: "/generated-audio/camp-1/m2.mp3" });
});

await test("a folder that goes away lists nothing again", () => {
  fs.rmSync(audioDir, { recursive: true });
  assert.deepEqual(listNarrationAudio("camp-1"), {});
});

process.chdir(previousCwd);
removeTempDir(dir);
console.log(`\n${passed} narration list tests passed.`);
