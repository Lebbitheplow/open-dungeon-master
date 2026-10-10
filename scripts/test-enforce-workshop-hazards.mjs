// A trap, a poison or a disease written in the workshop runs at the table
// by name, with the numbers its block gives (SRD 5.1, Running the Game:
// Traps, Poisons, Diseases). Before, the engine knew only the SRD's own:
// apply_hazard sized a trap by severity alone, and the afflict tool refused
// any poison or disease the book does not list, so a DM's "Marsh Fever" or
// "Nightshade" was narration with no numbers behind it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-workshop-hazards");
const { hazardCatalog } = await import("../src/lib/workshop/hazard-catalog.ts");
const { draftFromCatalog } = await import("../src/app/workshop/homebrew/draft.ts");

const world = await openWorld({ campaign: { maxPlayers: 12 } });
const homebrew = await world.route("homebrew");

async function brew(name, data) {
  world.signIn(world.owner);
  const response = await homebrew.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ kind: "hazard", name, data }) }));
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.entry;
}

// "Start from" one of the SRD's, renamed.
async function brewCopy(srdName, name) {
  const row = hazardCatalog(srdName).find((entry) => entry.name === srdName);
  assert.ok(row, `${srdName} is not in the catalog`);
  return brew(name, draftFromCatalog("hazard", row).data);
}

const has = (id, name) => world.sheet(id).conditions.map((entry) => entry.toLowerCase()).includes(name);
const withDice = async (faces, run) => {
  world.clearDice();
  world.dice(...faces);
  try {
    return await run();
  } finally {
    world.clearDice();
  }
};

await brew("Scything Blade", {
  desc: "A blade swings out of the wall.",
  hazardKind: "trap",
  trap: { kind: "mechanical", trigger: "a loose flagstone", spot: { dc: 14, skill: "perception" }, save: { ability: "dex", dc: 14, halfOnSave: true }, damage: { dice: "3d10", type: "slashing" }, summary: "DC 14 Dexterity save, 3d10 slashing, half on a success." },
});
await brewCopy("Poison Needle", "Lockjaw Pin");
await brew("Nightshade", {
  desc: "A bitter tincture.",
  hazardKind: "poison",
  poison: { type: "ingested", dc: 14, damage: "2d8", conditions: ["poisoned"], minutes: 60, summary: "DC 14 CON: 2d8 poison and poisoned for an hour." },
});
await brew("Marsh Fever", {
  desc: "A fever of the fens.",
  hazardKind: "disease",
  disease: {
    condition: "marsh fever",
    infect: { ability: "con", dc: 12 },
    onset: { dice: "1", unit: "days" },
    exhaustion: 1,
    rest: { ability: "con", dc: 12, onSuccess: "recover", onFail: "worsen", successes: 2 },
    summary: "DC 12 CON; a day later a level of exhaustion; two successful rest saves cure it, a failure adds a level.",
  },
});

const hero = world.addHero({ class: "fighter", level: 5, maxHp: 60, abilities: { dex: 10, con: 10 } });

await test("A workshop trap springs by name with its own save and damage.", async () => {
  world.patch(hero.id, { currentHp: 60 });
  const out = await withDice([3, 5, 5, 5], () => world.invoke("apply_hazard", { type: "trap", trap: "Scything Blade", characterIds: [hero.id] }));
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.trap, "Scything Blade");
  assert.equal(world.sheet(hero.id).currentHp, 60 - 15, "a failed DC 14 save did not take 3d10 (5+5+5)");
});

await test("A workshop copy of the Poison Needle pricks for 1 piercing and 2d10 poison, then a DC 15 CON save or poisoned.", async () => {
  world.patch(hero.id, { currentHp: 60, conditions: [] });
  const out = await withDice([4, 6, 2], () => world.invoke("apply_hazard", { type: "trap", trap: "Lockjaw Pin", characterIds: [hero.id] }));
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hero.id).currentHp, 60 - 1 - 10);
  assert.equal(has(hero.id, "poisoned"), true, "the failed save left no poison");
});

await test("A workshop poison is laid on by name: its DC, its damage and its condition.", async () => {
  world.patch(hero.id, { currentHp: 60, conditions: [] });
  const out = await withDice([5, 4, 4], () => world.invoke("afflict", { characterId: hero.id, kind: "poison", name: "Nightshade" }));
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hero.id).currentHp, 60 - 8);
  assert.equal(has(hero.id, "poisoned"), true);
});

await test("A workshop disease incubates, shows its symptoms, worsens on a failed rest save and is cured by two successes.", async () => {
  const patient = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { con: 10 } });
  const out = await withDice([2], () => world.invoke("afflict", { characterId: patient.id, kind: "disease", name: "Marsh Fever" }));
  assert.equal(out.ok, true, out.error);
  assert.equal(has(patient.id, "marsh fever"), false, "symptoms before the incubation");
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  assert.equal(has(patient.id, "marsh fever"), true, "no symptoms after a day");
  assert.equal(world.sheet(patient.id).exhaustion, 1);
  const rest = async (face) => {
    await world.invoke("pass_time", { amount: 1, unit: "days" });
    return withDice([face], () => world.invoke("take_rest", { kind: "long" }));
  };
  // The rest takes its own level off (1 to 0); the failed save puts one back.
  await rest(2);
  assert.equal(world.sheet(patient.id).exhaustion, 1, "a failed rest save did not worsen it");
  await rest(18);
  assert.equal(has(patient.id, "marsh fever"), true, "one success cured a disease that takes two");
  await rest(18);
  assert.equal(has(patient.id, "marsh fever"), false, "two successes did not cure it");
});

await test("The SRD's Oil of Taggit and Essence of Ether are found by their own names (an \"of\" in the name hid them).", async () => {
  for (const name of ["Oil of Taggit", "Essence of Ether"]) {
    const victim = world.addHero({ class: "fighter", level: 1, abilities: { con: 10 } });
    const out = await withDice([2], () => world.invoke("afflict", { characterId: victim.id, kind: "poison", name }));
    assert.equal(out.ok, true, `${name}: ${out.error ?? out.result?.error}`);
    assert.equal(has(victim.id, "unconscious"), true, `${name} left its victim awake`);
  }
});

await test("A workshop hazard is its author's: another DM's table does not know it.", async () => {
  const other = await openWorld();
  const stranger = other.addHero({ class: "fighter", level: 1 });
  const out = await other.invoke("afflict", { characterId: stranger.id, kind: "poison", name: "Nightshade" });
  assert.ok(out.error, "another table laid on this table's poison");
});

finish();
