// Who is talking (docs/vtt-parity-implementation-plan.md 8.1): a quote
// near a known name is theirs, a quote near nobody stays the narrator's.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { attributeSpeech, normalizeSpeaker, speakersIn } = await import("../src/lib/dm/speech.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const cast = [
  { kind: "npc", id: "n1", name: "Marla" },
  { kind: "npc", id: "n2", name: "Old Pike" },
];

test("a name before or after a quote attributes it, within eight words", () => {
  const segments = attributeSpeech('Marla looks up. "You came back," she says. The fire pops. "Sit," says Old Pike.', cast);
  assert.deepEqual(
    segments.map((segment) => (segment.kind === "speech" ? `${segment.speaker.name}: ${segment.text}` : `prose: ${segment.text.trim()}`)),
    ["prose: Marla looks up.", "Marla: You came back,", "prose: she says. The fire pops.", "Old Pike: Sit,", "prose: says Old Pike."],
  );
});

test("a quote with no name near it stays the narrator's", () => {
  const far = `Someone in the crowd, eleven words further along the way than any name, mutters "Not again." Nine plain words then quietly follow before the name Marla appears.`;
  const segments = attributeSpeech(far, cast);
  assert.ok(segments.every((segment) => segment.kind === "prose"), "the name is more than eight words off");
  assert.deepEqual(attributeSpeech("No quotes at all.", cast), [{ kind: "prose", text: "No quotes at all." }]);
  assert.deepEqual(attributeSpeech('"Hello," says Marla.', []), [{ kind: "prose", text: '"Hello," says Marla.' }]);
});

test("one line's name never borrows into the next, and curly quotes count", () => {
  const segments = attributeSpeech('“We ride at dawn,” said Marla. “Fine.”', cast);
  const speech = segments.filter((segment) => segment.kind === "speech");
  assert.equal(speech.length, 1, "Marla's name was spent on the first line; the second stays the narrator's");
  assert.equal(speech[0].speaker.name, "Marla");
  const apart = attributeSpeech('“We ride at dawn,” said Marla. Twelve long words then pass between the speakers before anyone else says anything more. “Fine.”', cast);
  assert.equal(apart.filter((segment) => segment.kind === "speech").length, 1);
});

test("speakers are listed once, in order, and a speaker normalises", () => {
  const segments = attributeSpeech('"One," says Marla. "Two," says Old Pike. "Three," says Marla.', cast);
  assert.deepEqual(speakersIn(segments).map((speaker) => speaker.name), ["Marla", "Old Pike"]);
  assert.deepEqual(normalizeSpeaker({ kind: "npc", id: "n1", name: " Marla " }), { kind: "npc", id: "n1", name: "Marla" });
  assert.equal(normalizeSpeaker({ kind: "npc" }), null);
  assert.equal(normalizeSpeaker("x"), null);
});

console.log(`test-speech-attribution: ${passed} passed`);
