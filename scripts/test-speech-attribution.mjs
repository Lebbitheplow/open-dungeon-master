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

// Issue 97: the prose rarely spells a name out in full.
test("a first name, a last name or an alias finds the person", () => {
  const table = [
    { kind: "npc", id: "n1", name: "Captain Marla Venn", aliases: ["the Captain"] },
    { kind: "npc", id: "n2", name: "Old Pike" },
    { kind: "pc", id: "s1", name: "Kara Brightwood" },
  ];
  const said = (text) => attributeSpeech(text, table).filter((segment) => segment.kind === "speech").map((segment) => segment.speaker.id);
  assert.deepEqual(said('"Hold the gate," says Marla.'), ["n1"]);
  assert.deepEqual(said('Venn frowns. "Not tonight."'), ["n1"]);
  assert.deepEqual(said('"Stand down," orders the Captain.'), ["n1"]);
  assert.deepEqual(said('"Aye," mutters Pike.'), ["n2"]);
  assert.deepEqual(said('"I will go first," Kara says.'), ["s1"]);
  assert.deepEqual(said('"Too old for this," someone says.'), [], "a title or an adjective is nobody's name");
  const hill = [{ kind: "npc", id: "h", name: "Tom Hill" }];
  assert.equal(attributeSpeech('"Up the hill," someone calls.', hill).filter((segment) => segment.kind === "speech").length, 0, "a word of a name only counts written as a name");
  assert.equal(attributeSpeech('"Up we go," Hill calls.', hill).filter((segment) => segment.kind === "speech").length, 1);
});

test("a short name two people share belongs to neither", () => {
  const twins = [
    { kind: "npc", id: "a", name: "Aldric Venn" },
    { kind: "npc", id: "b", name: "Marla Venn" },
  ];
  const segments = attributeSpeech('"We are agreed," says Venn. "Good," says Marla.', twins);
  assert.deepEqual(segments.filter((segment) => segment.kind === "speech").map((segment) => segment.speaker.id), ["b"]);
});

test("a line the tag splits in two stays one speaker's, a reply does not", () => {
  const split = attributeSpeech('"We ride at dawn," said Marla, "and not a moment later."', cast);
  assert.deepEqual(split.filter((segment) => segment.kind === "speech").map((segment) => segment.text), ["We ride at dawn,", "and not a moment later."]);
  const crowded = attributeSpeech('"Hold the gate," says Marla, "or we all die here." Old Pike does not look up.', cast);
  assert.deepEqual(
    crowded.filter((segment) => segment.kind === "speech").map((segment) => segment.speaker.name),
    ["Marla", "Marla"],
    "the next name along does not take the second half of her sentence",
  );
  const reply = attributeSpeech('"We ride at dawn," said Marla. "Fine."', cast);
  assert.equal(reply.filter((segment) => segment.kind === "speech").length, 1);
});

console.log(`test-speech-attribution: ${passed} passed`);
