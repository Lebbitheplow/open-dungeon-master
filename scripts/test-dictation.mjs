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
  pickDictationEngine,
  pickRecorderType,
} = await import("../src/lib/dictation.ts");
const { decodeWav, encodeWav, splitForUpload, SPEECH_CHUNK_SECONDS, SPEECH_SAMPLE_RATE } = await import("../src/lib/speech-wav.ts");
const { pickSttBackend, sttWantsWav } = await import("../src/lib/stt-logic.ts");
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

test("the server's engine: Whisper, then built-in, then OpenAI", () => {
  const base = { explicitWhisperUrl: "", whisperReachable: false, builtinInstalled: false, openAiKey: "" };
  assert.equal(pickSttBackend(base), "none");
  assert.equal(pickSttBackend({ ...base, openAiKey: "sk-test" }), "openai");
  assert.equal(pickSttBackend({ ...base, openAiKey: "  " }), "none");
  assert.equal(pickSttBackend({ ...base, openAiKey: "sk-test", builtinInstalled: true }), "builtin");
  assert.equal(pickSttBackend({ ...base, builtinInstalled: true, whisperReachable: true }), "whisper");
  // An address an admin typed is trusted: other Whisper servers may not
  // answer the model-list probe.
  assert.equal(pickSttBackend({ ...base, explicitWhisperUrl: "http://stt.lan:9000", builtinInstalled: true }), "whisper");
  assert.equal(sttWantsWav("builtin"), true);
  assert.equal(sttWantsWav("whisper"), false);
  assert.equal(sttWantsWav("openai"), false);
});

test("the page's engine follows the server, then the device", () => {
  assert.equal(pickDictationEngine(null, true), "upload");
  assert.equal(pickDictationEngine(undefined, false), "upload");
  assert.equal(pickDictationEngine({ configured: true }, true), "upload");
  assert.equal(pickDictationEngine({ configured: true, wantsWav: true }, true), "upload-wav");
  assert.equal(pickDictationEngine({ configured: false }, true), "native");
  assert.equal(pickDictationEngine({ configured: false }, false), "none");
});

test("WAV goes out and comes back as the same samples", () => {
  const samples = Float32Array.from({ length: 1600 }, (_, index) => Math.sin(index / 7) * 0.5);
  const bytes = encodeWav(samples);
  assert.equal(bytes.length, 44 + samples.length * 2);
  const back = decodeWav(bytes);
  assert.ok(back);
  assert.equal(back.sampleRate, SPEECH_SAMPLE_RATE);
  assert.equal(back.samples.length, samples.length);
  for (let index = 0; index < samples.length; index += 97) {
    assert.ok(Math.abs(back.samples[index] - samples[index]) < 1e-3, `sample ${index}`);
  }
  // Loud values clip rather than wrap.
  const loud = decodeWav(encodeWav(Float32Array.of(2, -2)));
  assert.ok(loud.samples[0] > 0.99 && loud.samples[1] < -0.99);
});

test("stereo and float WAV read as mono; anything else is refused", () => {
  const frames = 4;
  const bytes = new Uint8Array(44 + frames * 2 * 4);
  const view = new DataView(bytes.buffer);
  const text = (at, value) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + frames * 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, 2, true);
  view.setUint32(24, 48000, true); view.setUint32(28, 48000 * 8, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true);
  text(36, "data"); view.setUint32(40, frames * 8, true);
  for (let frame = 0; frame < frames; frame += 1) {
    view.setFloat32(44 + frame * 8, 0.5, true);
    view.setFloat32(48 + frame * 8, -0.1, true);
  }
  const read = decodeWav(bytes);
  assert.equal(read.sampleRate, 48000);
  assert.equal(read.samples.length, frames);
  assert.ok(Math.abs(read.samples[0] - 0.2) < 1e-6);
  assert.equal(decodeWav(new TextEncoder().encode("not a wav file at all, just some text here....")), null);
  assert.equal(decodeWav(new Uint8Array(10)), null);
});

test("a long take goes up in parts, cut at a pause", () => {
  const rate = SPEECH_SAMPLE_RATE;
  const short = new Float32Array(rate * 30);
  assert.equal(splitForUpload(short).length, 1);
  // Five minutes of "speech" with one silent half second near each limit.
  const long = Float32Array.from({ length: rate * 300 }, (_, index) => Math.sin(index / 5) * 0.4);
  const pauseAt = rate * (SPEECH_CHUNK_SECONDS - 3);
  long.fill(0, pauseAt, pauseAt + rate / 2);
  const parts = splitForUpload(long);
  assert.equal(parts.reduce((sum, part) => sum + part.length, 0), long.length);
  assert.ok(parts.every((part) => part.length <= rate * SPEECH_CHUNK_SECONDS));
  assert.ok(parts.length >= 3);
  // The first cut lands inside the pause, not at the hard limit.
  assert.ok(parts[0].length >= pauseAt && parts[0].length <= pauseAt + rate / 2, String(parts[0].length / rate));
  // Every part fits /api/stt's 8 MB as WAV.
  assert.ok(encodeWav(parts[0]).length < 8 * 1024 * 1024);
});

console.log(`dictation: ${passed} checks passed`);
