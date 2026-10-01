// Class features, racial traits, feats and items that change a d20 roll a
// character makes: a save, a check, initiative. Each rule is read off the
// roll the engine stored (its d20 faces and total) or off the sheet, never
// off narration.
//
// The rules, from SRD 5.1:
//   - Gnome Cunning: advantage on INT, WIS and CHA saves against magic.
//   - Fey Ancestry: advantage on saves against being charmed.
//   - Dwarven Resilience, Stout Resilience: advantage on saves against poison.
//   - Brave: advantage on saves against being frightened.
//   - Danger Sense: advantage on DEX saves, not while blinded, deafened or
//     incapacitated. Feral Instinct: advantage on initiative.
//   - Rage: advantage on Strength checks and saves, none of it in heavy armor.
//   - Diamond Soul: proficiency in every save. Slippery Mind: in WIS saves.
//   - Aura of Protection: the paladin and friendly creatures within 10 feet
//     (30 at paladin 18) add the paladin's CHA to saves; auras of one kind do
//     not stack, the best applies.
//   - A check with a tool the character is proficient in adds proficiency.
//   - Inspiration: the DM awards it; the player spends it for advantage.
//   - Stone of Good Luck: +1 to ability checks. Cloak of Elvenkind: advantage
//     on Stealth. Observant: +5 passive Investigation.
//   - Reliable Talent and Halfling Lucky apply to every check, contests too.
//   - Indomitable Might: a STR check total below the STR score uses the score.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-feature-saves");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { computeSheetDerived } = await import("../src/lib/srd/index.ts");

const race = (...names) => names.map((name) => ({ name, source: "race" }));
const klass = (classId, ...names) => names.map((name) => ({ name, source: "class", classId }));
const prof = (more = {}) => ({ ...TRAINED, ...more });

// A request_roll through the engine, with its dice forced, and the roll it
// stored.
async function roll(characterId, args, faces = []) {
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  const out = await world.invoke("request_roll", { characterId, reason: "test", ...args });
  world.clearDice();
  const [stored] = kit.lastRolls(1);
  return { out, stored, faces: d20Faces(stored) };
}

const reset = (id, patch = {}) =>
  world.patch(id, { conditions: [], conditionMeta: {}, exhaustion: 0, ...patch });

// ---- racial save advantages ----

const gnome = world.addHero({
  race: "rock_gnome", class: "wizard", level: 3,
  features: race("Gnome Cunning (adv. on INT/WIS/CHA saves vs magic)"),
});
const elf = world.addHero({
  race: "high_elf", class: "wizard", level: 3,
  features: race("Fey Ancestry (adv. vs charm, immune to magical sleep)"),
});
const dwarf = world.addHero({
  race: "hill_dwarf", class: "fighter", level: 3, abilities: { con: 14 },
  features: race("Dwarven Resilience (adv. vs poison)"),
});
const stout = world.addHero({
  race: "stout_halfling", class: "rogue", level: 3,
  features: race("Stout Resilience (adv. vs poison, resistance to poison damage)"),
});

await test("F:M1: Gnome Cunning gives advantage on INT, WIS and CHA saves against magic.", async () => {
  const magic = await roll(gnome.id, { kind: "saving_throw", ability: "wis", against: "spell (hold person)", dc: 13 }, [3, 17]);
  assert.equal(magic.out.ok, true, magic.out.error);
  assert.equal(magic.faces.length, 2, "two d20s against a spell");
  const mundane = await roll(gnome.id, { kind: "saving_throw", ability: "wis", against: "a falling rock", dc: 13 }, [3]);
  assert.equal(mundane.faces.length, 1, "one d20 against something that is not magic");
  const dex = await roll(gnome.id, { kind: "saving_throw", ability: "dex", against: "spell", dc: 13 }, [3]);
  assert.equal(dex.faces.length, 1, "DEX saves are not covered");
});

await test("F:M2: Fey Ancestry gives advantage on saves against being charmed.", async () => {
  const charm = await roll(elf.id, { kind: "saving_throw", ability: "wis", against: "charmed", dc: 13 }, [3, 17]);
  assert.equal(charm.faces.length, 2);
  const plain = await roll(elf.id, { kind: "saving_throw", ability: "wis", against: "frightened", dc: 13 }, [3]);
  assert.equal(plain.faces.length, 1);
});

await test("F:M3: Dwarven and Stout Resilience give advantage on saves against poison.", async () => {
  const dwarfSave = await roll(dwarf.id, { kind: "saving_throw", ability: "con", against: "poisoned", dc: 13 }, [3, 17]);
  assert.equal(dwarfSave.faces.length, 2);
  const stoutSave = await roll(stout.id, { kind: "saving_throw", ability: "con", against: "poison", dc: 13 }, [3, 17]);
  assert.equal(stoutSave.faces.length, 2);
});

await test("C:G34: A save the server forces (aoe_damage, cast_at_player) passes what it resists, so racial save advantages apply.", async () => {
  await kit.fight(1);
  world.clearDice();
  world.diceLog();
  world.dice(3, 17, 2, 2);
  const out = await world.invoke("aoe_damage", {
    characterIds: [dwarf.id], saveAbility: "con", ability: "con", dc: 13, damage: "2d4", type: "poison", reason: "poison gas",
  });
  world.clearDice();
  await kit.endFight();
  assert.equal(out.ok, true, out.error);
  const saves = kit.lastRolls(3).filter((entry) => entry.kind === "saving_throw" && entry.characterId === dwarf.id);
  assert.equal(d20Faces(saves[0]).length, 2, "the dwarf's CON save against poison rolls two d20s");
});

// ---- barbarian and rage ----

const barbarian = world.addHero({
  class: "barbarian", level: 7, abilities: { str: 16, dex: 14 },
  features: klass("barbarian", "Rage", "Danger Sense", "Feral Instinct"),
  proficiencies: prof(),
});

await test("F:L1: Feral Instinct gives advantage on initiative.", async () => {
  const init = await roll(barbarian.id, { kind: "initiative" }, [3, 17]);
  assert.equal(init.faces.length, 2);
});

await test("F:L2: Danger Sense does not work while the barbarian is blinded, deafened or incapacitated.", async () => {
  reset(barbarian.id);
  const seeing = await roll(barbarian.id, { kind: "saving_throw", ability: "dex", dc: 13 }, [3, 17]);
  assert.equal(seeing.faces.length, 2, "Danger Sense still works when they can see");
  reset(barbarian.id, { conditions: ["blinded"] });
  const blind = await roll(barbarian.id, { kind: "saving_throw", ability: "dex", dc: 13 }, [3]);
  reset(barbarian.id);
  assert.equal(blind.faces.length, 1);
});

await test("F:L3: A raging barbarian in heavy armor gets no advantage on Strength checks.", async () => {
  reset(barbarian.id, {
    conditions: ["raging"],
    equipment: [{ name: "Plate Armor", equipped: true }],
  });
  const plate = await roll(barbarian.id, { kind: "ability_check", ability: "str", dc: 13 }, [3]);
  reset(barbarian.id, { conditions: ["raging"], equipment: [] });
  const bare = await roll(barbarian.id, { kind: "ability_check", ability: "str", dc: 13 }, [3, 17]);
  reset(barbarian.id);
  assert.equal(plate.faces.length, 1, "no rage advantage in plate");
  assert.equal(bare.faces.length, 2, "rage advantage without it");
});

// ---- feature-granted save proficiencies ----

await test("F:M8: Diamond Soul gives proficiency in every save; Slippery Mind in WIS saves.", async () => {
  const monk = world.addHero({
    class: "monk", level: 14, abilities: { int: 10, wis: 14, cha: 8, con: 12 },
    proficiencies: prof({ saves: ["str", "dex"] }), features: klass("monk", "Diamond Soul"),
  });
  const saves = computeSheetDerived(world.sheet(monk.id)).saves;
  const pb = proficiencyBonus(14);
  assert.equal(saves.int, 0 + pb);
  assert.equal(saves.cha, abilityMod(8) + pb);
  assert.equal(saves.con, abilityMod(12) + pb);
  const rogue = world.addHero({
    class: "rogue", level: 15, abilities: { wis: 12 },
    proficiencies: prof({ saves: ["dex", "int"] }), features: klass("rogue", "Slippery Mind"),
  });
  assert.equal(computeSheetDerived(world.sheet(rogue.id)).saves.wis, abilityMod(12) + proficiencyBonus(15));
});

// ---- Aura of Protection ----

const paladin = world.addHero({
  class: "paladin", level: 6, abilities: { cha: 16 },
  features: klass("paladin", "Aura of Protection"), proficiencies: prof(),
});

await test("F:M16: Outside a battle map the party stands together, and the paladin's aura covers every ally's saves.", async () => {
  // No encounter, so no map: the fighter's WIS save is d20 + WIS + the aura.
  const saved = await roll(dwarf.id, { kind: "saving_throw", ability: "wis", dc: 10 }, [5]);
  assert.equal(saved.stored.total, 5 + 0 + abilityMod(16));
  // An unconscious paladin projects nothing.
  world.patch(paladin.id, { currentHp: 0 });
  const down = await roll(dwarf.id, { kind: "saving_throw", ability: "wis", dc: 10 }, [5]);
  world.patch(paladin.id, { currentHp: 30 });
  assert.equal(down.stored.total, 5);
});

await test("F:L18: A paladin inside another paladin's aura adds only the larger bonus, and the aura's range follows paladin levels.", async () => {
  const second = world.addHero({
    class: "paladin", level: 6, abilities: { cha: 14 },
    features: klass("paladin", "Aura of Protection"), proficiencies: prof(),
  });
  // Own +2, the first paladin's +3: the larger, not the sum.
  const saved = await roll(second.id, { kind: "saving_throw", ability: "int", dc: 10 }, [5]);
  assert.equal(saved.stored.total, 5 + 0 + abilityMod(16));
  // A paladin 6 / fighter 12 is level 18 but has a 10 ft aura, not 30.
  const { auraRangeFeet } = await import("../src/lib/dm/aura.ts");
  assert.equal(auraRangeFeet({
    level: 18, class: "paladin", classes: [{ id: "paladin", level: 6 }, { id: "fighter", level: 12 }],
  }), 10);
});

// ---- tools, inspiration, items ----

const rogue = world.addHero({
  class: "rogue", level: 5, abilities: { dex: 16 },
  proficiencies: prof({ tools: ["Thieves' tools"], skills: ["stealth"] }),
});

await test("X:T1: A check with a tool the character is proficient in adds the proficiency bonus.", async () => {
  const picked = await roll(rogue.id, { kind: "ability_check", ability: "dex", tool: "thieves' tools", dc: 15 }, [10]);
  assert.equal(picked.out.ok, true, picked.out.error);
  assert.equal(picked.stored.total, 10 + 3 + 3);
  const other = await roll(rogue.id, { kind: "ability_check", ability: "dex", tool: "smith's tools", dc: 15 }, [10]);
  assert.equal(other.stored.total, 10 + 3);
});

await test("X:IN1: Inspiration is awarded by the DM, held on the sheet, and spent for advantage on one roll.", async () => {
  const refused = await world.invoke("request_roll", {
    characterId: rogue.id, kind: "skill_check", skill: "stealth", useInspiration: true, reason: "x",
  });
  assert.equal(refused.ok, false, "no inspiration held: refused");
  const award = await world.invoke("set_condition", { characterId: rogue.id, condition: "inspiration" });
  assert.equal(award.ok, true, award.error);
  assert.equal(world.sheet(rogue.id).resources.inspiration?.used, 0, "held");
  assert.ok(!world.sheet(rogue.id).conditions.includes("inspiration"), "not a condition");
  const spent = await roll(rogue.id, { kind: "skill_check", skill: "stealth", useInspiration: true }, [3, 17]);
  assert.equal(spent.faces.length, 2);
  assert.equal(world.sheet(rogue.id).resources.inspiration?.used, 1, "spent");
});

await test("X:GL1: Magic items with check riders apply them: Stone of Good Luck +1 to checks, Cloak of Elvenkind advantage on Stealth.", async () => {
  world.patch(rogue.id, {
    equipment: [
      { name: "Stone of Good Luck (Luckstone)", equipped: true, attuned: true },
      { name: "Cloak of Elvenkind", equipped: true, attuned: true },
    ],
  });
  const check = await roll(rogue.id, { kind: "ability_check", ability: "int", dc: 10 }, [5]);
  assert.equal(check.stored.total, 5 + 0 + 1);
  const sneak = await roll(rogue.id, { kind: "skill_check", skill: "stealth", dc: 10 }, [3, 17]);
  assert.equal(sneak.faces.length, 2);
  world.patch(rogue.id, { equipment: [] });
});

await test("X:OB1: Observant adds 5 to passive Investigation as well as passive Perception.", async () => {
  const watcher = world.addHero({ class: "wizard", level: 1, feats: ["Observant"], abilities: { int: 10 } });
  const derived = computeSheetDerived(world.sheet(watcher.id));
  assert.equal(derived.passiveInvestigation, 15);
  const out = await world.invoke("check_notice", {
    sense: "investigation", dc: 15, characterIds: [watcher.id], reason: "a false panel",
  });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.result.noticed ?? out.result.noticedBy, [world.sheet(watcher.id).name]);
});

// ---- contests and the long tail ----

await test("F:M20: A contest check (hide, grapple, shove) is rolled through the shared resolver, so Reliable Talent floors it.", async () => {
  const expert = world.addHero({
    class: "rogue", level: 11, abilities: { dex: 16 },
    features: klass("rogue", "Reliable Talent"), proficiencies: prof({ skills: ["stealth"] }),
  });
  const { rollCharacterCheck } = await import("../src/lib/dm/contest-roll.ts");
  world.clearDice();
  world.dice(2);
  const rolled = rollCharacterCheck(world.campaign(), world.sheet(expert.id), { skill: "stealth" }, "hide");
  world.clearDice();
  assert.equal(rolled.total, 10 + 3 + proficiencyBonus(11));
  assert.equal(kit.lastRolls(1)[0].total, rolled.total, "the contest roll is stored");
});

await test("F:L21: Indomitable Might: a Strength check total below the Strength score uses the score.", async () => {
  const mighty = world.addHero({
    class: "barbarian", level: 18, abilities: { str: 20 },
    features: klass("barbarian", "Indomitable Might"), proficiencies: prof(),
  });
  const low = await roll(mighty.id, { kind: "ability_check", ability: "str", dc: 20 }, [2]);
  assert.equal(low.stored.total, 20);
});

await test("F:L21: Countercharm gives advantage on saves against being charmed or frightened while it lasts", async () => {
  reset(rogue.id, { conditions: ["countercharm"], conditionMeta: { countercharm: { rounds: 1 } } });
  const charmed = await roll(rogue.id, { kind: "saving_throw", ability: "wis", against: "charmed", dc: 13 }, [3, 17]);
  reset(rogue.id);
  const plain = await roll(rogue.id, { kind: "saving_throw", ability: "wis", against: "charmed", dc: 13 }, [3]);
  assert.equal(charmed.faces.length, 2);
  assert.equal(plain.faces.length, 1);
});

world.close();
finish();
