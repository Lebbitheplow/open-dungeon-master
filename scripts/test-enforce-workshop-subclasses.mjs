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

finish();
