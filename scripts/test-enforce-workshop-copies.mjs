// A workshop copy of a published spell plays the way the original does,
// under its own name (docs/workshop-rulebook-audit-pr169.md F01, F02, F10,
// F11, F12). Every copy is made the way the workshop makes one: the catalog
// row the content route serves, through draftFromCatalog, renamed and saved
// through the homebrew route. Then the copy is cast and the board, the
// sheets, the enemy rows and the purse are read, never the reply's words.
//
// The rules, from SRD 5.1:
//   - Web: a 20-foot cube of difficult terrain; a creature entering it makes
//     a DEX save or is restrained; fire burns the webs away. Concentration.
//   - Conjure Animals: eight beasts of challenge rating 1/4 from a 3rd level
//     slot, gone when concentration ends.
//   - Polymorph: a creature that fails its WIS save becomes the beast, with
//     the beast's hit points, until concentration ends.
//   - Revivify: a diamond worth 300 gp, which the spell consumes.
//   - An attack roll: a natural 1 misses, a natural 20 hits and is a critical
//     hit, whose damage dice are rolled twice (traps included).
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { call } from "./lib/enforce-campaign.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { hasPack, openWorld } from "./lib/enforce-world.mjs";
import { caster, closeTables, enemyOf, table } from "./lib/enforce-spell-kit.mjs";
import { cleric } from "./lib/enforce-spells.mjs";
import { board, stride, zonesOf } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-workshop-copies");
const { draftFromCatalog, draftFindings } = await import("../src/app/workshop/homebrew/draft.ts");
const { spellFactsFor, spellDamageFor } = await import("../src/lib/content/index.ts");
const { effectiveSpellPreview } = await import("../src/lib/workshop/spell-preview.ts");
const { BEAST_FORMS } = await import("../src/lib/srd/beast-forms.ts");
const { acWithEffects } = await import("../src/lib/dm/ac-effects.ts");

const BEAR = BEAST_FORMS.find((entry) => entry.name === "Brown Bear");

// The catalog row the workshop's "Start from" picker is handed for `name`:
// the content route with the mechanics, scoped to the table.
async function catalogRow(world, kind, name) {
  const route = await world.route("content/[kind]");
  world.signIn(world.owner);
  const query = new URLSearchParams({ q: name, mechanics: "1", limit: "20", campaign: world.campaignId });
  const out = await call(route, "GET", undefined, { kind }, `http://test/api/content/${kind}?${query}`);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const rows = out.json.results.filter((row) => row.name.toLowerCase() === name.toLowerCase() && row.source !== "homebrew");
  const row = rows.find((entry) => entry.documentSlug === "wotc-srd") ?? rows[0];
  assert.ok(row, `the catalog has no ${name} (${hasPack ? "pack" : "bundled"} rows)`);
  return row;
}

// "Start from" the published entry, renamed and kept.
async function copyOf(world, kind, published, name) {
  const draft = draftFromCatalog(kind === "spells" ? "spell" : "item", await catalogRow(world, kind, published));
  const route = await world.route("homebrew");
  world.signIn(world.owner);
  const out = await call(route, "POST", { kind: kind === "spells" ? "spell" : "item", name, data: draft.data });
  assert.equal(out.status, 201, JSON.stringify(out.json));
  return out.json.entry;
}

await test("F01: a renamed copy of Web lays the same web: the same squares, difficult terrain, a DEX save on entering, burnt away by fire, gone when concentration ends.", async () => {
  const original = await board([caster("wizard", "int", ["Web"])], { 0: { x: 2, y: 8 }, e0: { x: 18, y: 2 } });
  assert.equal((await original.world.invoke("use_spell_slot", { characterId: original.sheets[0].id, spell: "Web", level: 2, atX: 12, atY: 2 })).ok, true);
  const web = zonesOf(original.world).find((zone) => zone.spell === "Web");

  const { world, sheets: [wizard], enemies: [goblin] } = await board([caster("wizard", "int", ["Silkbind"])], { 0: { x: 2, y: 8 }, e0: { x: 18, y: 2 } });
  const entry = await copyOf(world, "spells", "Web", "Silkbind");
  assert.equal(entry.data.runsAs, "Web", "the copy does not know it runs as Web");
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Silkbind", level: 2, atX: 12, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  const silk = zonesOf(world).find((zone) => zone.spell === "Silkbind");
  assert.ok(silk, "Silkbind laid no area");
  assert.equal(silk.runsAs, "Web");
  assert.deepEqual([...silk.cells].sort((a, b) => a - b), [...web.cells].sort((a, b) => a - b), "the copy's web covers other squares");
  assert.equal(world.sheet(wizard.id).concentratingOn, "Silkbind");
  world.dice(1);
  const walked = await stride(world, goblin.id, 13, 2);
  world.clearDice();
  assert.equal(walked.ok, true, walked.error);
  assert.ok(enemyOf(world, goblin.id).conditions.includes("restrained"), "the copy's web did not hold the goblin");
  const burnt = await world.invoke("damage_enemy", { enemyId: goblin.id, amount: 3, type: "fire", source: "hazard" });
  assert.equal(burnt.ok, true, burnt.error);
  assert.ok(!enemyOf(world, goblin.id).conditions.includes("restrained"), "fire did not burn the copy's web away");
  world.dice(1);
  await world.invoke("apply_damage", { characterId: wizard.id, amount: 4, type: "slashing" });
  world.clearDice();
  assert.equal(world.sheet(wizard.id).concentratingOn, null);
  assert.ok(!zonesOf(world).some((zone) => zone.spell === "Silkbind"), "the web outlived the concentration that held it");
});

await test("F01: a renamed copy of Conjure Animals calls the same eight wolves, on the board and in the order, at the same cost, and they vanish when concentration ends.", async () => {
  const { world, sheets: [druid] } = await board([caster("druid", "wis", ["Call the Wild"], [], 5)], [{ x: 3, y: 4 }]);
  await copyOf(world, "spells", "Conjure Animals", "Call the Wild");
  const before = world.sheet(druid.id).spellcasting.slots["3"].used;
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Call the Wild", level: 3, variant: "wolf" });
  assert.equal(cast.ok, true, cast.error);
  const wolves = world.sheets().filter((sheet) => sheet.summon?.spell === "Call the Wild");
  assert.equal(wolves.length, 8, "eight wolves from a 3rd level slot");
  assert.ok(wolves.every((wolf) => wolf.maxHp === 11 && wolf.ac === 13), "the copy's wolves are not the SRD wolf");
  assert.equal(world.encounter().order.filter((entry) => wolves.some((wolf) => wolf.id === entry.characterId)).length, 8);
  assert.equal(world.sheet(druid.id).spellcasting.slots["3"].used, before + 1, "the copy did not spend its slot");
  world.dice(1);
  await world.invoke("apply_damage", { characterId: druid.id, amount: 4, type: "slashing" });
  world.clearDice();
  assert.equal(world.sheet(druid.id).concentratingOn, null);
  assert.equal(world.sheets().filter((sheet) => sheet.summon?.spell === "Call the Wild").length, 0, "the wolves outlived the concentration");
});

await test("F01: a renamed copy of Polymorph turns a creature that fails its save into the beast, and gives it its own block back when concentration ends.", async () => {
  const { world, sheets: [wizard], enemies: [dummy] } = await table([caster("wizard", "int", ["Shape of Beasts"], [], 7)], 1, { cr: 2, xp: 450 });
  await copyOf(world, "spells", "Polymorph", "Shape of Beasts");
  const own = enemyOf(world, dummy.id);
  world.dice(1);
  const out = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Shape of Beasts", variant: "brown bear", targetEnemyId: dummy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const bear = enemyOf(world, dummy.id);
  assert.equal(bear.currentHp, BEAR.hp, "the creature does not have the bear's hit points");
  assert.ok(bear.stats.polymorphedFrom, "no own form kept to return to");
  world.dice(1);
  await world.invoke("apply_damage", { characterId: wizard.id, amount: 4, type: "slashing" });
  world.clearDice();
  const back = enemyOf(world, dummy.id);
  assert.deepEqual({ hp: back.currentHp, max: back.maxHp, ac: back.ac }, { hp: own.currentHp, max: own.maxHp, ac: own.ac }, "the creature did not get its own block back");
});

await test("F02: a renamed copy of Revivify keeps its casting facts through copy, save and reload, refuses without the diamond, and consumes it.", async () => {
  const world = await openWorld();
  const entry = await copyOf(world, "spells", "Revivify", "Second Chance");
  assert.equal(entry.data.materialCostGp, 300);
  assert.equal(entry.data.materialConsumed, true);
  const published = spellFactsFor("Revivify");
  const copy = spellFactsFor("Second Chance", world.owner.id);
  for (const key of ["level", "castingTime", "verbal", "somatic", "material", "materialCostGp", "materialConsumed", "ritual", "concentration", "range"]) {
    assert.deepEqual(copy[key], published[key], `the copy's ${key} differs from Revivify's`);
  }
  const poor = world.addHero(cleric(5, { gold: 0, equipment: [], spellcasting: { prepared: ["Second Chance"] } }));
  const refused = await world.invoke("use_spell_slot", { characterId: poor.id, level: 3, spell: "Second Chance" });
  assert.equal(refused.ok, false, "the copy was cast with no diamond and no gold");
  const rich = world.addHero(cleric(5, { gold: 0, equipment: [{ name: "Diamond (300 gp)", qty: 1 }], spellcasting: { prepared: ["Second Chance"] } }));
  const cast = await world.invoke("use_spell_slot", { characterId: rich.id, level: 3, spell: "Second Chance" });
  assert.equal(cast.ok, true, cast.error);
  assert.deepEqual(world.sheet(rich.id).equipment.filter((item) => /diamond/i.test(item.name)), [], "the diamond was not consumed");
  world.close();
});

// Chromatic Orb is not in SRD 5.1; with no pack its row is the shape the
// pack serves, a material named in brackets after the M.
const CHROMATIC_ORB = {
  name: "Chromatic Orb",
  source: "open5e",
  level: 1,
  school: "evocation",
  data: { desc: "You hurl a 4-inch-diameter sphere of energy. On a hit, the creature takes 3d8 damage of the type you chose.", level_int: 1, components: "V, S, M (a diamond worth at least 50 gp)", casting_time: "1 action", range: "90 feet", duration: "Instantaneous" },
};

await test("F02: a material named in brackets after the M (Chromatic Orb) keeps its price on a copy too.", async () => {
  const world = await openWorld();
  const row = hasPack ? await catalogRow(world, "spells", "Chromatic Orb") : CHROMATIC_ORB;
  const route = await world.route("homebrew");
  world.signIn(world.owner);
  const made = await call(route, "POST", { kind: "spell", name: "Prism Shot", data: draftFromCatalog("spell", row).data });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const entry = made.json.entry;
  assert.equal(entry.data.materialCostGp, 50);
  assert.equal(spellFactsFor("Prism Shot", world.owner.id).materialCostGp, 50);
  world.close();
});

await test("F10: the preview says what the saved copy rolls: a copy of Eldritch Blast whose words say 20d6 still rolls the block's 1d10, and the preview says so and names the conflict.", async () => {
  const world = await openWorld();
  const draft = draftFromCatalog("spell", await catalogRow(world, "spells", "Eldritch Blast"));
  const data = { ...draft.data, desc: String(draft.data.desc).replace(/1d10/g, "20d6") };
  const preview = effectiveSpellPreview(data);
  const route = await world.route("homebrew");
  world.signIn(world.owner);
  const saved = await call(route, "POST", { kind: "spell", name: "Hex Lance", data });
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  const rolled = spellDamageFor({ spell: "Hex Lance", userId: world.owner.id, casterLevel: 1 });
  assert.equal(rolled?.dice, "1d10", "the saved copy does not roll the block's dice");
  assert.match(preview.line, /^1d10 force damage/, `the preview says "${preview.line}"`);
  assert.ok(preview.conflicts.some((line) => /20d6/.test(line) && /1d10/.test(line)), "the preview hides the conflict");
  world.close();
});

await test("F10: a spell with no dice in its block reads its words, and the preview reads them too.", async () => {
  const data = { desc: "A lance of frost. The target takes 3d8 cold damage.", level: 2, mech: { resolution: "attack" } };
  const preview = effectiveSpellPreview(data);
  assert.match(preview.line, /^3d8 cold damage at level 2 \(read from the description\)/);
  assert.deepEqual(preview.conflicts, []);
});

await test("F12: a draft under a published name is refused, saving and renaming alike, and a copy starts under a name of its own.", async () => {
  const world = await openWorld();
  const row = await catalogRow(world, "spells", "Fireball");
  const draft = draftFromCatalog("spell", row);
  assert.notEqual(draft.name.toLowerCase(), "fireball", "a copy starts under the published name");
  assert.ok(draftFindings({ ...draft, name: "Fireball" }, {}).some((finding) => finding.level === "error"), "the editor lets it save as Fireball");
  const route = await world.route("homebrew");
  world.signIn(world.owner);
  const refused = await call(route, "POST", { kind: "spell", name: "Fireball", data: draft.data });
  assert.equal(refused.status, 400, "a spell was kept under the published name");
  const kept = await call(route, "POST", { kind: "spell", name: "Ember Burst", data: draft.data });
  assert.equal(kept.status, 201, JSON.stringify(kept.json));
  const one = await world.route("homebrew/[id]");
  const renamed = await call(one, "PATCH", { name: "Fireball" }, { id: kept.json.entry.id });
  assert.equal(renamed.status, 400, "a kept spell was renamed to the published name");
  world.close();
});

// ---- traps: attack rolls are attack rolls ----

async function trapTable(attackBonus) {
  const world = await openWorld();
  const route = await world.route("homebrew");
  world.signIn(world.owner);
  const made = await call(route, "POST", {
    kind: "hazard",
    name: `Dart Wall ${attackBonus}`,
    data: { desc: "Darts from the wall.", hazardKind: "trap", trap: { kind: "mechanical", trigger: "a tripwire", attackBonus, hit: [{ dice: "1d6", type: "piercing" }], summary: "A dart." } },
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const hero = world.addHero({ class: "fighter", level: 5, maxHp: 60 });
  world.patch(hero.id, { currentHp: 60 });
  return { world, hero, trap: `Dart Wall ${attackBonus}` };
}
const spring = async (world, trap, hero, faces) => {
  world.clearDice();
  world.dice(...faces);
  const out = await world.invoke("apply_hazard", { type: "trap", trap, characterIds: [hero.id] });
  const log = world.diceLog();
  world.clearDice();
  return { out, log };
};

await test("F11: a trap's natural 1 misses even at +20 against AC 10.", async () => {
  const { world, hero, trap } = await trapTable(20);
  world.patch(hero.id, { ac: 10, acOverride: true });
  const { out } = await spring(world, trap, hero, [1, 6]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hero.id).currentHp, 60, "a natural 1 hit");
  world.close();
});

await test("F11: a trap's natural 20 hits at +0 against AC 23, and its hit dice are rolled twice.", async () => {
  const { world, hero, trap } = await trapTable(0);
  world.patch(hero.id, { ac: 23, acOverride: true });
  const { out, log } = await spring(world, trap, hero, [20, 3, 4]);
  assert.equal(out.ok, true, out.error);
  assert.equal(log.filter((die) => die.sides === 6).length, 2, "the critical hit rolled one d6");
  assert.equal(world.sheet(hero.id).currentHp, 60 - 7);
  world.close();
});

await test("F11: Poison Darts on a natural 20: the darts' dice double, the poison save's do not.", async () => {
  const world = await openWorld();
  const hero = world.addHero({ class: "fighter", level: 5, maxHp: 60 });
  world.patch(hero.id, { currentHp: 60, ac: 12, acOverride: true });
  const { out, log } = await spring(world, "Poison Darts", hero, [20, 2, 3, 1, 5, 5]);
  assert.equal(out.ok, true, out.error);
  assert.equal(log.filter((die) => die.sides === 4).length, 2, "the darts' 1d4 was not doubled");
  assert.equal(log.filter((die) => die.sides === 10).length, 2, "the poison's 2d10 was doubled");
  assert.equal(world.sheet(hero.id).currentHp, 60 - 5 - 10);
  world.close();
});

await test("F11: a trap attacks the AC every other attack faces: a pinned AC still takes Shield of Faith's +2.", async () => {
  const { world, hero, trap } = await trapTable(5);
  world.patch(hero.id, { ac: 15, acOverride: true, conditions: ["shield of faith"] });
  const ac = acWithEffects(world.campaignId, world.sheet(hero.id));
  assert.equal(ac, 17, "the fixture's AC is not 17");
  const { out } = await spring(world, trap, hero, [11, 6]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hero.id).currentHp, 60, "16 hit AC 17");
  world.close();
});

await closeTables();
finish();
