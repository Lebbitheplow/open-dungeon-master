// What a person is told when a Workshop journey does not go to plan
// (docs/workshop-creator-import-audit-2026-10-22.md F03, F06, F07, F08 and
// the defects of the same family found with them), without a server:
//
//   - the campaign creator's prep import, house rules and lore answer with
//     what failed (a refusal and a dropped connection alike), never with
//     nothing, and the creator keeps the campaign it made;
//   - a bundle's preview names what leans on its monsters and Homebrew by
//     name, so leaving them behind is said before the button;
//   - a sheet's references are renamed everywhere one name is held;
//   - the builder says why a subclass is missing at a table;
//   - the Ruleset Library no longer offers ticks that did nothing.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./lib/register-alias.mjs", import.meta.url);

const { submitContentImport, postContentImport } = await import("../src/app/workshop/ContentImportPicker.tsx");
const { submitWorldSetup, worldSetupProblems } = await import("../src/app/WorldSetupFields.tsx");
const { bundleDependencies } = await import("../src/lib/workshop/bundle.ts");
const { renameSheetRefs, renamerOf, sheetRefNames } = await import("../src/lib/homebrew/sheet-refs.ts");
const { homebrewDataRefs, renameHomebrewDataRefs } = await import("../src/lib/homebrew/data-refs.ts");
const { homebrewAvailability } = await import("../src/lib/homebrew/availability.ts");
const { TableScopeNote } = await import("../src/app/characters/builder/TableScopeNote.tsx");

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`FAILED ${name}`);
    throw error;
  }
}

const realFetch = globalThis.fetch;
function answering(handler) {
  globalThis.fetch = async (url, init) => handler(String(url), init ?? {});
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const selection = { sourceId: "workshop-1", select: ["maps", "npcs"], houseRules: "replace", again: "skip", arc: "leave" };

// ---- F03 ----

await test("F03: an import the server refuses, or cannot be reached for, is a failure with words", async () => {
  answering(() => json(400, { error: "That source is not yours to copy." }));
  assert.deepEqual(await submitContentImport("c1", selection), { ok: false, error: "That source is not yours to copy." });
  answering(() => json(500, {}));
  const crashed = await submitContentImport("c1", selection);
  assert.equal(crashed.ok, false);
  assert.match(crashed.error, /refused/);
  answering(() => {
    throw new TypeError("Failed to fetch");
  });
  assert.deepEqual(await submitContentImport("c1", selection), { ok: false, error: "Could not reach the server." });
});

await test("F03: a successful import says what it brought; nothing chosen asks nothing", async () => {
  answering(() => json(200, { copied: 3, kept: 1, referenceNotes: ["Loot: its row for the table Gems names nothing here."], spellsBrought: ["Rot Bolt"] }));
  const outcome = await postContentImport("c1", selection);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.copied, 3);
  assert.match(outcome.note, /Brought 3 items across\. Kept 1 already here\./);
  assert.match(outcome.note, /Loot: its row/);
  let asked = false;
  answering(() => {
    asked = true;
    return json(200, {});
  });
  assert.equal(await submitContentImport("c1", { ...selection, select: [] }), null);
  assert.equal(asked, false);
});

await test("F03 family: house rules and lore that did not save are returned, and said", async () => {
  answering((url) => (url.endsWith("/rules") ? json(500, {}) : url.endsWith("/lore") ? json(201, {}) : json(404, {})));
  const drafts = [
    { category: "history", title: "The Fall", body: "It fell." },
    { category: "magic", title: "", body: "Untitled drafts are not sent." },
  ];
  const left = await submitWorldSetup("c1", "No flanking.", drafts);
  assert.equal(left.houseRules, "No flanking.");
  assert.deepEqual(left.loreDrafts, []);
  assert.deepEqual(worldSetupProblems(left), ["The house rules did not save."]);
  let failLore = true;
  answering((url) => (url.endsWith("/lore") && failLore ? Promise.reject(new TypeError("offline")) : json(200, {})));
  const again = await submitWorldSetup("c1", "", drafts);
  assert.deepEqual(again.loreDrafts.map((draft) => draft.title), ["The Fall"]);
  assert.deepEqual(worldSetupProblems(again), ['The lore entry "The Fall" did not save.']);
  failLore = false;
  assert.deepEqual(worldSetupProblems(await submitWorldSetup("c1", again.houseRules, again.loreDrafts)), []);
});

await test("F03: the creator keeps the campaign it made and sends only what failed", () => {
  const dialog = fs.readFileSync(new URL("../src/app/CreateCampaignDialog.tsx", import.meta.url), "utf8");
  // Made once: a campaign this dialog made is not made again.
  assert.match(dialog, /let campaignId = followUp\?\.campaignId \?\? null;/);
  assert.match(dialog, /if \(!campaignId\) \{\s+const response = await fetch\("\/api\/campaigns"/);
  // Not finished while something failed.
  assert.match(dialog, /if \(problems\.length\) \{\s+setFollowUp\(/);
  const review = fs.readFileSync(new URL("../src/app/create-campaign/ReviewStep.tsx", import.meta.url), "utf8");
  assert.match(review, /role="alert"/);
  assert.match(review, /Open the campaign as it is/);
});

globalThis.fetch = realFetch;

// ---- bundle preview: what leans on the shelf by name ----

await test("A bundle's pregens, Cast, fights, tables and shops that name its monsters and Homebrew are counted", () => {
  const bundle = {
    monsters: [{ name: "Bog Hound" }],
    homebrew: [
      { kind: "archetype", name: "Marsh Knight", data: {} },
      { kind: "item", name: "Reed Charm", data: {} },
      { kind: "race", name: "Sand Elf", data: {} },
    ],
    pregens: [
      { sheet: { class: "fighter", subclass: "Marsh Knight", race: "human", background: "", equipment: [] } },
      { sheet: { class: "wizard", subclass: "", race: "homebrew:@race:Sand Elf", background: "", equipment: [] } },
      { sheet: { class: "rogue", subclass: "", race: "human", background: "", equipment: [] } },
    ],
    npcs: [{ statBlock: "Bog Hound" }, { statBlock: "goblin" }],
    encounters: [{ enemies: [{ monster: "Bog Hound", count: 2 }], map: { map: null } }],
    tables: [{ entries: [{ ref: { kind: "item", name: "Reed Charm" } }, { ref: { kind: "monster", name: "Bog Hound" } }] }],
    shops: [{ stock: [{ itemName: "Reed Charm" }], preparedStock: null, location: null, keeper: null }],
    locations: [],
    maps: [],
    storyboard: [],
    overworld: null,
  };
  const deps = Object.fromEntries(bundleDependencies(bundle).map((dep) => [`${dep.from}>${dep.to}`, dep.count]));
  assert.equal(deps["pregens>homebrew"], 2);
  assert.equal(deps["npcs>monsters"], 1);
  assert.equal(deps["encounters>monsters"], 1);
  assert.equal(deps["tables>monsters"], 1);
  assert.equal(deps["tables>homebrew"], 1);
  assert.equal(deps["shops>homebrew"], 1);
});

// ---- the sheet's references, in one list ----

await test("Every place a sheet holds a subclass, spell, feat or item name is read and renamed", () => {
  const sheet = {
    class: "fighter",
    subclass: "Bog Knight",
    classes: [
      { id: "fighter", level: 3, subclass: "Bog Knight" },
      { id: "wizard", level: 2, subclass: "Bog Knight" },
    ],
    feats: ["Gloam Born"],
    asiChoices: [{ mode: "feat", feat: "Gloam Born" }],
    featChoices: { "gloam born": { spells: ["Dusk Dart"] } },
    features: [{ name: "Gloam Born", source: "feat" }, { name: "Second Wind", source: "class" }],
    racialChoices: { cantrip: "Dusk Dart" },
    equipment: [{ name: "Gloam Lantern", qty: 1 }, { name: "Gloam Lantern", qty: 1, identified: false }, { name: "Scroll", spell: "Dusk Dart" }],
    spellcasting: { prepared: ["Dusk Dart"], known: [], cantrips: [], spellbook: ["Dusk Dart", "Shield"], casters: [{ classId: "wizard", prepared: ["Dusk Dart"], known: [], cantrips: [] }] },
    concentratingOn: "Dusk Dart",
  };
  const names = sheetRefNames(sheet);
  assert.deepEqual(names.spell, ["Dusk Dart", "Shield"]);
  assert.deepEqual(names.item, ["Gloam Lantern", "Scroll"]);
  const out = renameSheetRefs(
    sheet,
    renamerOf([
      { kind: "archetype", from: "Bog Knight", to: "Fen Knight", classId: "fighter" },
      { kind: "spell", from: "Dusk Dart", to: "Night Dart" },
      { kind: "feat", from: "Gloam Born", to: "Dusk Born" },
      { kind: "item", from: "Gloam Lantern", to: "Dusk Lantern" },
    ]),
  );
  assert.equal(out.changed, true);
  const next = out.sheet;
  assert.equal(next.subclass, "Fen Knight");
  // Only the fighter's: a wizard's subclass of that name is another one.
  assert.deepEqual(next.classes.map((entry) => entry.subclass), ["Fen Knight", "Bog Knight"]);
  assert.deepEqual(next.spellcasting.prepared, ["Night Dart"]);
  assert.deepEqual(next.spellcasting.spellbook, ["Night Dart", "Shield"]);
  assert.deepEqual(next.spellcasting.casters[0].prepared, ["Night Dart"]);
  assert.equal(next.concentratingOn, "Night Dart");
  assert.equal(next.racialChoices.cantrip, "Night Dart");
  assert.deepEqual(next.feats, ["Dusk Born"]);
  assert.equal(next.asiChoices[0].feat, "Dusk Born");
  assert.deepEqual(Object.keys(next.featChoices), ["dusk born"]);
  assert.deepEqual(next.featChoices["dusk born"].spells, ["Night Dart"]);
  assert.equal(next.features[0].name, "Dusk Born");
  assert.equal(next.equipment[0].name, "Dusk Lantern");
  // The party's mystery stays a mystery.
  assert.equal(next.equipment[1].name, "Gloam Lantern");
  assert.equal(next.equipment[2].spell, "Night Dart");
  // Nothing renamed, nothing copied.
  assert.equal(renameSheetRefs(sheet, (kind, name) => name).sheet, sheet);
});

await test("An entry's own references are read and renamed: a subclass's spells, an item's, a background's kit", () => {
  assert.deepEqual(homebrewDataRefs("archetype", { spells: { 3: ["Dusk Dart"], 5: ["Dusk Dart", "Shield"] } }).spell, ["Dusk Dart", "Shield"]);
  assert.deepEqual(homebrewDataRefs("item", { spells: [{ spell: "Dusk Dart", charges: 1, level: 1 }] }).spell, ["Dusk Dart"]);
  assert.deepEqual(homebrewDataRefs("background", { grants: { equipment: ["Gloam Lantern", "Rope"] } }).item, ["Gloam Lantern", "Rope"]);
  const rename = renamerOf([{ kind: "spell", from: "Dusk Dart", to: "Night Dart" }, { kind: "item", from: "Gloam Lantern", to: "Dusk Lantern" }]);
  assert.deepEqual(renameHomebrewDataRefs("archetype", { spells: { 3: ["Dusk Dart"] } }, rename).data.spells, { 3: ["Night Dart"] });
  assert.deepEqual(renameHomebrewDataRefs("background", { grants: { equipment: ["Gloam Lantern"] } }, rename).data.grants.equipment, ["Dusk Lantern"]);
});

// ---- F06 ----

await test("F06: the editor says where a kept entry is offered, a subclass with its class and level", () => {
  const subclass = homebrewAvailability("archetype", { name: "Fighter", subclassLevel: 3 });
  assert.match(subclass, /under Fighter in the character builder from level 3/);
  assert.match(subclass, /owner, DM or assistant DM/);
  assert.match(subclass, /once that table's owner or DM keeps a copy/);
  assert.match(homebrewAvailability("spell"), /spell lists of the classes it names/);
});

await test("F06: the builder says why a subclass is missing: left out at this table, or not loaded", () => {
  const excluded = renderToStaticMarkup(createElement(TableScopeNote, { noun: "subclasses", unadmitted: ["Player Marsh Knight"] }));
  assert.match(excluded, /Your own Player Marsh Knight is not offered at this table/);
  assert.match(excluded, /owner, the DM or the assistant DM/);
  const failed = renderToStaticMarkup(createElement(TableScopeNote, { noun: "subclasses", unadmitted: [], failed: true, onRetry: () => {} }));
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Could not load your subclasses/);
  assert.match(failed, /min-h-10/, "the retry is a finger-sized target");
  assert.equal(renderToStaticMarkup(createElement(TableScopeNote, { noun: "subclasses", unadmitted: [] })), "");
});

// ---- F08 ----

await test("F08: the Ruleset Library no longer offers Homebrew ticks, and says what a ruleset carries", () => {
  const library = fs.readFileSync(new URL("../src/app/workshop/RulesetLibrary.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(library, /Homebrew this ruleset ships/);
  assert.doesNotMatch(library, /toggleHomebrew/);
  assert.match(library, /A ruleset carries variant rules and house rules, not Homebrew/);
});

console.log(`workshop import feedback: ${passed} checks passed.`);
