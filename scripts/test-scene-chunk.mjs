// Scene chunking: size targets, seam breaks on system messages, seq-range
// integrity, oversized-message splitting, and fragment merging. Plus the
// pure cosine math used by the semantic index (no ONNX involved).
import assert from "node:assert/strict";
import { chunkScenes } from "../src/lib/dm/scene-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function msg(seq, authorType, content) {
  return { seq, authorType, content };
}

test("empty and system-only input produce no chunks", () => {
  assert.deepEqual(chunkScenes([]), []);
  assert.deepEqual(chunkScenes([msg(1, "system", "Chapter 1 closes."), msg(2, "system", "x")]), []);
});

test("short exchanges stay in one chunk with correct seq range", () => {
  const chunks = chunkScenes([
    msg(3, "dm", "The gate creaks open."),
    msg(4, "player", "I step through."),
    msg(5, "dm", "Darkness swallows you."),
  ]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].seqStart, 3);
  assert.equal(chunks[0].seqEnd, 5);
  assert.ok(chunks[0].text.includes("DM: The gate creaks open."));
  assert.ok(chunks[0].text.includes("Player: I step through."));
});

test("long transcripts split into target-sized chunks covering every seq", () => {
  const messages = Array.from({ length: 40 }, (_, index) =>
    msg(index + 1, index % 2 ? "player" : "dm", `Passage ${index} ${"words ".repeat(30)}`),
  );
  const chunks = chunkScenes(messages);
  assert.ok(chunks.length > 3);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 1600, `chunk too big: ${chunk.text.length}`);
    assert.ok(chunk.seqStart <= chunk.seqEnd);
  }
  assert.equal(chunks[0].seqStart, 1);
  assert.equal(chunks[chunks.length - 1].seqEnd, 40);
  for (let index = 1; index < chunks.length; index += 1) {
    assert.ok(chunks[index].seqStart > chunks[index - 1].seqEnd - 1);
  }
});

test("system messages break otherwise-mergeable content", () => {
  const filler = "story text ".repeat(30);
  const chunks = chunkScenes([
    msg(1, "dm", filler),
    msg(2, "system", "The party takes a long rest."),
    msg(3, "dm", filler),
  ]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].seqEnd, 1);
  assert.equal(chunks[1].seqStart, 3);
});

test("an oversized single message is hard-split, keeping its seq", () => {
  const chunks = chunkScenes([msg(9, "dm", "x".repeat(3000))]);
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) {
    assert.equal(chunk.seqStart, 9);
    assert.equal(chunk.seqEnd, 9);
    assert.ok(chunk.text.length <= 1200);
  }
});

test("a tiny trailing fragment merges into the previous chunk", () => {
  const filler = "story text ".repeat(60);
  const chunks = chunkScenes([
    msg(1, "dm", filler),
    msg(2, "system", "seam"),
    msg(3, "player", "Ok."),
  ]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].seqEnd, 3);
  assert.ok(chunks[0].text.endsWith("Player: Ok."));
});

// cosine over unit vectors is a dot product; mirror the app's math without
// importing the ONNX-backed module.
test("cosine math sanity", () => {
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const a = [1, 0, 0];
  const b = [0.6, 0.8, 0];
  assert.equal(dot(a, a), 1);
  assert.ok(Math.abs(dot(a, b) - 0.6) < 1e-9);
});

console.log(`${passed} scene chunk tests passed`);
