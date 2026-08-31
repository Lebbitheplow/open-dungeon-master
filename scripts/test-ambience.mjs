// The sound library: the cue catalog's shape, and the rules for changing
// what the table is hearing.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { AMBIENCE_CUES, BED_CUES, MUSIC_CUES, STING_CUES, cueById, cueIds, cueOptions } =
  await import("../src/lib/ambience/catalog.ts");
const {
  EMPTY_AMBIENCE,
  applyAuto,
  describeAmbience,
  inferBedCue,
  inferCue,
  normalizeAmbience,
  sameAmbience,
  setCue,
} = await import("../src/lib/ambience/logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("every cue is complete and uniquely named", () => {
  const ids = AMBIENCE_CUES.map((cue) => cue.id);
  assert.equal(new Set(ids).size, ids.length, "two cues share an id");
  assert.ok(BED_CUES.length >= 20, `only ${BED_CUES.length} beds`);
  assert.ok(MUSIC_CUES.length >= 8, `only ${MUSIC_CUES.length} music cues`);
  assert.ok(STING_CUES.length >= 8, `only ${STING_CUES.length} stings`);
  for (const cue of AMBIENCE_CUES) {
    assert.match(cue.id, /^[a-z][a-z_]*$/, `${cue.id} is not a usable tool enum value`);
    assert.ok(cue.label, `${cue.id} has no label`);
    assert.ok(cue.blurb, `${cue.id} has no blurb`);
    assert.ok(cue.search.length > 0, `${cue.id} tells the fetch script nothing to look for`);
    assert.ok(cue.gain > 0 && cue.gain <= 1, `${cue.id} has a nonsense gain`);
    // A bed or a music cue with no keywords can never be inferred, which is
    // half the point of the layer. Stings are only ever asked for by name.
    if (cue.layer !== "sting") {
      assert.ok(cue.keywords.length > 0, `${cue.id} can never be inferred`);
    }
  }
});

test("lookup respects the layer", () => {
  assert.equal(cueById("tavern")?.layer, "bed");
  assert.equal(cueById("battle")?.layer, "music");
  assert.equal(cueById("thunder")?.layer, "sting");
  assert.equal(cueById("no_such_cue"), null);
  assert.equal(cueById(""), null);
  assert.equal(cueIds("bed").length, BED_CUES.length);
  assert.deepEqual(
    cueOptions("music").map((option) => option.value),
    MUSIC_CUES.map((cue) => cue.id),
  );
});

test("a stored row that names nothing readable is silence", () => {
  assert.deepEqual(normalizeAmbience(null), EMPTY_AMBIENCE);
  assert.deepEqual(normalizeAmbience("tavern"), EMPTY_AMBIENCE);
  assert.deepEqual(normalizeAmbience({ bed: "gone_from_the_catalog" }), EMPTY_AMBIENCE);
  // A cue filed under the wrong layer is not a bed, whatever the row says.
  assert.equal(normalizeAmbience({ bed: "battle" }).bed, null);
  assert.equal(normalizeAmbience({ music: "tavern" }).music, null);
});

test("holding a silent layer is dropped on the way in", () => {
  // It would otherwise block every future inference for a layer that is not
  // even playing.
  const state = normalizeAmbience({ bed: null, music: "battle", held: ["bed", "music"] });
  assert.deepEqual(state.held, ["music"]);
});

test("naming a cue changes the layer and leaves the other alone", () => {
  const first = setCue(EMPTY_AMBIENCE, "bed", "tavern", { at: "t1" });
  assert.equal(first.changed, true);
  assert.equal(first.state.bed, "tavern");
  assert.equal(first.state.music, null);
  // The same cue again is not a change, so nothing is announced.
  const again = setCue(first.state, "bed", "tavern");
  assert.equal(again.changed, false);
  const silenced = setCue(first.state, "bed", null);
  assert.equal(silenced.changed, true);
  assert.equal(silenced.state.bed, null);
});

test("a guess never overwrites a held layer", () => {
  const held = setCue(EMPTY_AMBIENCE, "bed", "tavern", { hold: true }).state;
  assert.deepEqual(held.held, ["bed"]);
  const guessed = applyAuto(held, { bed: "cave" });
  assert.equal(guessed.changed, false);
  assert.equal(guessed.state.bed, "tavern");
  // A person naming another cue outright still gets their way.
  assert.equal(setCue(held, "bed", "cave").state.bed, "cave");
  // And naming one without hold releases the pin.
  assert.deepEqual(setCue(held, "bed", "cave").state.held, []);
});

test("a guess with no opinion about a layer leaves it alone", () => {
  const state = setCue(EMPTY_AMBIENCE, "music", "tension").state;
  // undefined is "no opinion"; null is "make it silent". They are not the
  // same, and confusing them would have combat music cut the room tone.
  assert.equal(applyAuto(state, { bed: "cave" }).state.music, "tension");
  assert.equal(applyAuto(state, { bed: "cave", music: null }).state.music, null);
});

test("silencing a layer never leaves it held", () => {
  const held = setCue(EMPTY_AMBIENCE, "music", "battle", { hold: true }).state;
  const off = setCue(held, "music", null, { hold: true });
  assert.equal(off.state.music, null);
  assert.deepEqual(off.state.held, []);
});

test("a place description picks the bed a DM would have picked", () => {
  assert.equal(inferBedCue("The Rusted Anchor, a low-beamed tavern by the docks"), "tavern");
  assert.equal(inferBedCue("A dripping cavern, the floor slick with run-off"), "cave");
  assert.equal(inferBedCue("Endless dunes under a white sky"), "desert");
  assert.equal(inferBedCue("The market square, packed with stalls"), "market");
  assert.equal(inferBedCue("A ford across the river, waist deep"), "river");
  assert.equal(inferBedCue("Wind off the sea, gulls over the shore"), "coast");
});

test("the more specific keyword wins", () => {
  // "dark forest" is two words and beats the bare "forest" inside it.
  assert.equal(inferBedCue("a dark forest, older than the road"), "deep_forest");
  assert.equal(inferBedCue("a forest, bright and loud with birds"), "forest");
});

test("a word that merely contains a keyword is not a match", () => {
  // "sea" inside "season", "mine" inside "determined", "camp" in "campaign".
  assert.equal(inferBedCue("the season had just turned"), null);
  assert.equal(inferBedCue("she was determined to go on"), null);
  assert.equal(inferBedCue("a campaign three winters old"), null);
});

test("nothing to hear reads as nothing", () => {
  assert.equal(inferBedCue(""), null);
  assert.equal(inferBedCue("   "), null);
  assert.equal(inferBedCue("He nods once and says nothing."), null);
  assert.equal(inferCue("a low-beamed tavern", "sting"), null);
});

test("music can be read too", () => {
  assert.equal(inferCue("the ambush is sprung", "music")?.cueId, "battle");
  assert.equal(inferCue("a funeral, and nobody speaks", "music")?.cueId, "sorrow");
});

test("sameAmbience compares held sets, not their order", () => {
  const a = { bed: "cave", music: "battle", held: ["bed", "music"], updatedAt: "t1" };
  const b = { bed: "cave", music: "battle", held: ["music", "bed"], updatedAt: "t2" };
  assert.equal(sameAmbience(a, b), true);
  assert.equal(sameAmbience(a, { ...a, bed: "tavern" }), false);
  assert.equal(sameAmbience(a, { ...a, held: ["bed"] }), false);
});

test("the description reads like something a DM would say", () => {
  assert.equal(describeAmbience(EMPTY_AMBIENCE), "The room goes quiet.");
  assert.match(describeAmbience(setCue(EMPTY_AMBIENCE, "bed", "tavern").state), /tavern/);
  const both = applyAuto(EMPTY_AMBIENCE, { bed: "cave", music: "dread" }).state;
  assert.match(describeAmbience(both), /cave.*music/);
});

console.log(`ambience: ${passed} tests passed`);
