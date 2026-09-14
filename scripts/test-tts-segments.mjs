// Per-NPC voices (docs/vtt-parity-implementation-plan.md 8.2): prose in
// the narrator's voice, attributed lines in their speaker's, a message
// spoken outright as someone all in theirs.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { clampSpeed, planSpeech } = await import("../src/lib/tts-segments.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const cast = [
  { name: "Marla", voiceId: "bf_emma", speed: 1.1 },
  { name: "Old Pike", voiceId: "am_fenrir", speed: 0.9 },
];

test("prose reads in the narrator's voice and each line in its own", () => {
  const plan = planSpeech('The door opens. "You came back," says Marla. She sits. "Sit," says Old Pike.', { narratorVoice: "af_heart", cast });
  assert.deepEqual(
    plan.map((part) => [part.voice, part.speaker, part.text]),
    [
      ["af_heart", null, "The door opens."],
      ["bf_emma", "Marla", "You came back,"],
      ["af_heart", null, "says Marla. She sits."],
      ["am_fenrir", "Old Pike", "Sit,"],
      ["af_heart", null, "says Old Pike."],
    ],
  );
  assert.equal(plan[1].speed, 1.1);
});

test("a speaker without a voice of their own reads in the narrator's", () => {
  const plan = planSpeech('"Hush," says Wren.', { narratorVoice: "af_heart", cast: [{ name: "Wren", voiceId: "", speed: 1 }] });
  assert.equal(plan.length, 1, "a voiceless cast member is not a segment boundary");
  assert.equal(plan[0].voice, "af_heart");
});

test("a message spoken as one person is all in their voice", () => {
  const plan = planSpeech("I told you not to come back. Sit.", { narratorVoice: "af_heart", cast, speaker: { kind: "npc", id: "n1", name: "Marla" } });
  assert.deepEqual(plan, [{ text: "I told you not to come back. Sit.", voice: "bf_emma", speed: 1.1, speaker: "Marla" }]);
  const monster = planSpeech("Grr.", { narratorVoice: "af_heart", cast, speaker: { kind: "monster", id: "", name: "Ogre" } });
  assert.equal(monster[0].voice, "af_heart", "a monster with no voice reads in the narrator's");
});

test("speed is clamped and defaults to one", () => {
  assert.equal(clampSpeed(3), 1.4);
  assert.equal(clampSpeed(0.1), 0.7);
  assert.equal(clampSpeed("x"), 1);
  assert.equal(clampSpeed(1.234), 1.23);
});

console.log(`test-tts-segments: ${passed} passed`);
