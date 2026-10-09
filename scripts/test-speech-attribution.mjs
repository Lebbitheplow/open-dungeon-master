// Who is talking (docs/vtt-parity-implementation-plan.md 8.1): a quote
// near a known name is theirs, a quote near nobody stays the narrator's.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { attributeSpeech, normalizeSpeaker, speakersIn, spokenLine } = await import("../src/lib/dm/speech.ts");

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

// A name beside a line is not its speaker: the sentence before a line is
// about whoever it opens with, and a person the table does not know is
// still somebody.
const said = (text, table) =>
  attributeSpeech(text, table)
    .filter((segment) => segment.kind === "speech")
    .map((segment) => `${segment.speaker.name}: ${segment.text.slice(0, 12)}`);

const SHRINE = [
  "Sella inclines her head to Liriel, a small acknowledgment rather than a smile.",
  "",
  "“Duskleaf’s waystone. I took it because someone was altering the ward through this fragment. Leaving it there would have meant letting them finish.”",
  "",
  "She keeps her hand beside the etched stone. “I didn’t steal its light. I was trying to keep someone from turning that light against the people it protects. But taking the fragment hasn’t cleansed it—please don’t simply put it back.”",
  "",
  "Her gaze moves between you. “The shrine’s basin may show what’s been done to it. Will you help me find out?”",
].join("\n");

test("a line after 'Sella turns to Liriel' is Sella's, or nobody's when Sella is not in the cast", () => {
  const liriel = { kind: "pc", id: "s1", name: "Liriel Syn'thae" };
  assert.deepEqual(said(SHRINE, [liriel]), [], "the party member the NPC bowed to never takes her lines");
  const sella = { kind: "npc", id: "n9", name: "Sella" };
  assert.deepEqual(said(SHRINE, [liriel, sella]), ["Sella: Duskleaf’s w", "Sella: I didn’t ste", "Sella: The shrine’s"], "she and her carry on about Sella");
});

test("the subject of the sentence before a line speaks it, not the person it turns to", () => {
  assert.deepEqual(said('Marla turns to Old Pike. "We leave at dawn."', cast), ["Marla: We leave at "]);
  assert.deepEqual(said('The innkeeper turns to Marla. "We leave at dawn."', cast), [], "an unknown speaker is still not Marla");
  assert.deepEqual(said('Kaelen inclines his head. "Prudent."\n\nBrisca slips half the coin into her belt.', [{ kind: "npc", id: "k", name: "Father Kaelen" }, { kind: "pc", id: "b", name: "Brisca Hale" }]), ["Father Kaelen: Prudent."]);
});

test("a tag's pronoun is the person before it, never a name the tag mentions", () => {
  assert.deepEqual(said('Marla kneels by the fire. "Hold still," she says, glancing at Old Pike.', cast), ["Marla: Hold still,"]);
  assert.deepEqual(said('Marla looks up. "Who goes there?" a guard calls.', cast), [], "a stranger's tag is a stranger's line");
  assert.deepEqual(said('Sella turns to Marla. "Who goes there?" Marla calls out.', cast), ["Marla: Who goes the"], "a name with a verb of speech after a question is its tag");
  assert.deepEqual(said('Marla looks up. "Fine," you say.', cast), [], "the players' own words are nobody's at the table");
});

test("an action after a line counts only in the line's own paragraph, and only as its subject", () => {
  assert.deepEqual(said('"Not tonight." Marla frowns.', cast), ["Marla: Not tonight."]);
  assert.deepEqual(said('"There is more trouble at the market."\n\nMarla turns to you.', cast), [], "the next paragraph's first name is not this line's speaker");
  const table = [...cast, { kind: "pc", id: "s1", name: "Lebbi" }];
  assert.deepEqual(said('A merchant approaches you, his face pale. "Please! Take this!" He thrusts a heavy pouch into Lebbi\'s hands.', table), [], "a merchant's line is not the hands he fills");
});

test("a pronoun only follows back past a second name when the passage says it means the first", () => {
  assert.deepEqual(said('Marla nods to Old Pike. He grins. "Fine."', cast), [], "he could be Pike");
  assert.deepEqual(said('Marla nods to Old Pike, then tucks her hair back. She waits. "Fine."', cast), [], "her hair comes after Pike is named, so it could be anyone's");
  assert.deepEqual(said('Marla sets down her cup and nods to Old Pike. She waits. "Fine."', cast), ["Marla: Fine."], "her cup is Marla's, so she is Marla");
  assert.deepEqual(said('Marla looks up. She sighs, and he shrugs. "Fine."', cast), [], "she and he both: two people");
  assert.deepEqual(said('"One," says Marla. She pauses. "Two."', cast), ["Marla: One,", "Marla: Two."], "a pronoun after the tag follows the last speaker");
});

test("a line names nobody by the words inside other lines, and runs no further than its own line", () => {
  assert.deepEqual(said('A stranger bursts in. "Marla sent me to find you." The room goes still. "Sit down."', cast), []);
  const unclosed = said('Marla says, "We go now.\n\n"Wait," says Old Pike.', cast);
  assert.deepEqual(unclosed, ["Old Pike: Wait,"], "an unclosed quote does not swallow the next paragraph");
});

test("a sentence that hands the floor to a line, an opening phrase, a possessive, a name with an accent", () => {
  assert.deepEqual(said('Old Pike watches as Marla says, "Enough."', cast), ["Marla: Enough."]);
  assert.deepEqual(said('Without looking up, Marla sets down her cup. "Enough."', cast), ["Marla: Enough."]);
  assert.deepEqual(said('"Lebbi," Marla\'s voice comes from the dark.', cast), ["Marla: Lebbi,"]);
  assert.deepEqual(said('Élodie smiles. "Welcome."', [{ kind: "npc", id: "e", name: "Élodie" }]), ["Élodie: Welcome."]);
  assert.deepEqual(said('Captain Venn frowns. "Not tonight."', [{ kind: "npc", id: "n1", name: "Captain Marla Venn" }]), ["Captain Marla Venn: Not tonight."]);
});

test("Say quotes a player's words once, and never turns their action into speech", () => {
  assert.equal(spokenLine("  Then tell us.  "), '"Then tell us."');
  assert.equal(spokenLine('"Then tell us."'), '"Then tell us."', "already quoted");
  const mixed = 'Liriel leaves the fragment untouched. "Then tell us. Which waystone did this come from?"';
  assert.equal(spokenLine(mixed), mixed, "the action stays action and the line stays a line");
  assert.equal(spokenLine("“Then tell us,” Liriel says."), "“Then tell us,” Liriel says.");
});

console.log(`test-speech-attribution: ${passed} passed`);
