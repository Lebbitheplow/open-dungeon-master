// What the second visual check found the engine side of (/tmp/odm-enf2/look):
//
//   - aoe_damage for a player's known spell takes its save and DC from the
//     spell and the caster's sheet, so the console's Save and DC are optional
//     there; an effect that names neither a spell nor a save is refused with
//     a sentence that says what to send.
//   - A homebrew damage type (the console's "Another damage type") is taken
//     as typed and named in the result.
//   - The lair action's result says what the lair did, not only the round.
//   - An Eldritch Knight learns abjuration and evocation spells, with one pick
//     from any school at 3rd level (more at 8th, 14th, 20th): a level-up that
//     adds a second off-school spell at 3rd is refused, and a sheet that
//     already held more is not refused for keeping them.
// Stored state and refusals are read, never narration.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { castOnOwnTurn, fightDummies, packAnswers, wizard } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-look-fixes");
const pack = await packAnswers();
const world = castOnOwnTurn(await openWorld());

const { levelUpSpells } = await import("../src/lib/srd/level-up-spells.ts");
const { thirdCasterSchoolProblem } = await import("../src/lib/srd/third-caster.ts");

// ---- aoe_damage: Save and DC from the spell ----

if (pack) {
  await test("a player's Fireball with no save or DC sent rolls DEX against the caster's own DC", async () => {
    const mage = world.addHero(wizard(5, { name: "Ilsa" }));
    const [goblin] = await fightDummies(world, 1, { heroFaces: { [mage.id]: 20 } });
    world.dice(1, 1, 1, 1, 1, 1, 1, 1, 1);
    const out = await world.invoke("aoe_damage", { enemyIds: [goblin.id], casterId: mage.id, spell: "Fireball" });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.saveAbility, "dex");
    assert.equal(out.result.dc, 8 + proficiencyBonus(5) + abilityMod(16));
    assert.deepEqual(world.sheet(mage.id).spellcasting.slots["3"], { max: 2, used: 1 });
  });
}

await test("an area effect that names no spell and sends no save is refused, nothing rolled", async () => {
  // Without the content pack the Fireball case above is skipped, and with it
  // the only character: a fight needs someone to face it.
  if (!world.encounter()) {
    world.addHero(wizard(5, { name: "Ilsa" }));
    await world.beginFight([{ monster: "goblin", count: 1 }]);
  }
  const [goblin] = world.enemies();
  const before = goblin.currentHp;
  const out = await world.invoke("aoe_damage", { damage: "2d6", enemyIds: [goblin.id] });
  assert.equal(out.ok, false);
  assert.match(out.error, /saveAbility and dc/);
  assert.equal(world.enemies().find((entry) => entry.id === goblin.id).currentHp, before);
});

// ---- a homebrew damage type ----

await test("damage_enemy takes a homebrew damage type and names it in the result", async () => {
  const [goblin] = world.enemies();
  const out = await world.invoke("damage_enemy", { enemyId: goblin.id, amount: 2, type: "sonic" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.damageType, "sonic");
});

// ---- lair action ----

await test("a lair action's result says what the lair did and on which round", async () => {
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const encounter = world.encounter();
  const legendary = { ...(encounter.legendary ?? {}), lair: true };
  getDatabase().prepare("UPDATE encounters SET legendary_json = ? WHERE id = ?").run(JSON.stringify(legendary), encounter.id);
  const out = await world.invoke("lair_action", { action: "The ceiling cracks and dust rains down." });
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.note, /round \d+: The ceiling cracks/);
});

// ---- third casters' schools ----

const SCHOOLS = {
  "magic missile": "evocation",
  shield: "abjuration",
  "burning hands": "evocation",
  "charm person": "enchantment",
  "find familiar": "conjuration",
  "silent image": "illusion",
};
const facts = (name) => {
  const school = SCHOOLS[name.toLowerCase()];
  return school ? { name, level: 1, classes: ["wizard"], school } : null;
};
const knight = (known, level = 3) => ({
  classId: "fighter",
  subclass: "Eldritch Knight",
  ability: "int",
  level,
  style: "known",
  known,
  prepared: [],
  cantrips: ["Fire Bolt", "Light"],
  pending: [],
  spellbook: [],
});

await test("an Eldritch Knight of 3rd level learns one spell from outside abjuration and evocation, not two", () => {
  const ok = levelUpSpells({
    before: knight([], 2),
    level: 3,
    subclass: "Eldritch Knight",
    list: "wizard",
    firstLevel: false,
    abilities: { str: 16, dex: 12, con: 14, int: 12, wis: 10, cha: 8 },
    freeCantrips: 0,
    spellOf: facts,
    picks: { kind: "picks", spells: ["Magic Missile", "Shield", "Charm Person"] },
  });
  assert.ok("view" in ok, ok.error);
  const refused = levelUpSpells({
    before: knight([], 2),
    level: 3,
    subclass: "Eldritch Knight",
    list: "wizard",
    firstLevel: false,
    abilities: { str: 16, dex: 12, con: 14, int: 12, wis: 10, cha: 8 },
    freeCantrips: 0,
    spellOf: facts,
    picks: { kind: "picks", spells: ["Magic Missile", "Charm Person", "Find Familiar"] },
  });
  assert.ok("error" in refused);
  assert.match(refused.error, /abjuration and evocation/);
});

await test("a third caster that already held more off-school spells keeps them; only adding more is refused", () => {
  const held = [
    { name: "Charm Person", school: "enchantment" },
    { name: "Find Familiar", school: "conjuration" },
  ];
  assert.equal(
    thirdCasterSchoolProblem({ classId: "fighter", subclass: "Eldritch Knight", level: 4, spells: [...held, { name: "Shield", school: "abjuration" }], heldOutside: 2 }),
    null,
  );
  assert.match(
    thirdCasterSchoolProblem({ classId: "fighter", subclass: "Eldritch Knight", level: 4, spells: [...held, { name: "Silent Image", school: "illusion" }], heldOutside: 2 }),
    /Pick an abjuration or evocation spell/,
  );
  // An Arcane Trickster's own two schools are enchantment and illusion.
  assert.equal(
    thirdCasterSchoolProblem({ classId: "rogue", subclass: "Arcane Trickster", level: 3, spells: [{ name: "Charm Person", school: "enchantment" }, { name: "Silent Image", school: "illusion" }, { name: "Shield", school: "abjuration" }] }),
    null,
  );
});

await test("a pack spell whose school is an object ({ name, key }) is judged by it, not thrown on (issue 66)", () => {
  const evocation = { name: "Evocation", key: "evocation" };
  const illusion = { name: "Illusion", key: "illusion" };
  assert.equal(
    thirdCasterSchoolProblem({ classId: "fighter", subclass: "Eldritch Knight", level: 3, spells: [{ name: "Anchoring Rope", school: evocation }, { name: "Silent Image", school: illusion }] }),
    null,
    "one off-school pick at 3rd level",
  );
  assert.match(
    thirdCasterSchoolProblem({ classId: "fighter", subclass: "Eldritch Knight", level: 3, spells: [{ name: "Silent Image", school: illusion }, { name: "Minor Illusion Two", school: { name: "Illusion" } }] }),
    /Pick an abjuration or evocation spell/,
  );
});

world.close();
finish();
