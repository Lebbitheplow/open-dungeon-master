// Issue 474: mcerina's audit of the 117 authored subclasses
// (src/lib/srd/subclasses.json). Features at the wrong level or missing,
// patron spells handed out free, choice-gated spells granted whole, uses
// that never came back, and features with a number in their text that no
// engine read (its Appendix B). The tables are held to the published level
// structure here, and a representative of each new engine hook is proved
// through the engine (world.invoke).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-subclass-audit-474");

const features = await import("../src/lib/srd/features.ts");
const training = await import("../src/lib/srd/subclass-training.ts");
const effects = await import("../src/lib/srd/feature-effects.ts");
const { authoredCoverage } = await import("../src/lib/srd/authored-coverage.ts");
const { longRestPatch } = await import("../src/lib/dm/rest-logic.ts");

const at = (classId, subclass, level) => features.classFeaturesFor(classId, subclass, level).map((feature) => feature.name);
const arrivesAt = (classId, subclass, name) => {
  for (let level = 1; level <= 20; level += 1) {
    if (at(classId, subclass, level).includes(name)) {
      return level;
    }
  }
  return null;
};

// ---- the tables ----

await test("Path of the Giant: Giant's Power and Giant's Havoc at 3, Elemental Cleaver 6, Mighty Impel 10, Demiurgic Colossus 14.", () => {
  const giant = (name) => arrivesAt("barbarian", "Path of the Giant", name);
  assert.deepEqual(
    ["Giant's Power", "Giant's Havoc", "Elemental Cleaver", "Mighty Impel", "Demiurgic Colossus"].map(giant),
    [3, 3, 6, 10, 14],
  );
  assert.equal(giant("Elemental Fury"), null, "no such feature");
});

await test("Features at their published levels, under their published names.", () => {
  assert.equal(arrivesAt("sorcerer", "Storm Sorcery", "Storm Guide"), 6);
  assert.equal(arrivesAt("bard", "College of Eloquence", "Universal Speech"), 6);
  assert.equal(arrivesAt("fighter", "Battle Master", "Improved Combat Superiority"), 10);
  assert.equal(arrivesAt("cleric", "Light Domain", "Improved Flare"), 6);
  assert.equal(arrivesAt("wizard", "School of Illusion", "Malleable Illusions"), 6);
  assert.equal(arrivesAt("warlock", "The Fathomless", "Tentacle of the Deeps"), 1);
  const lunar = (name) => arrivesAt("sorcerer", "Lunar Sorcery", name);
  assert.deepEqual(
    ["Lunar Embodiment", "Moon Fire", "Lunar Boons", "Waxing and Waning", "Lunar Empowerment", "Lunar Phenomenon"].map(lunar),
    [1, 1, 6, 6, 14, 18],
  );
});

await test("A patron's expanded spells join the warlock's list; they are not handed out known.", () => {
  assert.equal(features.subclassSpellsFor("warlock", "The Fiend", 5).includes("Burning Hands"), false);
  assert.ok(features.subclassExpandedSpellsFor("warlock", "The Fiend", 5).includes("Burning Hands"));
  assert.ok(features.subclassExpandedSpellsFor("warlock", "The Fathomless", 9).includes("Cone of Cold"));
  // The Celestial's two cantrips are known outright.
  assert.deepEqual(features.subclassSpellsFor("warlock", "The Celestial", 1).sort(), ["Light", "Sacred Flame"]);
});

await test("Spells gated on a choice come with the choice: a Land druid's terrain, a Divine Soul's affinity, a Genie's kind.", () => {
  const land = (terrain) => features.subclassSpellsFor("druid", "Circle of the Land", 3, undefined, [{ name: `Circle Spells (${terrain})` }]);
  assert.ok(land("Arctic").includes("Hold Person"));
  assert.equal(land("Arctic").includes("Mirror Image"), false, "a coast spell is not an arctic druid's");
  assert.equal(features.subclassSpellsFor("druid", "Circle of the Land", 3).includes("Hold Person"), false, "no terrain, no circle spells");
  const soul = features.subclassSpellsFor("sorcerer", "Divine Soul", 1, undefined, [{ name: "Divine Magic (Good)" }]);
  assert.ok(soul.includes("Cure Wounds"));
  assert.equal(soul.includes("Inflict Wounds"), false);
  assert.deepEqual(features.subclassSpellListsFor("sorcerer", "Divine Soul"), ["cleric"]);
  const genie = features.subclassExpandedSpellsFor("warlock", "The Genie", 3, undefined, [{ name: "Genie's Vessel (Efreeti)" }]);
  assert.ok(genie.includes("Burning Hands"), "the efreeti's own spell");
  assert.equal(genie.includes("Thunderwave"), false, "the djinni's is not");
});

await test("The cantrips a feature teaches are on its spell table.", () => {
  assert.ok(features.subclassSpellsFor("cleric", "Light Domain", 1).includes("Light"));
  assert.ok(features.subclassSpellsFor("bard", "College of Spirits", 3).includes("Guidance"));
  assert.ok(features.subclassSpellsFor("ranger", "Swarmkeeper", 3).includes("Mage Hand"));
  assert.ok(features.subclassSpellsFor("ranger", "Drakewarden", 3).includes("Thaumaturgy"));
  assert.ok(features.subclassSpellsFor("wizard", "School of Illusion", 2).includes("Minor Illusion"));
});

await test("A language a feature teaches is trained; one already spoken becomes a pick of another.", () => {
  const grant = (classId, subclass, level) => training.subclassGrants([{ id: classId, subclass, level }]);
  assert.deepEqual(grant("druid", "Circle of the Shepherd", 2)[0].spec.fixedLanguages, ["Sylvan"]);
  assert.deepEqual(grant("sorcerer", "Storm Sorcery", 1)[0].spec.fixedLanguages, ["Primordial"]);
  const dragon = grant("monk", "Way of the Ascendant Dragon", 3);
  assert.deepEqual(dragon[0].spec.fixedLanguages, ["Draconic"]);
  const [spoken] = training.grantsForHeldTraining(dragon, { skills: [], languages: ["Common", "Draconic"] });
  assert.deepEqual([spoken.spec.fixedLanguages, spoken.spec.languages], [[], 1]);
  // Settled grants change no more on a second pass.
  assert.deepEqual(training.grantsForHeldTraining([spoken], { skills: [], languages: ["Draconic"] })[0].spec.languages, 1);
});

await test("A College of Swords bard picks a fighting style, Dueling or Two-Weapon Fighting only.", () => {
  const blade = features.classFeaturesFor("bard", "College of Swords", 3);
  assert.equal(effects.fightingStyleSlots(blade), 1);
  assert.deepEqual(effects.fightingStyleChoices(blade).map((style) => style.id).sort(), ["dueling", "two_weapon_fighting"]);
  assert.equal(effects.fightingStyleChoices(features.classFeaturesFor("fighter", "Champion", 1)).length, effects.FIGHTING_STYLES.length);
  // Archery on a Swords bard is not kept.
  const kept = features.populateFeaturesForClasses(
    [{ name: "Fighting Style: Archery", source: "choice" }, { name: "Fighting Style: Dueling", source: "choice" }],
    [{ id: "bard", subclass: "College of Swords", level: 3 }],
    "human",
  ).map((feature) => feature.name);
  assert.ok(kept.includes("Fighting Style: Dueling"));
  assert.equal(kept.includes("Fighting Style: Archery"), false);
});

await test("A chosen option survives the level-up regrant (Totem Spirit (Bear) at barbarian 4).", () => {
  const held = features.populateFeaturesForClasses([], [{ id: "barbarian", subclass: "Path of the Totem Warrior", level: 3 }], "human")
    .map((feature) => (feature.name === "Totem Spirit" ? { ...feature, name: "Totem Spirit (Bear)" } : feature));
  const after = features.populateFeaturesForClasses(held, [{ id: "barbarian", subclass: "Path of the Totem Warrior", level: 4 }], "human");
  assert.ok(after.some((feature) => feature.name === "Totem Spirit (Bear)"), after.map((feature) => feature.name).join(", "));
});

await test("Resistance to nonmagical damage is not read as resistance to all of it.", () => {
  const read = effects.effectsFor({ class: "cleric", features: [{ name: "Avatar of Battle", classId: "cleric" }] });
  assert.equal(read.some((entry) => entry.effect.kind === "resistance"), false);
});

await test("A feature another engine applies names the call that applies it, and the call is there.", async () => {
  const { readFileSync } = await import("node:fs");
  const { AUTHORED_TABLE } = await import("../src/lib/srd/authored-effects.ts");
  const missing = Object.entries(AUTHORED_TABLE)
    .filter(([, entry]) => entry.heldBy && !readFileSync(new URL(`../${entry.heldBy.file}`, import.meta.url), "utf8").includes(entry.heldBy.call))
    .map(([key]) => key);
  assert.deepEqual(missing, []);
});

await test("Every authored feature with a mechanical word has a hook, a counter, training or a written reason.", () => {
  const coverage = authoredCoverage();
  assert.deepEqual(coverage.uncovered, []);
  assert.deepEqual(coverage.stale, []);
  // Appendix B's own examples.
  for (const key of ["cleric::Potent Spellcasting", "paladin::Aura of Hate", "wizard::Song of Victory", "wizard::Tactical Wit", "bard::Silver Tongue", "ranger::Umbral Sight"]) {
    assert.ok(coverage.typed.includes(key), key);
  }
});

// ---- through the engine ----

const world = await openWorld({ campaign: { maxPlayers: 40 } });
const kit = await combatKit(world);
const hero = (overrides) => world.addHero({ maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" }, ...overrides });
const hp = (who) => world.sheet(who.id).currentHp;
const enemyHp = (enemy) => world.enemies().find((entry) => entry.id === enemy.id).currentHp;
const spend = (who, resource, args = {}) => world.invoke("use_resource", { characterId: who.id, resource, ...args });
const react = (who, feature, args = {}) => world.invoke("use_reaction", { characterId: who.id, feature, ...args });

async function stage(first) {
  await kit.endFight();
  const heroFaces = Object.fromEntries(world.sheets().map((entry) => [entry.id, entry.id === first.id ? 19 : 3]));
  await kit.fight(1, { heroFaces });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(first.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(first.id);
  return enemy;
}

// The damage one hit of the hero's deals, the dice set.
async function hitFor(who, faces) {
  const enemy = await stage(who);
  const out = await kit.swing(who.id, enemy.id, faces);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.hit, true);
  return 300 - enemyHp(enemy);
}

await test("Aura of Hate adds the paladin's Charisma modifier to melee weapon damage.", async () => {
  const kit16 = { abilities: { str: 16, cha: 16 }, equipment: [{ name: "Longsword", qty: 1 }] };
  const oathbreaker = hero({ class: "paladin", subclass: "Oathbreaker", level: 7, ...kit16 });
  const devoted = hero({ class: "paladin", subclass: "Oath of Devotion", level: 7, ...kit16 });
  assert.equal((await hitFor(oathbreaker, [18, 4])) - (await hitFor(devoted, [18, 4])), abilityMod(16));
});

await test("Silver Tongue: a Persuasion check's d20 counts as at least 10.", async () => {
  const eloquent = hero({ class: "bard", subclass: "College of Eloquence", level: 3 });
  const lore = hero({ class: "bard", subclass: "College of Lore", level: 3 });
  await kit.endFight();
  const check = async (who) => {
    world.clearDice();
    world.dice(3);
    const out = await world.invoke("request_roll", { characterId: who.id, kind: "skill_check", skill: "persuasion", reason: "a bargain" });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    return out.result.total;
  };
  assert.equal((await check(eloquent)) - (await check(lore)), 7);
});

await test("Tactical Wit adds the wizard's Intelligence modifier to initiative.", async () => {
  const war = hero({ class: "wizard", subclass: "War Magic", level: 2, abilities: { int: 16 } });
  const evoker = hero({ class: "wizard", subclass: "School of Evocation", level: 2, abilities: { int: 16 } });
  await kit.endFight();
  const initiative = async (who) => {
    world.clearDice();
    world.dice(10);
    const out = await world.invoke("request_roll", { characterId: who.id, kind: "initiative", reason: "ambush" });
    world.clearDice();
    return out.result.total;
  };
  assert.equal((await initiative(war)) - (await initiative(evoker)), abilityMod(16));
});

await test("Hexblade's Curse: the cursed creature takes the proficiency bonus in damage and is crit on a 19.", async () => {
  const hexblade = hero({ class: "warlock", subclass: "The Hexblade", level: 1, abilities: { str: 14 }, equipment: [{ name: "Longsword", qty: 1 }] });
  const plain = await hitFor(hexblade, [18, 4]);
  const enemy = await stage(hexblade);
  const curse = await spend(hexblade, "Hexblade's Curse", { targetEnemyId: enemy.id });
  assert.equal(curse.ok, true, curse.error);
  kit.freshTurn();
  const out = await kit.swing(hexblade.id, enemy.id, [18, 4]);
  assert.equal(out.ok, true, out.error);
  assert.equal(300 - enemyHp(enemy), plain + 2, "+2, the proficiency bonus at warlock 1");
  kit.freshTurn();
  const crit = await kit.swing(hexblade.id, enemy.id, [19, 4, 4]);
  assert.equal(crit.result.crit, true, "a 19 is a critical hit against the cursed creature");
});

await test("Spirit Shield with Vengeful Ancestors: the damage it prevents strikes the attacker as force.", async () => {
  const warden = hero({ class: "barbarian", subclass: "Path of the Ancestral Guardian", level: 14 });
  const friend = hero({ class: "fighter", level: 6 });
  const enemy = await stage(friend);
  world.patch(friend.id, { currentHp: 60, ac: 12, acOverride: true, conditions: [], tempHp: 0 });
  kit.place(warden.id, 7, 5);
  world.patch(warden.id, { conditions: ["raging"], conditionMeta: { raging: { rounds: 10 } } });
  kit.freshRound();
  world.dice(15, 6);
  const swing = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: friend.id });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  const hurt = 60 - hp(friend);
  assert.ok(hurt > 0 && hurt <= 12, `the hit lands for ${hurt}`);
  const before = enemyHp(enemy);
  world.dice(3, 3, 3, 3);
  const out = await react(warden, "Spirit Shield", { targetCharacterId: friend.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(friend), 60, "4d6 (12) covers the hit");
  assert.equal(before - enemyHp(enemy), hurt, "the attacker takes the force damage prevented");
});

await test("Limited Wish comes back only after 1d4 long rests, the count kept on the sheet.", async () => {
  const genie = hero({ class: "warlock", subclass: "The Genie", level: 14 });
  await kit.endFight();
  world.dice(3);
  const out = await spend(genie, "Limited Wish");
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  let sheet = world.sheet(genie.id);
  assert.equal(sheet.resources.sub_limited_wish.used, 1);
  assert.ok(sheet.conditions.includes("limited wish recovering (3)"), sheet.conditions.join(", "));
  for (let night = 1; night < 3; night += 1) {
    sheet = { ...sheet, ...longRestPatch(sheet) };
    assert.equal(sheet.resources.sub_limited_wish.used, 1, `still spent after ${night} of 3 rests`);
  }
  sheet = { ...sheet, ...longRestPatch(sheet) };
  assert.equal(sheet.resources.sub_limited_wish.used, 0);
  assert.equal(sheet.conditions.some((entry) => entry.startsWith("limited wish recovering")), false);
});

await test("Hexblade's Curse laid outside a fight is paid and left to the story.", async () => {
  const hexblade = hero({ class: "warlock", subclass: "The Hexblade", level: 1 });
  await kit.endFight();
  const out = await spend(hexblade, "Hexblade's Curse");
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hexblade.id).resources.sub_hexblades_curse.used, 1);
});

await test("Bond of Fang and Scale: the ranger resists the damage of the drake's essence.", async () => {
  const warden = hero({ class: "ranger", subclass: "Drakewarden", level: 7 });
  await kit.endFight();
  const chose = await spend(warden, "Drake Essence", { variant: "fire" });
  assert.equal(chose.ok, true, chose.error);
  world.patch(warden.id, { currentHp: 60, tempHp: 0 });
  await world.invoke("apply_damage", { characterId: warden.id, amount: 10, type: "fire" });
  await world.invoke("apply_damage", { characterId: warden.id, amount: 10, type: "cold" });
  assert.equal(hp(warden), 60 - 5 - 10);
});

await test("Hearth of Moonlight and Shadow: +5 to Stealth and Perception for the camp.", async () => {
  const dreamer = hero({ class: "druid", subclass: "Circle of Dreams", level: 6 });
  await kit.endFight();
  const lit = await spend(dreamer, "Hearth of Moonlight and Shadow");
  assert.equal(lit.ok, true, lit.error);
  const check = async (skill) => {
    world.clearDice();
    world.dice(10);
    const out = await world.invoke("request_roll", { characterId: dreamer.id, kind: "skill_check", skill, reason: "the watch" });
    world.clearDice();
    return out.result.total;
  };
  const stealth = await check("stealth");
  const arcana = await check("arcana");
  world.patch(dreamer.id, { conditions: [], conditionMeta: {} });
  assert.equal(stealth - (await check("stealth")), 5);
  assert.equal(arcana - (await check("arcana")), 0, "only Stealth and Perception");
});

await test("Expert Divination: a divination spell of 2nd level or higher gives back a lower spent slot.", async () => {
  const seer = hero({
    class: "wizard", subclass: "School of Divination", level: 6, abilities: { int: 16 },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 2 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 } }, prepared: ["See Invisibility", "Detect Thoughts"], known: [], cantrips: [] },
  });
  await kit.endFight();
  const out = await world.invoke("cast_buff", { characterId: seer.id, spell: "See Invisibility", level: 2 });
  assert.equal(out.ok, true, out.error);
  const slots = world.sheet(seer.id).spellcasting.slots;
  assert.deepEqual([slots["2"].used, slots["1"].used], [1, 1], "the 2nd-level slot spent, a 1st-level slot back");
});

finish();
