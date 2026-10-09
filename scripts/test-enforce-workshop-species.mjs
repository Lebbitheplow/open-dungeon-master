// A species written in the workshop, or copied there from a published one,
// is that species at the table: its size, its traits, and the rules the
// engines read off a bundled race's id (SRD 5.1, Races: a halfling is
// Small, so a heavy weapon swings at disadvantage; Dwarven Toughness adds a
// hit point every level; a dwarf's speed is not reduced by heavy armor; a
// tiefling knows thaumaturgy; a dragonborn takes an ancestry). Before, a
// species the bundled list did not carry was Medium with none of those, so
// a workshop copy of the Halfling swung a greataxe like a human, and a pack
// Derro ("Your size is Small") did too.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { gearKit, profs } from "./lib/enforce-equipment.mjs";

const { test, finish } = suite("test-enforce-workshop-species");
const { raceMechanicsOf } = await import("../src/lib/workshop/catalog-mechanics.ts");
const { draftFromCatalog } = await import("../src/app/workshop/homebrew/draft.ts");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { sizeForRace, speedFor } = await import("../src/lib/srd/index.ts");
const { innateCantripsFor, takesDraconicAncestry } = await import("../src/lib/srd/racial-grants.ts");
const { traitSaveAdvantages } = await import("../src/lib/srd/trait-rules.ts");

// The SRD's rows, so the suite runs the same with or without the pack.
const rows = JSON.parse(fs.readFileSync(new URL("./fixtures/srd-race-rows.json", import.meta.url), "utf8")).rows;
const srdRow = (slug) => rows.find((row) => row.slug === slug) ?? null;

const world = await openWorld();
const kit = await gearKit(world);
const homebrew = await world.route("homebrew");
const homebrewEntry = await world.route("homebrew/[id]");
const sheetRoute = await world.route("campaigns/[campaignId]/sheet");

// "Start from" a published species, renamed and saved, as the workshop does.
async function brewCopy(slug, name) {
  const row = srdRow(slug);
  const table = raceMechanicsOf({ ...row, source: "open5e" }, srdRow);
  const { data } = draftFromCatalog("race", { ...row, table });
  world.signIn(world.owner);
  const response = await homebrew.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ kind: "race", name, data }) }),
  );
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  const id = `homebrew:${body.entry.id}`;
  const [option] = packRaceOptions([{ slug: id, name, documentSlug: "homebrew", document: "Homebrew", data: body.entry.data }], [id]);
  // The builder writes the species' traits onto the sheet by name.
  return { id, entryId: body.entry.id, data: body.entry.data, speed: option.speed, features: option.traitNames.map((trait) => ({ name: trait, source: "race" })) };
}

const smallkin = await brewCopy("lightfoot", "Smallkin");
const stonefolk = await brewCopy("hill-dwarf", "Stonefolk");
const plainsfolk = await brewCopy("human", "Plainsfolk");
const hellspawn = await brewCopy("tiefling", "Hellspawn");
const drakeborn = await brewCopy("dragonborn", "Drakeborn");

const anchor = world.addHero({ class: "fighter", level: 5 });
const hero = world.addHero({ class: "fighter", level: 5 });
await kit.arena({ first: anchor.id });
kit.stand(hero.id, 1);

function become(species, { str = 14, equipment = [] } = {}) {
  return world.patch(hero.id, {
    race: species.id,
    speed: species.speed,
    features: species.features,
    abilities: { str, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencies: profs({ weapons: ["simple", "martial"], armor: ["light", "medium", "heavy"] }),
    equipment,
  });
}

await test("A workshop copy of the Halfling is Small: a heavy weapon swings at disadvantage, a light one does not.", async () => {
  become(smallkin, { equipment: [{ name: "Greataxe", qty: 1 }, { name: "Mace", qty: 1 }] });
  assert.equal(sizeForRace(world.sheet(hero.id).race), "Small");
  let swing = await kit.swing(hero.id, { weapon: "Greataxe" }, 15, 4, 6);
  assert.deepEqual(swing.d20s, [15, 4], "a Small copy swung a greataxe without disadvantage");
  swing = await kit.swing(hero.id, { weapon: "Mace" }, 15, 4);
  assert.deepEqual(swing.d20s, [15]);
  become(plainsfolk, { equipment: [{ name: "Greataxe", qty: 1 }] });
  swing = await kit.swing(hero.id, { weapon: "Greataxe" }, 15, 4);
  assert.deepEqual(swing.d20s, [15], "a Medium copy swung at disadvantage");
});

await test("Changing a workshop species' size in the workshop changes it at the table.", async () => {
  world.signIn(world.owner);
  const response = await homebrewEntry.PATCH(
    new Request("http://test/", { method: "PATCH", body: JSON.stringify({ data: { ...smallkin.data, size: "Medium" } }) }),
    { params: Promise.resolve({ id: smallkin.entryId }) },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(sizeForRace(smallkin.id), "Medium");
});

await test("A workshop copy of the Dwarf keeps its speed in heavy armor too heavy for its Strength; a copy of the Human loses 10 feet.", async () => {
  const plate = [{ name: "Plate Armor", qty: 1, equipped: true }];
  const dwarf = become(stonefolk, { str: 10, equipment: plate });
  assert.equal(speedFor(dwarf), 25, "the dwarf copy was slowed by plate");
  const human = become(plainsfolk, { str: 10, equipment: plate });
  assert.equal(speedFor(human), 20);
});

await test("A workshop copy of the Dwarf has Dwarven Resilience: advantage on saves against poison.", async () => {
  const dwarf = become(stonefolk);
  assert.ok(traitSaveAdvantages(dwarf, "con", "poisoned").length > 0);
});

await test("A workshop copy of the Hill Dwarf gains Dwarven Toughness's extra hit point with every level.", async () => {
  async function gained(species) {
    world.patch(anchor.id, { race: species.id, features: species.features, xp: 355000, currentHp: 40, maxHp: 40, abilities: { str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
    world.signIn(world.owner);
    const before = world.sheet(anchor.id).maxHp;
    const response = await sheetRoute.PATCH(
      new Request("http://test/", { method: "PATCH", body: JSON.stringify({ level: world.sheet(anchor.id).level + 1, levelUpClass: "fighter" }) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    const body = await response.json();
    assert.equal(response.status, 200, body.error);
    return world.sheet(anchor.id).maxHp - before;
  }
  const human = await gained(plainsfolk);
  const dwarf = await gained(stonefolk);
  assert.equal(dwarf, human + 1, `the dwarf copy gained ${dwarf}, the human copy ${human}`);
});

await test("A workshop copy of the Tiefling knows thaumaturgy from its Infernal Legacy.", async () => {
  const tiefling = become(hellspawn);
  assert.deepEqual(innateCantripsFor(tiefling.race, 5), ["Thaumaturgy"]);
});

await test("A workshop copy of the Dragonborn takes a draconic ancestry.", async () => {
  const dragon = become(drakeborn);
  assert.equal(takesDraconicAncestry(dragon.race), true);
  assert.equal(takesDraconicAncestry(plainsfolk.id), false);
});

await test("A content-pack species is the size its text says (Tome of Heroes' Derro: \"Your size is Small.\").", async () => {
  if (!world.hasPack) return;
  assert.equal(sizeForRace("derro"), "Small");
  assert.equal(sizeForRace("alseid"), "Medium");
});

finish();
