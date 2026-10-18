// The Story AI panel's typed settings follow what is saved until someone
// types into them (src/app/campaigns/[campaignId]/settingDrafts.ts).
//
// With the panel open in one window and the art style made Custom in
// another, the custom fields here kept the empty text they opened with, and
// focusing and leaving one saved that emptiness over the other window's
// "grainy film photograph". An untouched field now follows the saved value
// and is never saved; a field typed into keeps its words until committed,
// whatever arrives for it or for its neighbour meanwhile. The two-window
// check in a real browser is scripts/browser/scenarios/45-story-settings-drafts.mjs.
import assert from "node:assert/strict";

const { commitValue, draftsFrom, editDraft, followSaved, inStep } = await import(
  "../src/app/campaigns/[campaignId]/settingDrafts.ts"
);

// What the panel does on each render: follow the saved values when they move.
const render = (state, saved) => (inStep(state, saved) ? state : followSaved(state, saved));

const opened = { artStyleMap: "", artStyleScene: "" };
const elsewhere = { artStyleMap: "realistic terrain", artStyleScene: "grainy film photograph" };

// Another window saves both: the untouched fields show them, and leaving
// them saves nothing.
let state = render(draftsFrom(opened), elsewhere);
assert.deepEqual(state.drafts, elsewhere, "untouched fields follow a change saved elsewhere");
assert.equal(commitValue(state, elsewhere, "artStyleScene"), null, "leaving an untouched field saves nothing");
assert.equal(commitValue(state, elsewhere, "artStyleMap"), null);

// Even before the change has been followed, an untouched field is not saved.
const stale = draftsFrom(opened);
assert.equal(commitValue(stale, elsewhere, "artStyleScene"), null, "a field still showing the old value is never written back");

// Typing into one field, then the other changes elsewhere: the typed words
// stay, the other field follows, and committing saves the typed words.
state = editDraft(state, "artStyleMap", "ink wash ");
const sceneMoved = { ...elsewhere, artStyleScene: "oil on canvas" };
state = render(state, sceneMoved);
assert.equal(state.drafts.artStyleMap, "ink wash ", "words not saved yet are kept");
assert.equal(state.drafts.artStyleScene, "oil on canvas", "the neighbour follows on its own");
assert.equal(commitValue(state, sceneMoved, "artStyleMap"), "ink wash", "the typed words are saved, trimmed");
assert.equal(commitValue(state, sceneMoved, "artStyleScene"), null);

// The player's own commit coming back puts the field in step again, so the
// next change elsewhere shows.
const ownSave = { ...sceneMoved, artStyleMap: "ink wash" };
state = render(state, ownSave);
assert.equal(state.drafts.artStyleMap, "ink wash");
assert.equal(commitValue(state, ownSave, "artStyleMap"), null, "nothing left to save");
const later = { ...ownSave, artStyleMap: "chalk lines" };
state = render(state, later);
assert.equal(state.drafts.artStyleMap, "chalk lines", "a committed field follows again");

// The same field changed elsewhere while typed into: the typed words stay
// and win when committed, the last change made on purpose.
state = editDraft(state, "artStyleScene", "watercolour");
const clash = { ...later, artStyleScene: "pencil" };
state = render(state, clash);
assert.equal(state.drafts.artStyleScene, "watercolour");
assert.equal(commitValue(state, clash, "artStyleScene"), "watercolour");

// Typed back to exactly what is saved: nothing to send.
state = editDraft(render(draftsFrom(opened), elsewhere), "artStyleMap", "realistic terrain");
assert.equal(commitValue(state, elsewhere, "artStyleMap"), null);

// Cleared on purpose: an empty field the player emptied is saved as empty.
state = editDraft(render(draftsFrom(opened), elsewhere), "artStyleScene", "");
assert.equal(commitValue(state, elsewhere, "artStyleScene"), "", "clearing a field is a change");

console.log("ok: typed settings follow what is saved until typed into, and only typed words are saved");
