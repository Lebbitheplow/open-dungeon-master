// Casting voices (issue 97): which of the server's voices a speaker without
// one is given. Deterministic, of the right sort when that is known, and as
// different from the rest of the table as the server allows.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { castingPool, genderFromProse, guessGender, pickVoice, voiceGender } = await import("../src/lib/tts-cast.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const KOKORO = ["af_heart", "af_bella", "af_v0bella", "am_michael", "am_fenrir", "am_santa", "bf_emma", "bm_george", "jf_alpha", "ef_dora", "am_adam"];

test("the pool is the narrator's language, without the narrator, old takes and novelties", () => {
  const pool = castingPool(KOKORO, "af_heart");
  assert.ok(!pool.includes("af_heart"), "nobody shares the narrator's voice");
  assert.ok(!pool.includes("af_v0bella") && !pool.includes("am_santa"));
  assert.ok(!pool.includes("jf_alpha") && !pool.includes("ef_dora"), "an English table is not cast in Japanese");
  assert.ok(pool.indexOf("af_bella") < pool.indexOf("am_adam"), "the shipped voices come first");
  assert.deepEqual(castingPool(KOKORO, "ef_dora"), [], "a Spanish narrator is cast from Spanish voices only");
  assert.deepEqual(castingPool(["alloy", "nova", "onyx"], "alloy"), ["nova", "onyx"], "a server with its own names is taken as it is");
});

test("a voice says what it sounds like, and so does a description", () => {
  assert.equal(voiceGender("af_heart"), "f");
  assert.equal(voiceGender("bm_george"), "m");
  assert.equal(voiceGender("onyx"), "m");
  assert.equal(voiceGender("af_heart(30)+af_bella(70)"), "");
  assert.equal(guessGender("she/her"), "f");
  assert.equal(guessGender("Male"), "m");
  assert.equal(guessGender("female"), "f", "female is not male");
  assert.equal(guessGender("a tired old man who misses his wife"), "m");
  assert.equal(guessGender("they/them"), "");
  assert.equal(guessGender(""), "");
});

test("a pick suits the speaker, is stable, and avoids voices already taken", () => {
  const pool = castingPool(KOKORO, "af_heart");
  const first = pickVoice("Old Pike", "m", pool, []);
  assert.equal(voiceGender(first), "m");
  assert.equal(pickVoice("Old Pike", "m", pool, []), first, "the same speaker is always cast the same way");
  const taken = [];
  for (const name of ["Pike", "Aldric", "Bram"]) {
    taken.push(pickVoice(name, "m", pool, taken));
  }
  assert.equal(new Set(taken).size, 3, "three men, three voices, while the server has them");
  assert.ok(taken.every((voice) => ["am_michael", "am_fenrir", "bm_george"].includes(voice)), "the named voices go first");
  assert.equal(voiceGender(pickVoice("Wren", "", pool, [])) !== "", true);
  assert.equal(pickVoice("Wren", "f", [], []), "", "a server with no voices casts no one");
  assert.equal(pickVoice("Wren", "f", ["onyx"], []), "onyx", "with nothing suitable, any voice beats none");
});

test("the story so far says who is a he and who is a she", () => {
  const table = [
    { kind: "pc", id: "brom", name: "Brom Ironfist" },
    { kind: "pc", id: "kara", name: "Kara" },
    { kind: "npc", id: "wren", name: "Wren" },
    { kind: "npc", id: "pike", name: "Old Pike" },
  ];
  const told = genderFromProse(table, [
    "Brom plants his feet and raises his shield. Kara draws her bow, and she does not miss.",
    "Brom grunts as the blow lands on him. Wren says nothing.",
    "Pike looks at Kara. He hands her the key, and she takes it.",
  ]);
  assert.equal(told.get("brom"), "m");
  assert.equal(told.get("kara"), "f");
  assert.equal(told.get("wren"), "", "nothing said, nothing guessed");
  assert.equal(told.get("pike"), "", "the pronouns after the next name are that person's, not his");
});

console.log(`test-tts-cast: ${passed} passed`);
