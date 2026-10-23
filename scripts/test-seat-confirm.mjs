// The hero chooser and the confirm sheet before a hero takes its seat
// (backlog F5 and F6). The chooser sorts the player's library into their own
// heroes and an adventure's pregens (src/app/campaigns/[campaignId]/
// hero-chooser.ts). The confirm sheet asks POST /sheet/preview, which runs
// the code the join runs (src/lib/characters/seat-preview.ts) and stores
// nothing: what it promises, the join does, and Cancel changes nothing.
import assert from "node:assert/strict";
import fs from "node:fs";
import { suite } from "./lib/enforce-harness.mjs";
import { LEGAL_FIGHTER, PORTRAIT, openCreation } from "./lib/enforce-creation.mjs";

const { test, finish } = suite("test-seat-confirm");
const campaigns = await import("../src/lib/db/campaigns.ts");
const { joinChanges } = await import("../src/lib/characters/join-changes.ts");
const { chooserSections } = await import("../src/app/campaigns/[campaignId]/hero-chooser.ts");
const { owedChoices } = await import("../src/lib/srd/owed-choices.ts");
// Windows CI checks the files out with CRLF line endings.
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// ---- the words, pure ----

await test("a hero going up says so and lists what the level owes", () => {
  const { changes, owed } = joinChanges(LEGAL_FIGHTER, 1, { ...LEGAL_FIGHTER, maxHp: 36, features: [...LEGAL_FIGHTER.features, { name: "ASI taken: 0", source: "story" }] }, 4);
  assert.equal(changes[0], "Goes up from level 1 to 4 for this table.");
  assert.ok(changes.includes("Hit points: 12 becomes 36."), changes.join(" | "));
  assert.ok(owed.some((line) => /subclass for fighter/.test(line)), owed.join(" | "));
});

await test("a hero at its own level changes nothing but says where it plays", () => {
  const { changes } = joinChanges(LEGAL_FIGHTER, 1, LEGAL_FIGHTER, 1);
  assert.deepEqual(changes, ["Plays at its own level, 1."]);
});

await test("a hero going down names the improvements, feats and spells it gives back", () => {
  const stored = {
    ...LEGAL_FIGHTER,
    class: "wizard",
    maxHp: 30,
    feats: ["Alert"],
    asiChoices: [{ mode: "feat", feat: "Alert" }],
    spellcasting: {
      ability: "int",
      slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
      prepared: ["Shield", "Fireball"],
      known: [],
      cantrips: ["Light"],
    },
  };
  const seated = {
    ...stored,
    maxHp: 8,
    feats: [],
    asiChoices: [],
    spellcasting: { ...stored.spellcasting, slots: { 1: { max: 2, used: 0 } }, prepared: ["Shield"] },
  };
  const { changes } = joinChanges(stored, 5, seated, 1);
  assert.equal(changes[0], "Plays at level 1 here, down from 5.");
  assert.ok(changes.includes("Gives back 1 Ability Score Improvement this level has not earned, with Alert."), changes.join(" | "));
  assert.ok(changes.includes("Gives back 1 spell this level cannot hold: Fireball."), changes.join(" | "));
  assert.ok(changes.includes("Spell slots: 2 × 1st."), changes.join(" | "));
});

// ---- the chooser's order ----

await test("the chooser lists the player's own heroes, then an adventure's pregens, never an ally", () => {
  const sections = chooserSections([
    { id: "a", workshopId: "" },
    { id: "b", workshopId: "w1" },
    { id: "c", role: "companion" },
    { id: "d" },
  ]);
  assert.deepEqual(sections.own.map((entry) => entry.id), ["a", "d"]);
  assert.deepEqual(sections.pregens.map((entry) => entry.id), ["b"]);
});

await test("the join page opens on the chooser, and every pick goes through the confirm sheet", () => {
  const page = read("src/app/campaigns/[campaignId]/character/page.tsx");
  assert.match(page, /<HeroChooser/);
  assert.doesNotMatch(page, /pickFromLibrary/, "a library hero is seated in one tap again");
  const chooser = read("src/app/campaigns/[campaignId]/HeroChooser.tsx");
  const order = ["data-chooser-section=\"library\"", "data-chooser-section=\"pregens\"", "<PregenPicker", "data-chooser-section=\"help\"", "data-chooser-section=\"build\""];
  const at = order.map((marker) => chooser.indexOf(marker));
  assert.ok(at.every((index) => index >= 0), `missing: ${order.filter((_, i) => at[i] < 0).join(", ")}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, "the chooser's sections are out of order");
  const picker = read("src/app/campaigns/[campaignId]/PregenPicker.tsx");
  assert.match(picker, /<JoinConfirmDialog/);
  assert.doesNotMatch(picker, /sheet\/pregen/, "the picker seats a hero without the confirm sheet");
});

await test("Help me build opens the quiz at the table's level, and its hero goes through the confirm sheet", () => {
  const chooser = read("src/app/campaigns/[campaignId]/HeroChooser.tsx");
  assert.match(chooser, /onClick=\{onHelpMeBuild\}[\s\S]*Help me build/);
  const page = read("src/app/campaigns/[campaignId]/character/page.tsx");
  // The chooser's door opens the builder on its own quiz (no second engine).
  assert.match(page, /onHelpMeBuild=\{\(\) => \{\s*setHelped\(true\);\s*setMode\("create"\);/);
  assert.match(page, /openQuiz=\{helped\}/);
  assert.match(page, /fixedLevel=\{level\}/, "the builder is not held to the table's level");
  assert.doesNotMatch(page, /QuickBuildQuiz|suggestBuilds/, "the page forks the quiz instead of opening the builder's");
  // What the quiz builds is held for the confirm sheet, not posted straight.
  const submit = page.slice(page.indexOf("function submitNew"), page.indexOf("if (level === null)"));
  assert.match(submit, /if \(helped && flow !== "edit"\) \{\s*setBuilt\(\{ kind: "built"[^}]*sheet: result\.sheet \}\);\s*return;/);
  assert.match(page, /<JoinConfirmDialog[\s\S]*hero=\{built\}[\s\S]*onSeated=\{seated\}/);
  const builder = read("src/app/characters/builder/CharacterBuilder.tsx");
  assert.match(builder, /useState<\{ role: PlaystyleId \| null \} \| null>\(openQuiz \? \{ role: null \} : null\)/);
  // The sheet previews it and seats it through the table's own door.
  const dialog = read("src/app/campaigns/[campaignId]/JoinConfirmDialog.tsx");
  assert.match(dialog, /hero\.kind === "built"\) return \{ sheet: hero\.sheet, flow \}/);
  assert.match(dialog, /JSON\.stringify\(hero\.kind === "built" \? hero\.sheet : \{ libraryCharacterId: hero\.id \}\)/);
});

// ---- the preview route against the join ----

async function previewAs(table, body) {
  table.world.signIn(table.player);
  const route = await table.world.route("campaigns/[campaignId]/sheet/preview");
  return table.call(route, "POST", body, { campaignId: table.campaignId });
}

async function libraryHero(table, sheet = LEGAL_FIGHTER, level = 1) {
  table.world.signIn(table.player);
  const made = await table.call(table.libraryRoute, "POST", { level, sheet });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return made.json.character;
}

await test("a library hero previewed at a level 4 table: the changes, a pass, the owed choices, and nothing stored", async () => {
  const table = await openCreation({ campaign: { startingLevel: 4 } });
  const character = await libraryHero(table);
  const { status, json } = await previewAs(table, { libraryCharacterId: character.id });
  assert.equal(status, 200, JSON.stringify(json));
  const { preview } = json;
  assert.equal(preview.ok, true, preview.problems.join(" | "));
  assert.equal(preview.fromLevel, 1);
  assert.equal(preview.toLevel, 4);
  assert.equal(preview.changes[0], "Goes up from level 1 to 4 for this table.");
  assert.equal(table.sheets.getSheetForUser(table.campaignId, table.player.id), null, "the preview seated the hero");

  // The join does what the sheet said.
  const joined = await table.call(table.sheetRoute, "POST", { libraryCharacterId: character.id }, { campaignId: table.campaignId });
  assert.equal(joined.status, 201, JSON.stringify(joined.json));
  const seated = table.sheets.getSheetForUser(table.campaignId, table.player.id);
  assert.deepEqual(owedChoices(seated), preview.owed);
  assert.ok(preview.owed.some((line) => /Ability Score Improvement/.test(line)), preview.owed.join(" | "));
  assert.ok(preview.owed.some((line) => /subclass for fighter/.test(line)), preview.owed.join(" | "));
  assert.ok(preview.changes.includes(`Hit points: 12 becomes ${seated.maxHp}.`), preview.changes.join(" | "));

  // Picking the seated hero again is a reselect, not a refusal.
  const again = await previewAs(table, { libraryCharacterId: character.id });
  assert.equal(again.json.preview.ok, true);
  assert.equal(again.json.preview.alreadyHere, true);
  table.world.close();
});

await test("a ready-made hero previewed at a level 4 table owes what its seat then lists", async () => {
  const table = await openCreation({ campaign: { startingLevel: 4 } });
  const { json } = await previewAs(table, { pregenId: "kara" });
  assert.equal(json.preview.ok, true, json.preview.problems.join(" | "));
  assert.equal(json.preview.fromLevel, 1);
  assert.equal(table.sheets.getSheetForUser(table.campaignId, table.player.id), null, "the preview seated the hero");
  const route = await table.world.route("campaigns/[campaignId]/sheet/pregen");
  const seatedResponse = await table.call(route, "POST", { id: "kara" }, { campaignId: table.campaignId });
  assert.equal(seatedResponse.status, 201, JSON.stringify(seatedResponse.json));
  const seated = table.sheets.getSheetForUser(table.campaignId, table.player.id);
  assert.deepEqual(owedChoices(seated), json.preview.owed);
  assert.ok(json.preview.owed.some((line) => /2 Ability Score Improvements|1 Ability Score Improvement/.test(line)), json.preview.owed.join(" | "));
  table.world.close();
});

await test("the door rules show before the seat is offered: a second hero, a switch after the lobby", async () => {
  const table = await openCreation({ campaign: { startingLevel: 1 } });
  const first = await libraryHero(table);
  const second = await libraryHero(table, { ...LEGAL_FIGHTER, name: "Dunmore" });
  await table.call(table.sheetRoute, "POST", { libraryCharacterId: first.id }, { campaignId: table.campaignId });

  const join = await previewAs(table, { libraryCharacterId: second.id });
  assert.equal(join.json.preview.ok, false);
  assert.match(join.json.preview.problems[0], /already have a character/);

  const swap = await previewAs(table, { libraryCharacterId: second.id, flow: "replace" });
  assert.equal(swap.json.preview.ok, true, swap.json.preview.problems.join(" | "));

  campaigns.setCampaignStatus(table.campaignId, "active");
  const late = await previewAs(table, { libraryCharacterId: second.id, flow: "replace" });
  assert.equal(late.json.preview.ok, false);
  assert.match(late.json.preview.problems[0], /only be changed in the lobby/);
  table.world.close();
});

await test("a hero the quiz built is previewed by the table's door, stored by nothing, then seated as previewed", async () => {
  const table = await openCreation({ campaign: { startingLevel: 1 } });
  const sheet = { ...LEGAL_FIGHTER, portrait: PORTRAIT };
  const libraryBefore = table.characters.listCharactersForUser(table.player.id).length;
  const { status, json } = await previewAs(table, { sheet });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.preview.ok, true, json.preview.problems.join(" | "));
  assert.equal(json.preview.name, sheet.name);
  assert.equal(json.preview.toLevel, 1);
  assert.equal(json.preview.alreadyHere, false);
  assert.equal(table.sheets.getSheetForUser(table.campaignId, table.player.id), null, "the preview seated the hero");
  assert.equal(table.characters.listCharactersForUser(table.player.id).length, libraryBefore, "the preview stored the hero");

  // Take the seat: the same sheet through POST /sheet, the builder's own door.
  const joined = await table.call(table.sheetRoute, "POST", sheet, { campaignId: table.campaignId });
  assert.equal(joined.status, 201, JSON.stringify(joined.json));
  assert.equal(table.sheets.getSheetForUser(table.campaignId, table.player.id)?.name, sheet.name);

  // A sheet the table's rules refuse is refused on the confirm sheet first.
  const broken = await previewAs(table, { sheet: { ...sheet, abilities: { ...sheet.abilities, str: 30 } }, flow: "replace" });
  assert.equal(broken.status, 200, JSON.stringify(broken.json));
  assert.equal(broken.json.preview.ok, false);
  assert.ok(broken.json.preview.problems.length > 0);

  // One hero at a time.
  const both = await previewAs(table, { sheet, pregenId: "kara" });
  assert.equal(both.status, 400);
  table.world.close();
});

await test("an ally the DM plays, a stranger's hero and an unknown starter are refused", async () => {
  const table = await openCreation({ campaign: { startingLevel: 1 } });
  table.world.signIn(table.player);
  const ally = await table.call(table.libraryRoute, "POST", { level: 1, role: "companion", sheet: { ...LEGAL_FIGHTER, name: "Pip" } });
  assert.equal(ally.status, 201, JSON.stringify(ally.json));
  const allyPreview = await previewAs(table, { libraryCharacterId: ally.json.character.id });
  assert.equal(allyPreview.status, 400);
  assert.match(allyPreview.json.error, /ally the DM plays/);

  const stranger = table.world.addUser("stranger");
  table.world.signIn(stranger);
  const theirs = await table.call(table.libraryRoute, "POST", { level: 1, sheet: { ...LEGAL_FIGHTER, name: "Theirs" } });
  const stolen = await previewAs(table, { libraryCharacterId: theirs.json.character.id });
  assert.equal(stolen.status, 404);

  const nobody = await previewAs(table, { pregenId: "nobody" });
  assert.equal(nobody.status, 404);
  const both = await previewAs(table, { pregenId: "kara", libraryCharacterId: "x" });
  assert.equal(both.status, 400);
  table.world.close();
});

finish();
