// Dictation: how spoken words join what is already written, the take's
// limits, the recorder format the button asks for, and the level meter.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  DICTATION_BITRATE,
  DICTATION_MAX_MS,
  DICTATION_WARN_MS,
  appendDictation,
  dictationFileName,
  formatElapsed,
  levelFromWaveform,
  pickRecorderType,
} = await import("../src/lib/dictation.ts");
const { sttProbeUrl } = await import("../src/lib/capabilities.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("an empty field takes the words as said", () => {
  assert.equal(appendDictation("", "The mill burned."), "The mill burned.");
  assert.equal(appendDictation("   ", "  The mill burned.  "), "The mill burned.");
});

test("words join what is there with one space", () => {
  assert.equal(appendDictation("They reached the abbey.", "Aldric met them."), "They reached the abbey. Aldric met them.");
  assert.equal(appendDictation("They reached the abbey.  ", "Aldric met them."), "They reached the abbey. Aldric met them.");
});

test("a new line in the field is kept as the join", () => {
  assert.equal(appendDictation("Ask at the mill\n", "Search the weir"), "Ask at the mill\nSearch the weir");
});

test("nothing said leaves the field alone", () => {
  assert.equal(appendDictation("Kept as typed ", ""), "Kept as typed ");
  assert.equal(appendDictation("Kept", "   "), "Kept");
});

test("the field's limit holds, since code slips past maxLength", () => {
  const joined = appendDictation("a".repeat(295), "and then some more words", 300);
  assert.equal(joined.length, 300);
  assert.ok(joined.startsWith("a".repeat(295)));
  assert.equal(appendDictation("short", "words", 0), "short words");
});

test("the timer reads minutes and seconds", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(7_400), "0:07");
  assert.equal(formatElapsed(272_000), "4:32");
  assert.equal(formatElapsed(DICTATION_MAX_MS), "10:00");
  assert.equal(formatElapsed(-50), "0:00");
});

test("a full take fits the route and the tunnel", () => {
  // /api/stt refuses anything over 8 MB.
  const bytes = (DICTATION_BITRATE / 8) * (DICTATION_MAX_MS / 1000);
  assert.ok(bytes < 8 * 1024 * 1024, `${bytes} bytes`);
  assert.ok(DICTATION_WARN_MS < DICTATION_MAX_MS);
  assert.ok(DICTATION_MAX_MS - DICTATION_WARN_MS >= 10_000);
});

test("the recorder asks for Opus first and falls back", () => {
  assert.equal(pickRecorderType(() => true), "audio/webm;codecs=opus");
  assert.equal(pickRecorderType((type) => type === "audio/mp4"), "audio/mp4");
  assert.equal(pickRecorderType(() => false), "");
  assert.equal(
    pickRecorderType(() => {
      throw new Error("no");
    }),
    "",
  );
});

test("the file name matches the container", () => {
  assert.equal(dictationFileName("audio/webm;codecs=opus"), "speech.webm");
  assert.equal(dictationFileName("audio/mp4"), "speech.m4a");
  assert.equal(dictationFileName("audio/ogg;codecs=opus"), "speech.ogg");
  assert.equal(dictationFileName(""), "speech.webm");
});

test("the meter reads silence as zero and speech as a level", () => {
  assert.equal(levelFromWaveform(new Uint8Array(64).fill(128)), 0);
  assert.equal(levelFromWaveform([]), 0);
  const speech = Array.from({ length: 64 }, (_, index) => 128 + Math.round(Math.sin(index / 3) * 30));
  const level = levelFromWaveform(speech);
  assert.ok(level > 0.3 && level <= 1, String(level));
  assert.equal(levelFromWaveform(Array.from({ length: 64 }, (_, index) => (index % 2 ? 255 : 0))), 1);
});

test("the capability probe asks Whisper for its model list", () => {
  assert.equal(sttProbeUrl("http://127.0.0.1:8870"), "http://127.0.0.1:8870/v1/models");
  assert.equal(sttProbeUrl("http://stt.lan:8870/"), "http://stt.lan:8870/v1/models");
});

console.log(`dictation: ${passed} checks passed`);
