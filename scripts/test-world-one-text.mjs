// One account per entry. Audit finding WF-13: an imported long lore entry
// kept its text twice, a cut copy in the lore row and the whole as a
// WorldForge article, and every reader took the article first, so an edit
// to the row never showed. Now a lore entry's body is its one account, a
// place's arrival text and its article each keep their own job, a file
// carries both texts rather than guessing one from the other, and the
// entries already holding two texts become one where nothing is lost.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-one-text");
const { importWorldForge, exportWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { worldView, createWorldEntity, updateWorldEntity, getWorldDoc, saveWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { updateLoreEntry, getLoreEntry } = await import("../src/lib/db/lore.ts");
const { setLocationLayout } = await import("../src/lib/db/locations.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { backfillWorldTexts, getDatabase } = await import("../src/lib/db/core.ts");
const { accountOf, olderText, leadOf, settleLoreTexts, ROW_TEXT } = await import("../src/lib/worldforge/account.ts");
const { LORE_BODY_MAX } = await import("../src/lib/dm/world-lore-logic.ts");

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8"));
const world = await openWorld();
const owner = { id: world.owner.id };
const shop = (title) => createWorkshop(owner.id, { title }).id;
const named = (id, name) => worldView(id).entities.find((entity) => entity.name === name);
const sentences = (count, word) => Array.from({ length: count }, (_, index) => `${word} sentence number ${index + 1} of the account.`).join(" ");

// A file with one long lore entry and one long place.
function longFile() {
  const file = structuredClone(fixture);
  file.types.push({ id: "t_deity", name: "Deity", fields: [] });
  file.entities.push(
    { id: "e_tidemother", name: "The Tidemother", type: "Deity", summary: sentences(120, "Lore"), canon: "canon" },
    { id: "e_harbour", name: "The Old Harbour", type: "Location", summary: sentences(70, "Place"), canon: "canon" },
  );
  return file;
}

await test("The row limits are the rows' own.", () => {
  assert.equal(ROW_TEXT.lore, LORE_BODY_MAX);
});

await test("The audit's case: a long imported lore entry keeps its whole text in its body, so an edit to the body shows.", () => {
  const id = shop("Long lore");
  importWorldForge(id, owner, longFile());
  const lore = named(id, "The Tidemother");
  assert.equal(lore.text, sentences(120, "Lore"), "the body holds a cut copy");
  assert.equal(lore.entry.article, "", "the article keeps a second copy");
  updateLoreEntry(lore.id, { body: "Edited in the lore panel." });
  const after = named(id, "The Tidemother");
  assert.equal(accountOf(after), "Edited in the lore panel.", "the wiki, the DM and search would still read the old text");
  assert.equal(exportWorldForge(id).entities.find((entity) => entity.name === "The Tidemother").summary, "Edited in the lore panel.");
});

await test("A long place keeps its whole account as its article, and an arrival text that ends on a sentence.", () => {
  const id = shop("Long place");
  importWorldForge(id, owner, longFile());
  const place = named(id, "The Old Harbour");
  assert.equal(place.entry.article, sentences(70, "Place"));
  assert.ok(place.text.length <= ROW_TEXT.location);
  assert.match(place.text, /account\.$/, "the arrival text stops mid-sentence");
  setLocationLayout(place.id, "Gulls, tar and a broken crane.");
  const after = named(id, "The Old Harbour");
  assert.equal(after.text, "Gulls, tar and a broken crane.");
  assert.equal(accountOf(after), sentences(70, "Place"), "the place's account is its article");
});

await test("A file carries both texts of a Cast member and a place, so neither is guessed from the other.", () => {
  const from = shop("Two texts out");
  const ivo = createWorldEntity(from, { typeId: "t_character", name: "Ivo Rell", tagline: "Keeps the wall.", article: "Ivo has kept the sea wall for thirty years. He sold its codes." });
  const gate = createWorldEntity(from, { typeId: "t_location", name: "The Sluice Gate", text: "Iron and weed.", article: "A gate older than the town, opened twice a day." });
  assert.ok(ivo.entity && gate.entity);
  const into = shop("Two texts in");
  importWorldForge(into, owner, exportWorldForge(from));
  assert.equal(named(into, "Ivo Rell").tagline, "Keeps the wall.");
  assert.equal(named(into, "Ivo Rell").entry.article, "Ivo has kept the sea wall for thirty years. He sold its codes.");
  assert.equal(named(into, "The Sluice Gate").text, "Iron and weed.");
  assert.equal(named(into, "The Sluice Gate").entry.article, "A gate older than the town, opened twice a day.");
});

await test("An article sent for a lore entry, with no body beside it, is written as the body.", () => {
  const id = shop("One lore text");
  const made = createWorldEntity(id, { typeId: "t_other", name: "The Drowned Bell", article: "It rings at low tide." });
  assert.equal(made.entity.text, "It rings at low tide.");
  assert.equal(made.entity.entry.article, "");
  const later = updateWorldEntity(id, made.entity.ref, { article: "It rang once, in the flood." });
  assert.equal(later.entity.text, "It rang once, in the flood.");
  assert.equal(getLoreEntry(made.entity.id).body, "It rang once, in the flood.");
});

await test("The startup fix makes one text where one holds the other, and keeps both where they differ.", () => {
  const id = shop("Two texts already");
  const cut = createWorldEntity(id, { typeId: "t_other", name: "The Cut Copy" });
  const apart = createWorldEntity(id, { typeId: "t_other", name: "Two Accounts" });
  const whole = sentences(150, "Whole");
  updateLoreEntry(cut.entity.id, { body: whole.slice(0, 4_000) });
  updateLoreEntry(apart.entity.id, { body: "What the lore panel says now." });
  // As an import before this change left them.
  const doc = getWorldDoc(id);
  doc.entries[cut.entity.ref].article = whole;
  doc.entries[apart.entity.ref].article = "What the import said.";
  saveWorldDoc(id, doc);
  assert.ok(backfillWorldTexts(getDatabase()) >= 1);
  assert.equal(getLoreEntry(cut.entity.id).body, whole, "the whole text did not become the body");
  assert.equal(getWorldDoc(id).entries[cut.entity.ref].article, "");
  const both = named(id, "Two Accounts");
  assert.equal(both.text, "What the lore panel says now.");
  assert.equal(both.entry.article, "What the import said.", "a text that says something else was dropped");
  assert.equal(accountOf(both), "What the lore panel says now.");
  assert.equal(olderText(both), "What the import said.");
  // Both travel through a file, so a round trip keeps the author's choice open.
  const into = shop("Two texts carried");
  importWorldForge(into, owner, exportWorldForge(id));
  assert.equal(olderText(named(into, "Two Accounts")), "What the import said.");
});

await test("The lead of a long text ends on a sentence, and never mid-word.", () => {
  assert.equal(leadOf("Short.", 100), "Short.");
  assert.equal(leadOf("One. Two three four five six.", 12), "One. Two…", "a sentence end too early is passed over for the last whole word");
  const lead = leadOf(sentences(10, "Lead"), 200);
  assert.ok(lead.length <= 200 && lead.endsWith("account."));
  const words = leadOf("word ".repeat(100), 50);
  assert.ok(words.length <= 50 && words.endsWith("word…"));
  assert.equal(settleLoreTexts("Same.", "Same.", 100)?.body, "Same.");
  assert.equal(settleLoreTexts("Cut", "Cut short", 5), null, "a whole text over the limit was cut to fit");
});

world.close();
finish();
