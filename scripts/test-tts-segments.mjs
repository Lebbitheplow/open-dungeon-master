// Per-NPC voices (docs/vtt-parity-implementation-plan.md 8.2): prose in
// the narrator's voice, attributed lines in their speaker's, a message
// spoken outright as someone all in theirs.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { baseCreatureName, chunkSentences, clampSpeed, planSpeech, speechRequests, FIRST_CHUNK_CHARS, CHUNK_CHARS } = await import("../src/lib/tts-segments.ts");
const { attributeSpeech, linesOf } = await import("../src/lib/dm/speech.ts");

// A passage voiced with the lines the server stores for it: here, a
// person's English prose, read from its words (src/lib/dm/speech.ts).
const voiced = (text, options) =>
  planSpeech(text, {
    lines: linesOf(attributeSpeech(text, options.cast.map((entry) => ({ kind: "npc", id: "", name: entry.name })), { pronouns: true })),
    ...options,
  });

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
  const plan = voiced('The door opens. "You came back," says Marla. She sits. "Sit," says Old Pike.', { narratorVoice: "af_heart", cast });
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
  const plan = voiced('"Hush," says Wren.', { narratorVoice: "af_heart", cast: [{ name: "Wren", voiceId: "", speed: 1 }] });
  assert.equal(plan.length, 1, "a voiceless cast member is not a segment boundary");
  assert.equal(plan[0].voice, "af_heart");
});

test("a message spoken as one person is all in their voice", () => {
  const plan = voiced("I told you not to come back. Sit.", { narratorVoice: "af_heart", cast, speaker: { kind: "npc", id: "n1", name: "Marla" } });
  assert.deepEqual(plan, [{ text: "I told you not to come back. Sit.", voice: "bf_emma", speed: 1.1, speaker: "Marla" }]);
  const monster = voiced("Grr.", { narratorVoice: "af_heart", cast, speaker: { kind: "monster", id: "", name: "Ogre" } });
  assert.equal(monster[0].voice, "af_heart", "a monster with no voice reads in the narrator's");
});

test("speed is clamped and defaults to one", () => {
  assert.equal(clampSpeed(3), 1.4);
  assert.equal(clampSpeed(0.1), 0.7);
  assert.equal(clampSpeed("x"), 1);
  assert.equal(clampSpeed(1.234), 1.23);
});

// Issue 97: characters and monsters have voices too, and the narrator a pace.
test("a character is heard by a short name, a monster by what it is", () => {
  const table = [
    { name: "Kara Brightwood", voiceId: "af_bella", speed: 1 },
    { name: "Goblin", voiceId: "am_puck", speed: 1.2 },
  ];
  const plan = voiced('"I will go first," Kara says.', { narratorVoice: "af_heart", narratorSpeed: 0.9, cast: table });
  assert.deepEqual(plan.map((part) => [part.voice, part.speed]), [["af_bella", 1], ["af_heart", 0.9]]);
  const monster = voiced("Shinies. Give.", { narratorVoice: "af_heart", cast: table, speaker: { kind: "monster", id: "e2", name: "Goblin 2" } });
  assert.deepEqual([monster[0].voice, monster[0].speed], ["am_puck", 1.2]);
  assert.equal(baseCreatureName("Goblin B"), "Goblin");
  assert.equal(baseCreatureName("Ogre #3"), "Ogre");
  assert.equal(baseCreatureName("Marla Venn"), "Marla Venn");
});

test("the first request is short, the rest are whole sentences under the cap", () => {
  const sentence = "The rain comes down on the slate roofs of the lower town and does not stop. ";
  const long = sentence.repeat(40).trim();
  const requests = speechRequests([{ text: long, voice: "af_heart", speed: 1, speaker: null }]);
  assert.ok(requests[0].text.length <= FIRST_CHUNK_CHARS, "the table hears the first words soon");
  assert.ok(requests.slice(1).every((request) => request.text.length <= CHUNK_CHARS));
  assert.ok(requests.every((request) => /[.]$/.test(request.text)), "no sentence is cut in half");
  assert.equal(requests.map((request) => request.text).join(" "), long, "and nothing is lost");
  assert.deepEqual(chunkSentences("Short.", 320), ["Short."]);
  const crumbs = speechRequests([
    { text: "...", voice: "af_heart", speed: 1, speaker: null },
    { text: "Sit.", voice: "bf_emma", speed: 1, speaker: "Marla" },
  ]);
  assert.equal(crumbs.length, 1, "punctuation alone is not sent to be read");
});

test("a line is voiced as the transcript reads it, never by the name it is said to", () => {
  const table = [{ name: "Liriel Syn'thae", voiceId: "af_bella", speed: 1 }];
  const shrine = "Sella inclines her head to Liriel, a small acknowledgment rather than a smile.\n\n“Duskleaf’s waystone. I took it.”\n\nShe keeps her hand beside the etched stone.";
  const plan = voiced(shrine, { narratorVoice: "af_heart", cast: table });
  assert.deepEqual(plan.map((part) => part.voice), ["af_heart"], "the party member's voice never reads the NPC's line");
  assert.ok(!plan[0].text.includes("\n"), "the speech server hears one flowing run");
  const neighbours = voiced('Wren turns to Marla. "Hush."', { narratorVoice: "af_heart", cast: [...cast, { name: "Wren", voiceId: "", speed: 1 }] });
  assert.deepEqual(neighbours.map((part) => part.voice), ["af_heart"], "a voiceless speaker's line is not handed to the voiced name beside it");
  const apart = voiced('"There is trouble at the market."\n\nMarla turns to you.', { narratorVoice: "af_heart", cast });
  assert.deepEqual(apart.map((part) => part.voice), ["af_heart"], "the next paragraph's first name does not read this one's line");
});

test("the stored lines say who speaks, in any language, whatever the words around them", () => {
  const text = "La porta si apre. «Sei tornato.» Sorride.";
  const lines = [{ line: "Sei tornato.", speaker: { kind: "npc", id: "n1", name: "Marla" } }];
  assert.deepEqual(
    planSpeech(text, { narratorVoice: "af_heart", cast, lines }).map((part) => [part.voice, part.text]),
    [["af_heart", "La porta si apre."], ["bf_emma", "Sei tornato."], ["af_heart", "Sorride."]],
  );
  assert.deepEqual(planSpeech(text, { narratorVoice: "af_heart", cast, lines: [] }).map((part) => part.voice), ["af_heart"], "no stored line, no cut");
});

console.log(`test-tts-segments: ${passed} passed`);
