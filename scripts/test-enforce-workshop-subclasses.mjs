// A subclass written in the workshop, or one the content pack prints as
// prose, is a subclass: the character who takes it gets its features at the
// levels it gives them, and the engines run those features (SRD 5.1,
// Classes: each class's archetype "grants you features at" its levels).
// Before, a character who took a workshop or pack subclass got the base
// class's features and none of the subclass's (src/lib/srd/features.ts
// granted only subclasses its own tables carry), and a workshop copy of a
// published subclass started with no features at all.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-workshop-subclasses");
const { archetypeMechanicsOf } = await import("../src/lib/workshop/catalog-mechanics.ts");
const { draftFromCatalog } = await import("../src/app/workshop/homebrew/draft.ts");
const { classFeaturesFor, subclassSpellsFor, subclassFeatureDescription } = await import("../src/lib/srd/features.ts");
const { subclassExtrasForTable } = await import("../src/lib/db/subclass-extras.ts");

const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const homebrew = await world.route("homebrew");

async function brew(name, data) {
  world.signIn(world.owner);
  const response = await homebrew.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ kind: "archetype", name, data }) }),
  );
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.entry;
}

// "Start from" the SRD Champion, renamed: what CatalogStart hands the draft.
function championCopy() {
  const table = archetypeMechanicsOf({ name: "Champion", source: "open5e", data: { desc: "" } }, "fighter");
  assert.ok(table, "the Champion's table was not offered to copy");
  return draftFromCatalog("archetype", { name: "Champion", data: { desc: "" }, table }, { classSlug: "fighter" }).data;
}

const names = (features) => features.map((feature) => `${feature.level}:${feature.name}`).sort();

await test("A renamed copy of the Champion grants the Champion's features at the Champion's levels.", async () => {
  const data = championCopy();
  await brew("Champion of Ash", data);
  const extras = subclassExtrasForTable(world.campaignId, world.owner.id);
  assert.deepEqual(names(classFeaturesFor("fighter", "Champion of Ash", 20, extras)), names(classFeaturesFor("fighter", "Champion", 20)));
});

await test("A character who takes a workshop subclass at the table holds its features, and its crit range is the engine's.", async () => {
  const hero = world.addHero({
    name: "Ashblade", class: "fighter", subclass: "Champion of Ash", level: 3,
    abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  });
  const held = world.sheet(hero.id).features.map((feature) => feature.name);
  assert.ok(held.includes("Improved Critical"), `the workshop subclass granted nothing: ${held.join(", ")}`);
  await kit.fight(1, { heroFaces: { [hero.id]: 20 } });
  const [enemy] = world.enemies();
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const swing = await kit.swing(hero.id, enemy.id, [19, 4, 4], { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.crit, true, "a natural 19 was no critical hit for a Champion copy");
  await kit.endFight();
});

await test("A level change keeps a workshop subclass's features and grants the next ones.", async () => {
  const hero = world.addHero({ name: "Cinder", class: "fighter", subclass: "Champion of Ash", level: 3, proficiencies: TRAINED });
  world.patch(hero.id, { level: 10 });
  const held = world.sheet(hero.id).features.map((feature) => feature.name);
  assert.ok(held.includes("Improved Critical"), "the level change dropped the subclass's 3rd-level feature");
  assert.ok(held.includes("Additional Fighting Style"), `the 10th-level feature was not granted: ${held.join(", ")}`);
});

await test("A workshop subclass's always-prepared spells and its features' words reach the table.", async () => {
  await brew("Domain of Embers", {
    desc: "Clerics of the banked fire.",
    classSlug: "cleric",
    levels: { 1: [{ n: "Ember Ward", d: "When a creature within 30 feet takes fire damage, you can use your reaction to halve it." }] },
    spells: { 1: ["Burning Hands", "Faerie Fire"], 3: ["Flaming Sphere"] },
  });
  const extras = subclassExtrasForTable(world.campaignId, world.owner.id);
  assert.deepEqual(subclassSpellsFor("cleric", "Domain of Embers", 3, extras).sort(), ["Burning Hands", "Faerie Fire", "Flaming Sphere"]);
  assert.match(subclassFeatureDescription("cleric", "Domain of Embers", "Ember Ward", extras) ?? "", /halve it/);
  const priest = world.addHero({ name: "Kindle", class: "cleric", subclass: "Domain of Embers", level: 1 });
  assert.ok(world.sheet(priest.id).features.some((feature) => feature.name === "Ember Ward"));
});

await test("A workshop subclass is its author's: another table's DM does not grant it.", async () => {
  const stranger = world.addUser("stranger-dm");
  const { subclassExtrasFor } = await import("../src/lib/db/subclass-extras.ts");
  const theirs = subclassExtrasFor([stranger.id]);
  assert.equal((theirs.fighter ?? []).some((table) => table.name === "Champion of Ash"), false);
});

// ---- what a workshop subclass casts and picks ----
// A workshop subclass built like the Eldritch Knight casts like one; one
// that borrowed Combat Superiority picks maneuvers; a homebrew domain's
// always-prepared spells are free at the table as they are in the builder.
// Before, all three were keyed to the published subclass's name, so the
// player's copy got no spells, no maneuvers, and its domain spells counted
// against the cap (and could be unprepared).

const { judgeSpellcasting } = await import("../src/lib/srd/legality/spells.ts");
const { classGrantsFor, spellFactsFor } = await import("../src/lib/characters/catalog.ts");
const { optionFeatureName, openOptionSlots } = await import("../src/lib/srd/options.ts");
const { engineRunsFeature } = await import("../src/lib/workshop/feature-catalog.ts");
const { tableAuthors } = await import("../src/lib/db/homebrew.ts");

const extrasNow = () => subclassExtrasForTable(world.campaignId, world.owner.id);
const tableOf = (classId, name) => (extrasNow()[classId] ?? []).find((table) => table.name === name);

function eldritchCopy() {
  const table = archetypeMechanicsOf({ name: "Eldritch Knight", source: "open5e", data: { desc: "" } }, "fighter");
  assert.ok(table, "the Eldritch Knight's table was not offered to copy");
  return draftFromCatalog("archetype", { name: "Eldritch Knight", data: { desc: "" }, table }, { classSlug: "fighter" }).data;
}

async function call(path, method, body, user = world.owner) {
  world.signIn(user);
  const mod = await world.route(path);
  const response = await mod[method](
    new Request("http://test/", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}

await test("The workshop keeps a subclass's spellcasting setting through a save.", async () => {
  const entry = await brew("Hedge Knight", {
    desc: "",
    classSlug: "fighter",
    castingProfile: "third-caster",
    levels: { 3: [{ n: "Hedge Ward", d: "A small ward." }] },
  });
  assert.equal(entry.data.castingProfile, "third-caster", "the save dropped the setting");
  assert.equal(tableOf("fighter", "Hedge Knight")?.castingProfile, "third-caster");
});

await test("A copy of the Eldritch Knight casts like one without a second setting, and turning it off sticks.", async () => {
  await brew("Spellblade", eldritchCopy());
  assert.equal(tableOf("fighter", "Spellblade")?.castingProfile, "third-caster", "the copy does not cast");
  await brew("Hexless Blade", { ...eldritchCopy(), castingProfile: "none" });
  assert.equal(tableOf("fighter", "Hexless Blade")?.castingProfile, undefined, "turning it off did not stick");
  assert.equal(engineRunsFeature("fighter", "Spellcasting (Eldritch Knight)"), "[spell slots]");
});

await test("The server accepts a level 3 Spellblade's spells and hands it a third caster's slots.", async () => {
  const verdict = judgeSpellcasting({
    sent: { ability: "int", slots: {}, prepared: [], known: ["Shield", "Magic Missile", "Burning Hands"], cantrips: ["Fire Bolt", "Light"] },
    classes: [{ id: "fighter", subclass: "Spellblade", level: 3 }],
    classOf: classGrantsFor,
    subclassExtras: extrasNow(),
    abilities: { str: 16, dex: 10, con: 14, int: 14, wis: 10, cha: 8 },
    spellOf: (name) => spellFactsFor(name, tableAuthors(world.campaignId)),
    racialCantrip: null,
    judgeLists: true,
  });
  assert.deepEqual(verdict.problems, []);
  assert.deepEqual(verdict.spellcasting?.slots, { 1: { max: 2, used: 0 } });
});

await test("A workshop subclass that borrowed Combat Superiority picks maneuvers, and a write keeps them.", async () => {
  await brew("Tactician", {
    desc: "",
    classSlug: "fighter",
    levels: { 3: [{ n: "Combat Superiority", d: "You learn maneuvers fueled by superiority dice." }] },
  });
  const granted = classFeaturesFor("fighter", "Tactician", 3, extrasNow());
  const [slot] = openOptionSlots({ classId: "fighter", subclass: "Tactician", level: 3, features: granted }).filter(
    (entry) => entry.kind === "maneuver",
  );
  assert.equal(slot?.total, 3, "no maneuver picks were opened");
  const picks = ["Trip Attack", "Riposte", "Parry"].map((name) => ({ name: optionFeatureName("maneuver", name), source: "choice" }));
  const hero = world.addHero({ name: "Vex", class: "fighter", subclass: "Tactician", level: 3, proficiencies: TRAINED, features: picks });
  const held = world.sheet(hero.id).features.map((feature) => feature.name);
  for (const pick of picks) {
    assert.ok(held.includes(pick.name), `the write pruned ${pick.name}: ${held.join(", ")}`);
  }
  assert.equal(engineRunsFeature("fighter", "Combat Superiority"), "[opens Maneuver picks]");
});

await test("A homebrew domain's always-prepared spells are free at the table: legal off the class list, and never unprepared.", async () => {
  const verdict = judgeSpellcasting({
    sent: { ability: "wis", slots: {}, prepared: ["Burning Hands", "Faerie Fire", "Bless"], known: [], cantrips: ["Sacred Flame", "Guidance", "Light"] },
    classes: [{ id: "cleric", subclass: "Domain of Embers", level: 1 }],
    classOf: classGrantsFor,
    subclassExtras: extrasNow(),
    abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
    spellOf: (name) => spellFactsFor(name, tableAuthors(world.campaignId)),
    racialCantrip: null,
    judgeLists: true,
  });
  assert.deepEqual(verdict.problems.filter((problem) => /Burning Hands|Faerie Fire/.test(problem)), []);
  const player = world.addUser("ember-player");
  world.addHero({
    user: player,
    name: "Ash",
    class: "cleric",
    subclass: "Domain of Embers",
    level: 1,
    abilities: { wis: 16 },
    spellcasting: { ability: "wis", slots: { 1: { max: 2, used: 0 } }, prepared: ["Burning Hands", "Faerie Fire", "Bless"], known: [], cantrips: [] },
  });
  const dropped = await call("campaigns/[campaignId]/sheet/spells", "POST", { action: "unprepare", spell: "Burning Hands" }, player);
  assert.equal(dropped.status, 400, `a domain spell was unprepared: ${JSON.stringify(dropped.json)}`);
});

await test("The campaign snapshot carries the table's workshop subclasses, so the sheet reads their words.", async () => {
  const snapshot = await call("campaigns/[campaignId]", "GET");
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.json).slice(0, 300));
  const names = Object.values(snapshot.json.subclasses ?? {}).flat().map((table) => table.name);
  assert.ok(names.includes("Domain of Embers"), `the snapshot carried ${names.join(", ") || "nothing"}`);
});

finish();
