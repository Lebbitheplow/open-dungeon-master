// What a content pack's stat block says, read the way the engine runs it
// (issue 473): the defence lines every book prints its own way (Black
// Flag's traits and conditions among its damage lines, Tome of Beasts
// 2023's "False", Tome of Beasts 3's "nonmagic B/P/S", A5e's "damage from
// nonmagical weapons", conditions by other names), the clauses that hold
// only for a magic weapon, a good wielder or a spell, the Bonus Actions
// section, a swarm's weaker bite at half its hit points, the kind, reach and
// range a line misprints, Tome of Beasts 3's bracketed saves, speeds, sizes,
// subtypes, habitats, passive Perception and a lair's printed options. The
// blocks are written out below in the pack's shape, so the suite runs
// without the pack as CI does; with it, every block in the pack is swept.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { monsterKit } from "./lib/enforce-monsters.mjs";

const { test, finish } = suite("test-statblock-readings");
const world = await openWorld();
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const { parseMonster, passivePerceptionFor, keenSensesOf } = await import("../src/lib/bestiary/statblock.ts");
const { readDefences, conditionWord } = await import("../src/lib/bestiary/defences.ts");
const { correctedMonsterData } = await import("../src/lib/bestiary/pack-corrections.ts");
const { parseAttack } = await import("../src/lib/bestiary/attack-parse.ts");
const { damageAdjust } = await import("../src/lib/dm/damage-logic.ts");
const { conditionSaveLean } = await import("../src/lib/dm/forced-save.ts");
const { isShapechanger } = await import("../src/lib/dm/enemy-polymorph-logic.ts");
const { alternativeBlow } = await import("../src/lib/dm/enemy-profile.ts");
const { checkMonsterDraft } = await import("../src/lib/bestiary/monster-draft.ts");
const { getContentDb } = await import("../src/lib/content/db.ts");
const { parseSaveEffect } = await import("../src/lib/dm/save-effect.ts");
const { hasTrait, ENGINE_TRAIT_NAMES } = await import("../src/lib/dm/monster-abilities.ts");
const { sunlightBurn } = await import("../src/lib/dm/sunlight-turn.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const block = (row, cr = 1) => parseMonster(row, cr);
const hit = (stats, amount, type, options) => damageAdjust(amount, type, stats.resist, stats.immune, stats.vulnerable, options).amount;
const attack = (desc, extra = {}) => parseAttack({ name: "Attack", desc, ...extra });

// ---- defences ----

await test("Black Flag's trait named in a damage line is read for what it says: a devil resists cold and nonmagical weapons and is immune to fire, poison and the poisoned condition.", () => {
  const imp = block({
    document__slug: "blackflag", slug: "imp_bf", damage_resistances: "Devilish Resilience", damage_immunities: "Devilish Resilience",
    special_abilities: [{ name: "Devilish Resilience", desc: "The devil is resistant to cold damage and to bludgeoning, piercing, and slashing damage from nonmagical attacks. In addition, it is immune to fire damage and poison damage and to the poisoned condition." }],
  });
  assert.equal(hit(imp, 10, "cold"), 5);
  assert.equal(hit(imp, 10, "slashing"), 5);
  assert.equal(hit(imp, 10, "slashing", { magical: true }), 10);
  assert.equal(hit(imp, 10, "fire"), 0);
  assert.equal(hit(imp, 10, "poison"), 0);
  assert.equal(imp.conditionImmune, "poisoned");
  assert.doesNotMatch(`${imp.resist} ${imp.immune}`, /Resilience/);
});

await test("Black Flag's conditions among its damage lines are conditions: immunity to the poisoned condition, and resistance (advantage on the save) to charmed and frightened.", () => {
  const dragon = block({
    document__slug: "blackflag", slug: "x", damage_immunities: "poison,poisoned", damage_resistances: "charmed,frightened", damage_vulnerabilities: "Giant Attributes",
    special_abilities: [{ name: "Giant Attributes", desc: "The giant is resistant to the stunned condition, and it is vulnerable to the prone condition." }],
  });
  assert.equal(dragon.immune, "poison");
  assert.equal(dragon.conditionImmune, "poisoned");
  assert.equal(dragon.conditionResist, "charmed, frightened, stunned");
  assert.equal(dragon.conditionVulnerable, "prone");
  assert.deepEqual(conditionSaveLean(dragon, "frightened"), ["advantage"]);
  assert.deepEqual(conditionSaveLean(dragon, ["prone"]), ["disadvantage"]);
  assert.deepEqual(conditionSaveLean(dragon, "restrained"), []);
  assert.deepEqual(conditionSaveLean({}, "frightened"), []);
});

await test("Tome of Beasts 2023's \"False\" in an empty field is no defence, and the DM is never told the creature resists false.", () => {
  const row = { document__slug: "tob-2023", slug: "x", damage_resistances: "False", damage_vulnerabilities: "False", condition_immunities: "False", damage_immunities: "fire" };
  const stats = block(row);
  assert.deepEqual([stats.resist, stats.vulnerable, stats.conditionImmune, stats.immune], ["", "", "", "fire"]);
});

await test("Tome of Beasts 3's \"nonmagic B/P/S attacks\" and A5e's \"damage from nonmagical, non-silvered weapons\" cover nonmagical weapons only, and a silvered weapon passes the second.", () => {
  const angel = block({ document__slug: "tob3", slug: "x", damage_resistances: "radiant; nonmagic B/P/S attacks" });
  assert.equal(hit(angel, 10, "bludgeoning"), 5);
  assert.equal(hit(angel, 10, "bludgeoning", { magical: true }), 10);
  const were = block({ document__slug: "menagerie", slug: "x", damage_immunities: "damage from nonmagical, non-silvered weapons" });
  assert.equal(hit(were, 10, "piercing"), 0);
  assert.equal(hit(were, 10, "piercing", { silvered: true }), 10);
  assert.equal(hit(were, 10, "piercing", { magical: true }), 10);
  assert.equal(hit(were, 10, "fire"), 10);
  const demon = block({ document__slug: "menagerie", slug: "x", damage_resistances: "cold, lightning; damage from nonmagical weapons" });
  assert.equal(hit(demon, 10, "slashing"), 5);
  assert.equal(hit(demon, 10, "cold"), 5);
  // The SRD archmage's "non magical" (stoneskin) is nonmagical too.
  const archmage = block({ damage_resistances: "damage from spells; non magical bludgeoning, piercing, and slashing (from stoneskin)" });
  assert.equal(hit(archmage, 10, "slashing", { magical: true }), 10);
  assert.equal(hit(archmage, 10, "slashing"), 5);
});

await test("A clause that holds only for some blows: the rakshasa's piercing from magic weapons wielded by good creatures, an archmage's damage from spells, a vulnerability to silvered weapons.", () => {
  const rakshasa = block({ damage_vulnerabilities: "piercing from magic weapons wielded by good creatures" });
  assert.equal(hit(rakshasa, 10, "piercing"), 10);
  assert.equal(hit(rakshasa, 10, "piercing", { magical: true }), 10);
  assert.equal(hit(rakshasa, 10, "piercing", { magical: true, goodWielder: true }), 20);
  const archmage = block({ damage_resistances: "damage from spells; non magical bludgeoning, piercing, and slashing (from stoneskin)" });
  assert.equal(hit(archmage, 10, "fire", { magical: true, spell: true }), 5);
  assert.equal(hit(archmage, 10, "fire", { magical: true }), 10);
  assert.equal(hit(archmage, 10, undefined, { spell: true }), 5);
  const shade = block({ document__slug: "tob", slug: "x", damage_vulnerabilities: "radiant; silvered weapons" });
  assert.equal(hit(shade, 10, "slashing"), 10);
  assert.equal(hit(shade, 10, "slashing", { silvered: true }), 20);
  assert.equal(hit(shade, 10, "radiant"), 20);
  const cc = block({ damage_resistances: "piercing damage from magical attacks" });
  assert.equal(hit(cc, 10, "piercing"), 10);
  assert.equal(hit(cc, 10, "piercing", { magical: true }), 5);
});

await test("Condition immunities in other words are the SRD's conditions, so the immunity holds: fatigue, exhausted, paralysis, blindness, a missing comma.", () => {
  const stats = block({ condition_immunities: "fatigue, paralysis, blindness, prone poisoned, exhausted" });
  assert.equal(stats.conditionImmune, "exhaustion, paralyzed, blinded, prone, poisoned");
  assert.equal(conditionWord("Blind"), "blinded");
  assert.equal(conditionWord("charmed (with mind blank)"), "charmed");
  assert.equal(conditionWord("goblin"), null);
  // A damage type filed with the conditions is a damage immunity.
  assert.equal(block({ condition_immunities: "lightning, charmed" }).immune, "lightning");
  assert.deepEqual(readDefences({ damage_resistances: "lighting; piericing and slashing from nomagical attacks" }, []).resist, "lightning; piercing and slashing from nonmagical attacks");
});

// ---- the block's other lines ----

await test("The walking speed is read first whatever order the row lists its modes, Tome of Beasts 3's \"bur.\" is a burrow, and a werecreature's animal form keeps its speed.", () => {
  assert.equal(block({ speed: { fly: 80, walk: 40 } }).speed, "40, fly 80");
  assert.equal(block({ speed: { walk: 20, "bur.": 20 } }).speed, "20, burrow 20");
  assert.equal(block({ speed: { walk: 30, notes: "40 ft. in wolf form" } }).speed, "30 (40 ft. in wolf form)");
  // With no walking speed the first mode is still the one it moves by.
  assert.equal(block({ speed: { fly: 40, hover: true } }).speed, "fly 40");
});

await test("A5e's Titanic is Gargantuan to the board; a subtype is kept and a shapechanger in it is one; the SRD's habitats are the workshop's; Black Flag's passive Perception is its own field.", () => {
  assert.equal(block({ size: "Titanic" }).size, "Gargantuan");
  const succubus = block({ type: "Fiend", subtype: "shapechanger" });
  assert.equal(succubus.subtype, "shapechanger");
  assert.equal(isShapechanger(succubus), true);
  assert.equal(block({ type: "Humanoid (human, shapechanger)" }).subtype, "human, shapechanger");
  assert.deepEqual(block({ environments: ["Underdark", "Forest", "Abyss", "Hills"] }).environment, ["underdark", "forest", "hill"]);
  const aboleth = block({ document__slug: "blackflag", slug: "aboleth_bf", wisdom: 22, perception: 20, senses: "darkvision 120 ft." });
  assert.equal(passivePerceptionFor(aboleth), 20);
  // Another book's perception field is the skill's bonus, not the passive.
  assert.equal(passivePerceptionFor(block({ document__slug: "tob", slug: "x", wisdom: 12, perception: 3, skills: { perception: 3 } })), 13);
  assert.deepEqual(keenSensesOf({ traits: ["Keen Scent: The kamaitachi has advantage on Wisdom (Perception) checks that rely on smell."] }), ["smell"]);
});

await test("A Bonus Actions section is read: its attack joins the block's, marked, the rest are lines the DM reads, the printed block keeps the section, and a Multiattack never plans a bonus action's swing.", () => {
  const goblin = block({
    document__slug: "blackflag", slug: "x",
    actions: [
      { name: "Multiattack", desc: "The boss makes two scimitar attacks." },
      { name: "Scimitar", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6+2) slashing damage." },
    ],
    bonus_actions: [
      { name: "Quick Bite", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 4 (1d4+2) piercing damage." },
      { name: "Nimble Escape", desc: "The boss takes the Disengage or Hide action." },
    ],
  });
  assert.deepEqual(goblin.attacks.map((entry) => [entry.name, entry.bonusAction === true]), [["Scimitar", false], ["Quick Bite", true]]);
  assert.ok(goblin.traits.includes("Bonus action: Nimble Escape. The boss takes the Disengage or Hide action."));
  assert.ok(goblin.fullTraits.includes("Bonus action: Nimble Escape: The boss takes the Disengage or Hide action."));
  assert.deepEqual(goblin.printed.bonus.map((entry) => [entry.name, entry.engine]), [["Quick Bite", "runs"], ["Nimble Escape", "text"]]);
  assert.deepEqual(goblin.routines, [[{ attack: "Scimitar", count: 2 }]]);
  // A copy in the workshop keeps the bonus action's attack as one.
  const draft = checkMonsterDraft({ name: "Boss copy", ...goblin });
  assert.equal(draft.draft.stats.attacks.find((entry) => entry.name === "Quick Bite").bonusAction, true);
});

await test("A stored block keeps every attack a pack prints: Black Flag's pit fiend keeps its fifth, Hurl Flame.", () => {
  const row = { actions: ["Bite", "Claw", "Mace", "Tail", "Hurl Flame"].map((name, index) => ({ name, desc: `Melee Weapon Attack: +14 to hit, reach 5 ft., one target. Hit: 15 (2d6 + 8) slashing damage.`, index })) };
  assert.equal(block(row).attacks.length, 5);
});

// ---- attack lines ----

await test("A swarm's weaker bite at half its hit points is an alternative blow, a reach of 0 is kept, and the engine deals the weaker bite once the swarm is bloodied.", () => {
  const bites = attack("Melee Weapon Attack: +2 to hit, reach 0 ft., one target in the swarm's space. Hit: 7 (2d6) piercing damage, or 3 (1d6) piercing damage if the swarm has half of its hit points or fewer.");
  assert.equal(bites.reach, 0);
  assert.equal(bites.damage, "2d6");
  assert.deepEqual(bites.alternatives, [{ when: "bloodied", damage: "1d6", type: "piercing" }]);
  assert.equal(alternativeBlow(bites, { ranged: false, bloodied: true }).damage, "1d6");
  assert.equal(alternativeBlow(bites, { ranged: false, bloodied: false }).damage, "2d6");
  // An alternative with riders of its own, and one that names no type.
  const brood = attack("Melee Weapon Attack: +5 to hit, reach 0 ft., one creature in the swarm's space. Hit: 14 (4d6) piercing damage plus 18 (4d8) force damage, or 7 (2d6) piercing damage plus 9 (2d8) force damage if the insatiable brood has half its HP or fewer.");
  assert.equal(brood.damage, "4d6+4d8");
  assert.deepEqual(brood.alternatives, [{ when: "bloodied", damage: "2d6+2d8", type: "piercing/force", riders: [{ dice: "2d8", type: "force" }] }]);
  assert.deepEqual(attack("Ranged Weapon Attack: +3 to hit, range 20/40 ft. Hit: 10 (4d4) piercing damage, or 5 (2d4) if the bar brawl has half its hit points or fewer.").alternatives, [{ when: "bloodied", damage: "2d4", type: "piercing" }]);
  // At range.
  assert.deepEqual(attack("Melee or Ranged Weapon Attack: +4 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 6 (1d6 + 3) piercing damage in melee or 5 (1d6 + 2) piercing damage at range.").alternatives, [{ when: "ranged", damage: "1d6+2", type: "piercing" }]);
});

await test("A blow the engine cannot tell apart (two hands, a charge) is listed for the DM, and a rider after its condition still rides the hit.", () => {
  const azer = attack("Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8+3) bludgeoning damage, or 8 (1d10+3) bludgeoning damage if used with two hands, plus 3 (1d6) fire damage.", { damage_dice: "1d8", damage_bonus: 3 });
  assert.equal(azer.damage, "1d8+3+1d6");
  assert.equal(azer.type, "bludgeoning/fire");
  assert.deepEqual(azer.onHit.manual, ["or 8 (1d10+3) bludgeoning damage if used with two hands"]);
  const koschei = attack("Melee Weapon Attack: +12 to hit, reach 5 ft., one target. Hit: 10 (1d8 + 6) slashing damage or 11 (1d10 + 6) slashing damage if used in two hands plus 14 (4d6) necrotic damage.", { damage_dice: "1d8", damage_bonus: 6 });
  assert.equal(koschei.damage, "1d8+6+4d6");
  assert.equal(attack("Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 6 (1d6 + 3) piercing damage  or 10 (2d6 + 3) damage if the peryton moves at least 20 feet straight towards the target before the attack.").onHit.manual[0], "or 10 (2d6 + 3) damage if the peryton moves at least 20 feet straight towards the target before the attack");
});

await test("A line's kind, reach and range are read through its misprints.", () => {
  const read = (desc) => { const parsed = attack(desc); return [parsed.mode, parsed.reach ?? null, parsed.range ?? null]; };
  assert.deepEqual(read("Ranged Spell Attack: +5 to hit, ranged 60 ft., one target. Hit: 12 (3d6+2) fire damage."), ["ranged", null, { normal: 60, long: 60 }]);
  assert.deepEqual(read("Ranged Weapon Attack: +5 to hit, range 30/90 feet, one target. Hit: 7 (1d8 + 3) acid damage."), ["ranged", null, { normal: 30, long: 90 }]);
  assert.deepEqual(read("Ranged Weapon Attack: +4 to hit, range 80/320, one target. Hit: 8 (1d8 + 2) piercing damage."), ["ranged", null, { normal: 80, long: 320 }]);
  assert.deepEqual(read("Melee Weapon Attack: +7 to hit, range 5 ft., one target. Hit: 8 (1d8 + 4) slashing damage."), ["melee", 5, null]);
  assert.deepEqual(read("Melee Weapon Attack: +6 to hit, range 120/600 ft., one target. Hit: 7 (1d8 + 3) piercing damage."), ["ranged", null, { normal: 120, long: 600 }]);
  assert.deepEqual(read("Melee Weapon or Ranged Attack: +5 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 5 (1d6+2) piercing damage."), ["both", 5, { normal: 20, long: 60 }]);
  assert.deepEqual(read("Attack: +4 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 4 (1d4 + 2) piercing damage."), ["both", 5, { normal: 20, long: 60 }]);
  assert.deepEqual(read("Melee Weapon Attack: +6 to hit, reach 5 feet., one target. Hit: 12 (2d8 + 3) bludgeoning damage."), ["melee", 5, null]);
  assert.deepEqual(read("Melee Weapon Attack: +8 to hit 5.' one target 12 (2d6+5) slashing damage."), ["melee", 5, null]);
  assert.deepEqual(read("Melee Weapon Damage: +5 to hit, reach 5 ft., one target. Hit: 5 (1d4 + 3) piercing damage."), ["melee", 5, null]);
  const shillelagh = attack("Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) magical bludgeoning damage.");
  assert.deepEqual([shillelagh.type, shillelagh.magical], ["bludgeoning", true]);
});

await test("What a hit does that no engine models is said to the DM: dice no damage type names, a push.", () => {
  const chort = attack("Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 9 (1d10 + 4) slashing damage plus 2 (1d4) Charisma damage.");
  assert.ok(chort.onHit.manual.includes("2 (1d4) Charisma damage"), JSON.stringify(chort.onHit));
  const giant = attack("Melee Weapon Attack: +9 to hit, reach 10 ft., one target. Hit: 31 (5d10+4) bludgeoning damage, and the target must succeed on a DC 16 Strength saving throw or be pushed up to 10 feet away from the giant.");
  assert.ok(giant.onHit.manual.some((line) => /pushed up to 10 feet/.test(line)), JSON.stringify(giant.onHit));
});

await test("Tome of Beasts 3's bracketed save is spelled out the SRD's way, the effect before the bracket being what a failure does.", () => {
  const spelled = (desc) => correctedMonsterData({ document__slug: "tob3", slug: "x", actions: [{ name: "A", desc }] }).actions[0].desc;
  assert.equal(
    spelled("Unleashes a terrifying roar in a 30' cone. Each creature in that area: 36 (8d8) thunder (DC 16 Con half). In addition each hostile creature"),
    "Unleashes a terrifying roar in a 30' cone. Each creature in that area: must make a DC 16 Constitution saving throw. On a failure, 36 (8d8) thunder damage. On a success, it takes half as much damage on a successful save. In addition each hostile creature",
  );
  assert.equal(
    spelled("Each creature within 20' of catonoctrix: 45 (10d8) psychic and is stunned for 1 min (DC 16 Int half damage and isn't stunned). A stunned creature can re-save"),
    "Each creature within 20' of catonoctrix: must make a DC 16 Intelligence saving throw. On a failure, 45 (10d8) psychic damage and is stunned for 1 minute. On a success, it takes half as much damage on a successful save and is not stunned. A stunned creature can re-save",
  );
  assert.equal(
    spelled("+7 to hit, 5 ft., one target, 12 (2d8+3) slashing damage + 7 (2d6) poison. Target incapacitated until the end of its next turn (DC 16 Con not incapacitated)."),
    "+7 to hit, 5 ft., one target, 12 (2d8+3) slashing damage + 7 (2d6) poison. Target must make a DC 16 Constitution saving throw. On a failure, incapacitated until the end of its next turn. On a success, it is not incapacitated.",
  );
  assert.equal(
    spelled("Each creature in area: pushed up to 15 ft. away from drake in a direction following the line (DC 17 Str negates)."),
    "Each creature in area: must make a DC 17 Strength saving throw. On a failure, pushed up to 15 ft. away from drake in a direction following the line. On a success, it suffers none of it.",
  );
  // Another book's brackets are left as printed.
  assert.equal(correctedMonsterData({ document__slug: "tob", slug: "x", actions: [{ name: "A", desc: "Bite (DC 13 Con negates)." }] }).actions[0].desc, "Bite (DC 13 Con negates).");
});

await test("A lair's printed options are read from a lair trait or from the lore's Lair Actions heading, and a copy keeps them.", () => {
  const dragon = block({
    special_abilities: [{ name: "Cave Dragon's Lair", desc: "on initiative count 20 (losing initiative ties), the dragon takes a lair action for one of the following effects:\n\n- The ceiling collapses above one creature that the dragon can see within 120 feet of it.\n- A ten-foot-wide pillar of stone erupts from the floor." }],
  });
  assert.deepEqual(dragon.lairOptions, ["The ceiling collapses above one creature that the dragon can see within 120 feet of it.", "A ten-foot-wide pillar of stone erupts from the floor."]);
  const sea = block({ desc: "Lore.\n\n### Lair Actions\n\nOn initiative count 20 (losing initiative ties), the dragon takes a lair action and generates one of the following effects:\n* Four vortexes appear within the lair.\n* The water churns around one creature.\n\n### Regional Effects\n\n* Fog." });
  assert.deepEqual(sea.lairOptions, ["Four vortexes appear within the lair.", "The water churns around one creature."]);
  assert.deepEqual(checkMonsterDraft({ name: "Sea copy", ...sea }).draft.stats.lairOptions, sea.lairOptions);
});

await test("A hit's save is read sentence by sentence: a failure's condition in the next sentence rides the hit, a swallow's acid later on is no save damage, and \"takes half the damage\" is half on a success.", () => {
  const sting = attack("Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) piercing damage, and the target must make a DC 12 Constitution saving throw. On a failure, the target is poisoned for 1 minute.");
  assert.equal(sting.onHit?.save, "con", JSON.stringify(sting));
  assert.equal(sting.onHit?.dc, 12);
  assert.equal(sting.onHit?.condition, "poisoned");
  assert.equal(sting.onHit?.rounds, 10);
  const bite = attack("Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 10 (2d6 + 3) piercing damage, and the target must succeed on a DC 14 Dexterity saving throw or be swallowed. A swallowed creature is blinded and restrained, and it takes 10 (3d6) acid damage at the start of each of the creature's turns.");
  assert.equal(bite.onHit?.save, "dex", JSON.stringify(bite));
  assert.equal(bite.onHit?.damage, undefined, "the swallow's acid was read as the save's damage");
  assert.equal(parseSaveEffect("The target must make a DC 13 Dexterity saving throw, taking 14 (4d6) fire damage on a failure. On a success, the target takes half the damage.").halfOnSave, true);
});

await test("The trait names the engine runs are read in the books' other spellings: Magic Weapon in the singular, Keen Scent, Sunlight Weakness and Hypersensitivity, any element's Absorption.", () => {
  assert.equal(hasTrait({ traits: ["Magic Weapon. The golem's weapon attacks are magical."] }, "magicWeapons"), true);
  assert.equal(hasTrait({ traits: ["Sunlight Weakness. While in sunlight, the vampire has disadvantage on attack rolls and saving throws."] }, "sunlightSensitivity"), true);
  assert.equal(hasTrait({ traits: ["Sunlight Weakness. While in sunlight, the vampire has disadvantage on attack rolls and saving throws."] }, "sunlightWeakness"), true);
  assert.equal(hasTrait({ traits: ["Sunlight Hypersensitivity. The vampire takes 20 radiant damage when it starts its turn in sunlight."] }, "sunlightWeakness"), false);
  for (const name of ["Magic Weapon", "Keen Scent", "Sunlight Weakness", "Sunlight Hypersensitivity", "Necrotic Absorption", "Radiant Absorption"]) {
    assert.match(name, ENGINE_TRAIT_NAMES, name);
  }
  assert.equal(sunlightBurn({ traits: ["Sunlight Hypersensitivity. The vampire takes 20 radiant damage when it starts its turn in sunlight. While in sunlight, it has disadvantage on attack rolls and ability checks."] }), 20);
  assert.equal(sunlightBurn({ traits: ["Sunlight Sensitivity. While in sunlight, the kobold has disadvantage on attack rolls."] }), null);
});

// ---- in a fight ----

const tank = world.addHero({ name: "Tank", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED, maxHp: 300, ac: 10, acOverride: true });
const priest = world.addHero({
  name: "Priest", class: "cleric", level: 5, abilities: { wis: 16 }, proficiencies: TRAINED, maxHp: 300, ac: 10, acOverride: true,
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: ["Sacred Flame"] },
});

async function stage(row) {
  await kit.endFight();
  for (const hero of [tank, priest]) {
    world.patch(hero.id, { currentHp: 300, conditions: [], conditionMeta: {} });
  }
  await kit.fight(1, { heroFaces: { [tank.id]: 19, [priest.id]: 18 } });
  const [enemy] = world.enemies();
  mk.stage(enemy.id, row);
  kit.place(tank.id, 5, 5);
  kit.place(priest.id, 9, 5);
  kit.place(enemy.id, 5, 6);
  kit.freshRound();
  return world.enemies()[0];
}

const BOSS = {
  name: "Boss", size: "Medium", type: "Humanoid", armor_class: 12, hit_points: 60, cr: 2, document__slug: "blackflag", slug: "boss",
  actions: [{ name: "Scimitar", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6+2) slashing damage." }],
  bonus_actions: [{ name: "Quick Bite", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 4 (1d4+2) piercing damage." }],
};

await test("A bonus action's attack is one swing beside the creature's action, once a round: the action still swings after it, and neither comes twice.", async () => {
  const boss = await stage(BOSS);
  const bite = await mk.forced([15, 2], () => world.invoke("enemy_attack", { enemyId: boss.id, targetCharacterId: tank.id, attack: "Quick Bite" }));
  assert.equal(bite.ok, true, bite.error);
  assert.equal(bite.result.swings.length, 1);
  const again = await world.invoke("enemy_attack", { enemyId: boss.id, targetCharacterId: tank.id, attack: "Quick Bite" });
  assert.equal(again.ok, false, "a second bonus action in one round");
  assert.match(again.error, /bonus action/);
  const action = await mk.forced([15, 3], () => world.invoke("enemy_attack", { enemyId: boss.id, targetCharacterId: tank.id }));
  assert.equal(action.ok, true, action.error);
  assert.equal(action.result.swings[0].attack, "Scimitar", "the action swung the bonus action's attack");
  const twice = await world.invoke("enemy_attack", { enemyId: boss.id, targetCharacterId: tank.id });
  assert.equal(twice.ok, false, "a second action in one round");
});

const SWARM = {
  name: "Swarm of Rats", size: "Medium", type: "Swarm of Tiny beasts", armor_class: 10, hit_points: 24, cr: 0.25,
  actions: [{ name: "Bites", desc: "Melee Weapon Attack: +2 to hit, reach 0 ft., one target in the swarm's space. Hit: 7 (2d6) piercing damage, or 3 (1d6) piercing damage if the swarm has half of its hit points or fewer.", attack_bonus: 2, damage_dice: "2d6" }],
};

await test("A swarm at half its hit points or fewer bites with its weaker dice, and at full hit points with its own.", async () => {
  const swarm = await stage(SWARM);
  const full = await mk.forced([15, 4, 4], () => world.invoke("enemy_attack", { enemyId: swarm.id, targetCharacterId: tank.id }));
  assert.equal(full.ok, true, full.error);
  assert.equal(full.result.totalDamage ?? full.result.swings[0].damage, 8, JSON.stringify(full.result));
  kit.freshRound();
  kit.setEnemy(swarm.id, { currentHp: 12 });
  const bloodied = await mk.forced([15, 4], () => world.invoke("enemy_attack", { enemyId: swarm.id, targetCharacterId: tank.id }));
  assert.equal(bloodied.ok, true, bloodied.error);
  assert.equal(bloodied.unused, 0);
  assert.equal(bloodied.result.totalDamage ?? bloodied.result.swings[0].damage, 4, JSON.stringify(bloodied.result));
});

const SPITTER = {
  name: "Spitter", size: "Medium", type: "Monstrosity", armor_class: 12, hit_points: 60, cr: 2, document__slug: "blackflag", slug: "spitter",
  actions: [{ name: "Claw", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6+2) slashing damage." }],
  bonus_actions: [{ name: "Venom Spit", desc: "The spitter spits venom at one creature it can see within 30 feet of it. The target must make a DC 12 Constitution saving throw, taking 7 (2d6) poison damage on a failed save, or half as much damage on a successful one." }],
};

await test("A bonus action's ability is the creature's bonus action: it leaves the action to swing, and a second in the round is refused.", async () => {
  const spitter = await stage(SPITTER);
  const spit = await mk.forced([1, 3, 3], () => world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: spitter.id, ability: "Venom Spit", saveAbility: "con", dc: 12 }));
  assert.equal(spit.ok, true, spit.error);
  const again = await world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: spitter.id, ability: "Venom Spit", saveAbility: "con", dc: 12 });
  assert.equal(again.ok, false, "a second bonus action in one round");
  assert.match(again.error, /bonus action/);
  const claw = await mk.forced([15, 3], () => world.invoke("enemy_attack", { enemyId: spitter.id, targetCharacterId: tank.id }));
  assert.equal(claw.ok, true, claw.error);
});

const DRAGON_LAIR = {
  name: "Lair Drake", size: "Large", type: "Dragon", armor_class: 17, hit_points: 120, cr: 8,
  special_abilities: [{ name: "Lair Actions", desc: "On initiative count 20 (losing initiative ties), the drake takes a lair action:\n- Stalactites fall from the ceiling.\n- A cloud of smoke fills a 20-foot-radius sphere." }],
  actions: [{ name: "Bite", desc: "Melee Weapon Attack: +7 to hit, reach 10 ft., one target. Hit: 15 (2d10+4) piercing damage." }],
};

await test("A block's printed lair options are offered once the fight is in a lair, and a fight outside one is never made one by them.", async () => {
  await stage(DRAGON_LAIR);
  const outside = await world.invoke("lair_action", { action: "1" });
  assert.equal(outside.ok, false);
  assert.match(outside.error, /not in a lair/);
  const encounter = world.encounter();
  const legendary = { ...(encounter.legendary ?? {}), lair: true, lairDue: encounter.round };
  getDatabase().prepare("UPDATE encounters SET legendary_json = ? WHERE id = ?").run(JSON.stringify(legendary), encounter.id);
  const inside = await world.invoke("lair_action", { action: "2" });
  assert.equal(inside.ok, true, inside.error);
  assert.match(inside.result.note, /cloud of smoke/);
});

// ---- the whole pack ----

if (world.hasPack) {
  const rows = getContentDb().prepare("SELECT slug, document_slug, cr, data_json FROM monsters ORDER BY document_slug, slug").all();
  const parsed = rows.map((row) => ({ id: `${row.document_slug}/${row.slug}`, data: JSON.parse(row.data_json), stats: parseMonster(JSON.parse(row.data_json), Number(row.cr) || 0) }));

  await test("Every defence line in the pack reads as damage types the engine knows: no \"false\", no trait name left unread, every condition immunity an SRD condition.", () => {
    const traitNamed = [];
    const odd = new Set();
    for (const { id, data, stats } of parsed) {
      const lines = `${stats.resist} ${stats.immune} ${stats.vulnerable}`;
      assert.doesNotMatch(lines, /\bfalse\b/i, id);
      for (const trait of Array.isArray(data.special_abilities) ? data.special_abilities : []) {
        const name = String(trait?.name ?? "").trim();
        if (name && /resilience|attributes/i.test(name) && lines.toLowerCase().includes(name.toLowerCase())) {
          traitNamed.push(`${id} ${name}`);
        }
      }
      for (const word of stats.conditionImmune.split(/,\s*/).filter(Boolean)) {
        if (!conditionWord(word)) {
          odd.add(word);
        }
      }
    }
    assert.deepEqual(traitNamed, []);
    // What some books list that is no SRD condition, kept as printed.
    assert.deepEqual([...odd].sort(), ["confusion", "diseased"]);
  });

  await test("Every Bonus Actions entry in the pack reaches the block: an attack the engine swings, or a line the DM reads.", () => {
    let entries = 0;
    const lost = [];
    for (const { id, data, stats } of parsed) {
      for (const entry of Array.isArray(data.bonus_actions) ? data.bonus_actions : []) {
        entries += 1;
        const name = String(entry?.name ?? "");
        const read = stats.attacks.some((swing) => swing.bonusAction && swing.name === name) || stats.traits.some((line) => line.startsWith(`Bonus action: ${name}.`));
        if (!read) {
          lost.push(`${id} ${name}`);
        }
      }
    }
    assert.ok(entries > 790, `${entries} bonus actions`);
    assert.deepEqual(lost, []);
  });

  await test("Every attack in the pack that prints a weaker blow at half its hit points carries it as the alternative the engine deals.", () => {
    const missed = [];
    let read = 0;
    for (const { id, data, stats } of parsed) {
      for (const entry of [...(data.actions ?? []), ...(data.bonus_actions ?? [])]) {
        if (!/\bor\s+\d+\s*\(\d+d\d+[^)]*\)[^.]*\bhalf (?:of )?its (?:hit points|hp)\b/i.test(String(entry?.desc ?? ""))) {
          continue;
        }
        const swing = stats.attacks.find((candidate) => candidate.name === entry.name);
        if (swing?.alternatives?.some((alternative) => alternative.when === "bloodied")) {
          read += 1;
        } else if (swing) {
          missed.push(`${id} ${entry.name}`);
        }
      }
    }
    assert.deepEqual(missed, []);
    assert.ok(read >= 80, `${read} read`);
  });
}

finish();
