// A monster's abilities as its block prints them (issue 473): the condition a
// failed save lays wherever the text puts it, and only that one; several
// breaths in one entry as one ability each, sharing the one recharge; a
// second save of another kind as an ability of its own; limits in every
// wording ("Recharges 5-6", "Recharge: Short/Long Rest", "1/rest", "1/Turn",
// "Recharge Special"); the legendary count A5e prints as an option; the
// spellcasting the books file as an action, in one-spell form, or twice; and
// Regeneration in other words. The blocks are written out below in the
// pack's shape (SRD 5.1 where the SRD has one), so CI needs no pack;
// scripts/test-pack-abilities.mjs holds every pack row to the same readers.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { monsterKit } from "./lib/enforce-monsters.mjs";

const { test, finish } = suite("test-monster-abilities");
const world = await openWorld();
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const { parseSaveEffect, parseAbilityText, abilityFromLine, parseSpellcasting, parseRegeneration } = await import("../src/lib/dm/monster-abilities.ts");
const { abilitiesOfEntries } = await import("../src/lib/dm/ability-entries.ts");
const { legendaryProfile, parseLegendaryLine, lairResolution } = await import("../src/lib/dm/legendary-logic.ts");
const { correctedMonsterData } = await import("../src/lib/bestiary/pack-corrections.ts");
const { refillLegendaryForTurn } = await import("../src/lib/dm/legendary-tools.ts");

const ability = (name, desc, options) => parseAbilityText(name, desc, options);
const named = (list, name) => list.find((entry) => entry.name === name);

// ---- the condition a failed save lays ----

await test("A failed save lays the condition its text gives in the next sentence, after a word, or by another verb (SRD 5.1 Sea Hag, Pit Fiend, Aboleth, brass dragon).", () => {
  const seaHag = parseSaveEffect("Any humanoid that starts its turn within 30 feet of the hag and can see the hag's true form must make a DC 11 Wisdom saving throw. On a failed save, the creature is frightened for 1 minute. A creature can repeat the saving throw at the end of each of its turns, with disadvantage if the hag is within line of sight, ending the effect on itself on a success. If a creature's saving throw is successful or the effect ends for it, the creature is immune to the hag's Horrific Appearance for the next 24 hours.");
  assert.deepEqual([seaHag.condition, seaHag.rounds, seaHag.repeatSave], ["frightened", 10, true]);
  const pitFiend = parseSaveEffect("Any creature hostile to the pit fiend that starts its turn within 20 feet of the pit fiend must make a DC 21 Wisdom saving throw, unless the pit fiend is incapacitated. On a failed save, the creature is frightened until the start of its next turn. If a creature's saving throw is successful, the creature is immune to the pit fiend's Fear Aura for the next 24 hours.");
  assert.deepEqual([pitFiend.condition, pitFiend.rounds], ["frightened", 1]);
  const aboleth = parseSaveEffect("The aboleth targets one creature it can see within 30 feet of it. The target must succeed on a DC 14 Wisdom saving throw or be magically charmed by the aboleth until the aboleth dies or until it is on a different plane of existence from the target.");
  assert.equal(aboleth.condition, "charmed");
  const sleep = parseSaveEffect("The dragon exhales sleep gas in a 30-foot cone. Each creature in that area must succeed on a DC 14 Constitution saving throw or fall unconscious for 5 minutes. This effect ends for a creature if the creature takes damage or someone uses an action to wake it.");
  assert.deepEqual([sleep.condition, sleep.rounds, sleep.endsOnDamage], ["unconscious", 50, true]);
});

await test("A5e's double-space commas, \"falling prone on a failure\", \"on fall unconscious\" and Tome of Beasts' \"prevents the poisoned condition\" are read.", () => {
  const a5e = parseSaveEffect("Each creature in the area makes a DC 18 Constitution saving throw. On a failure  a creature falls unconscious for 10 minutes or until it takes damage or someone uses an action to wake it.");
  assert.deepEqual([a5e.condition, a5e.rounds, a5e.endsOnDamage], ["unconscious", 100, true]);
  assert.equal(parseSaveEffect("Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 10 (2d6 + 3) piercing damage. If the target is a creature, it makes a DC 13 Strength saving throw  falling prone on a failure.").condition, "prone");
  assert.equal(parseSaveEffect("The target must make a DC 13 Charisma saving throw on fall unconscious for 1 minute.").condition, "unconscious");
  const tob = parseSaveEffect("Hit: 7 (1d8 + 3) piercing damage plus 9 (2d8) poison damage, and the target is poisoned for 1 minute. A successful DC 13 Constitution saving throw reduces the poison damage by half and prevents the poisoned condition.");
  assert.deepEqual([tob.condition, tob.rounds, tob.save, tob.dc], ["poisoned", 10, "con", 13]);
  const listed = parseSaveEffect("Each creature in that area must succeed on a DC 12 Constitution saving throw or be blinded and deafened for 1 minute.");
  assert.deepEqual([listed.condition, listed.also, listed.rounds], ["blinded", ["deafened"], 10]);
});

await test("A condition a failure does not lay is not laid: a success's immunity, an advantage, a repeat save's, a heavier failure's, a different save's.", () => {
  const immune = parseSaveEffect("Each creature within 10 feet makes a DC 17 Constitution saving throw. On a failure, the creature is poisoned for 24 hours. On a success, the creature is immune to this poison for 24 hours.");
  assert.deepEqual([immune.condition, immune.rounds], ["poisoned", 14400]);
  // The old reader took "or frightened" from the advantage.
  assert.equal(parseSaveEffect("Each creature must make a DC 12 Wisdom saving throw, taking 7 (2d6) psychic damage on a failed save. Undead have advantage on saving throws against being charmed or frightened.").condition, undefined);
  assert.equal(parseSaveEffect("Each creature in that area makes a DC 19 Wisdom saving throw  taking 16 (3d10) psychic damage on a failed save or half damage on a success. Creatures charmed by the dragon make this saving throw with disadvantage.").condition, undefined);
  // A5e fomorian: restrained, and paralyzed only on the repeat save's failure.
  const gaze = parseSaveEffect("The fomorian gazes at one creature. The target makes a DC 15 Wisdom saving throw. On a failure, the creature is magically restrained. The creature repeats the saving throw at the end of its next turn, ending the effect on itself on a success and becoming paralyzed on a failure.");
  assert.deepEqual([gaze.condition, gaze.also], ["restrained", undefined]);
  // SRD 5.1 Gorgon: restrained, then petrified only on the repeat; not lasting.
  const gorgon = parseSaveEffect("The gorgon exhales petrifying gas in a 30-foot cone. Each creature in that area must succeed on a DC 13 Constitution saving throw. On a failed save, a target begins to turn to stone and is restrained. The restrained target must repeat the saving throw at the end of its next turn. On a success, the effect ends on the target. On a failure, the target is petrified until freed by the greater restoration spell or other magic.");
  assert.deepEqual([gorgon.condition, gorgon.also, gorgon.lasting], ["restrained", undefined, undefined]);
  // SRD 5.1 Medusa: restrained, and petrified on a failure by 5 or more.
  const medusa = parseSaveEffect("When a creature that can see the medusa's eyes starts its turn within 30 feet of the medusa, the medusa can force it to make a DC 14 Constitution saving throw if the medusa isn't incapacitated and can see the creature. If the saving throw fails by 5 or more, the creature is instantly petrified. Otherwise, a creature that fails the save begins to turn to stone and is restrained. The restrained creature must repeat the saving throw at the end of its next turn, becoming petrified on a failure or ending the effect on a success.");
  assert.deepEqual([medusa.condition, medusa.failBy], ["restrained", { margin: 5, condition: "petrified" }]);
  const roar = parseSaveEffect("Each creature within 20 feet must make a DC 18 Constitution saving throw, taking 45 (10d8) thunder damage on a failed save, or half as much damage on a successful one. If the saving throw fails by 5 or more, the target is also frightened for 1 minute.");
  assert.deepEqual([roar.condition, roar.failBy], [undefined, { margin: 5, condition: "frightened" }]);
});

await test("A disease lays its condition until it is cured; a wake-up ends only the sleep; a condition takes its own duration of two.", () => {
  const disease = parseSaveEffect("The target makes a DC 14 Constitution saving throw. On a failure, the target contracts a disease. While diseased, the target is poisoned. The target repeats the saving throw every 24 hours, reducing its hit point maximum by 5 (1d10) on a failure.");
  assert.deepEqual([disease.condition, disease.lasting, disease.rounds], ["poisoned", true, undefined]);
  const spores = parseSaveEffect("The target must succeed on a DC 13 Constitution saving throw or be poisoned and unconscious for 1 minute. A creature wakes up if it takes damage, or if another creature uses its action to shake it awake.");
  assert.deepEqual([spores.condition, spores.also, spores.endsOnDamage], ["poisoned", ["unconscious"], true]);
  const cloud = parseSaveEffect("Each creature in the cloud must succeed on a DC 13 Constitution saving throw or be poisoned until the end of its next turn. The cloud lasts for 1 hour.");
  assert.equal(cloud.rounds, 1);
  // Tome of Beasts 3's damage without the word: "14 (4d6) poison and is poisoned".
  const dice = parseSaveEffect("Each creature in area: 14 (4d6) poison and is poisoned until the end of its next turn. Must make a DC 13 Constitution saving throw or be poisoned.");
  assert.deepEqual([dice.damage, dice.damageType], ["4d6", "poison"]);
});

// ---- several effects in one entry ----

// SRD 5.1 Young Brass Dragon.
const YOUNG_BRASS = {
  name: "Young Brass Dragon", size: "Large", type: "Dragon", armor_class: 17, hit_points: 110, cr: 6, dexterity: 10, constitution: 17,
  actions: [
    { name: "Bite", desc: "Melee Weapon Attack: +7 to hit, reach 10 ft., one target. Hit: 15 (2d10 + 4) piercing damage.", attack_bonus: 7, damage_dice: "2d10", damage_bonus: 4 },
    {
      name: "Breath Weapons (Recharge 5-6)",
      desc: "The dragon uses one of the following breath weapons.\n**Fire Breath.** The dragon exhales fire in a 40-foot line that is 5 feet wide. Each creature in that line must make a DC 14 Dexterity saving throw, taking 42 (12d6) fire damage on a failed save, or half as much damage on a successful one.\n**Sleep Breath.** The dragon exhales sleep gas in a 30-foot cone. Each creature in that area must succeed on a DC 14 Constitution saving throw or fall unconscious for 5 minutes. This effect ends for a creature if the creature takes damage or someone uses an action to wake it.",
    },
  ],
};

await test("Two breaths printed in one entry are one ability each, sharing the entry's recharge, each with its own numbers (SRD 5.1 Young Brass Dragon).", () => {
  const specials = mk.parse(YOUNG_BRASS).specials;
  const fire = named(specials, "Fire Breath");
  const sleep = named(specials, "Sleep Breath");
  assert.deepEqual([fire.save, fire.dc, fire.damage, fire.recharge, fire.group, fire.rounds, fire.condition], ["dex", 14, "12d6", 5, "Breath Weapons", undefined, undefined]);
  assert.deepEqual([sleep.save, sleep.condition, sleep.rounds, sleep.recharge, sleep.group, sleep.damage], ["con", "unconscious", 50, 5, "Breath Weapons", undefined]);
  assert.equal(named(specials, "Breath Weapons"), undefined, "the announcement is not an ability of its own");
});

await test("A5e's breaths after a \"Breath Weapons (Recharge 5-6)\" announcement take its recharge; the announcement and the actions after them do not.", () => {
  const read = abilitiesOfEntries([
    { name: "Breath Weapons (Recharge 5-6)", desc: "The dragon uses one of the following breath weapons:" },
    { name: "Molten Breath", desc: "The dragon exhales molten glass in a 60-foot-long  5-foot-wide line. Each creature in the area makes a DC 18 Dexterity saving throw  taking 56 (16d6) fire damage on a failed save or half damage on a success. A creature that fails the save is also blinded until the end of its next turn." },
    { name: "Ocean Surge", desc: "The dragon exhales a torrent of seawater in a 30-foot cone. Each creature in the area makes a DC 20 Strength saving throw. A creature that fails is pushed 30 feet away from the dragon and knocked prone  while one that succeeds is pushed only 15 feet away." },
    { name: "Wing Attack", desc: "The dragon beats its wings. Each creature within 15 feet makes a DC 19 Dexterity saving throw. On a failure, it is pushed 10 feet away and knocked prone." },
  ]);
  assert.deepEqual(read.map((entry) => [entry.name, entry.recharge ?? null, entry.group ?? null, entry.condition ?? null]), [
    ["Molten Breath", 5, "Breath Weapons", "blinded"],
    ["Ocean Surge", 5, "Breath Weapons", "prone"],
    ["Wing Attack", null, null, "prone"],
  ]);
});

await test("A second save of another kind in one use is an ability of its own, run with its parent (Tome of Beasts deep drake).", () => {
  const read = abilitiesOfEntries([{ name: "Breath Weapon (Recharge 5-6)", desc: "A deep drake blasts forth a crackling 80-foot line of purple-black energy that wracks its victims with pain. This attack deals 35 (10d6) necrotic damage, or half damage with a successful DC 16 Dexterity saving throw. Targets that fail this saving throw must also succeed on a DC 16 Constitution saving throw or become stunned for 1 minute." }]);
  assert.deepEqual(read.map((entry) => [entry.name, entry.save, entry.condition ?? null, entry.partOf ?? null, entry.recharge ?? null]), [
    ["Breath Weapon", "dex", null, null, 5],
    ["Breath Weapon (Constitution save)", "con", "stunned", "Breath Weapon", null],
  ]);
});

// ---- limits in other words ----

await test("A limit is read in every wording the books print, and the name keeps none of its tags.", () => {
  const read = (name, desc = "Each creature must make a DC 12 Dexterity saving throw, taking 7 (2d6) fire damage on a failed save.") => ability(name, desc);
  assert.deepEqual([read("Chatter of War (Recharges 5-6)").recharge, read("Chatter of War (Recharges 5-6)").name], [5, "Chatter of War"]);
  assert.deepEqual([read("Relentless (Recharge: Short/Long Rest)").perRest, read("Tempest Breath (Recharges: Short/Long Rest)").perRest], [true, true]);
  assert.deepEqual([read("Frenzy (1/rest)").perRest, read("Springspike Shield (5/rest)").perDay, read("Frenzy (Recharges on a Short or Long Rest)").perRest], [true, 5, true]);
  assert.deepEqual([read("Stunning Strike (1/Turn)").oncePer, read("Ruthless (1/Round)").oncePer, read("Stunning Strike (1/Turn)").name], ["turn", "round", "Stunning Strike"]);
  assert.deepEqual([read("Flare (Recharge Special)").rechargeSpecial, read("Flare (Recharge Special)").name], [true, "Flare"]);
  assert.equal(read("Noxious Breath (Recharge Special)", "Each creature in that area must make a DC 16 Constitution saving throw. While the hydra has five or more heads, this action has a recharge of 6.").recharge, 6);
  assert.deepEqual([read("Blazing Sun Disc (Costs 2 Actions, Recharge 5-6)").legendaryCost, read("Blazing Sun Disc (Costs 2 Actions, Recharge 5-6)").recharge], [2, 5]);
  assert.equal(ability("Tail Sweep (2)", "Each creature within 20 feet must make a DC 17 Dexterity saving throw or be knocked prone.", { legendary: true }).legendaryCost, 2);
  // A line written by hand reads as it did.
  assert.deepEqual(abilityFromLine("Fire Breath (Recharge 5-6): DC 12 Dex save, 6d6 fire, half on success"), { name: "Fire Breath", recharge: 5 });
});

// ---- legendary actions ----

await test("A5e's count printed as the first option is the count and no option; one action is one; costs read in every wording.", () => {
  const a5e = legendaryProfile({
    traits: [
      "Legendary action: The aboleth can take 2 legendary actions. Only one legendary action can be used at a time and only at the end of another creatures turn.",
      "Legendary action: Tail Swipe. The aboleth makes one tail attack.",
      "Legendary action: Vermin Breath (Costs 2 Actions; Humanoid Form Only). Swarms pour out.",
    ],
  });
  assert.deepEqual([a5e.actionsPerRound, a5e.actions.map((entry) => [entry.name, entry.cost])], [2, [["Tail Swipe", 1], ["Vermin Breath", 2]]]);
  const jotun = mk.parse({ name: "Jotun Giant", legendary_desc: "The Jotun giant can take 1 legendary action, and only at the end of another creature's turn.", legendary_actions: [{ name: "Detect", desc: "The Jotun giant makes a Wisdom (Perception) check." }] });
  assert.equal(legendaryProfile(jotun).actionsPerRound, 1);
  const zmey = mk.parse({ name: "Zmey", special_abilities: [{ name: "Multiheaded", desc: "The zmey normally has four heads." }], legendary_desc: "The zmey can take 1 legendary action per head.", legendary_actions: [{ name: "Bite", desc: "The zmey makes a bite attack." }] });
  assert.equal(legendaryProfile(zmey).actionsPerRound, 4);
  assert.deepEqual([parseLegendaryLine("Tentacle Sweep (2). Spins in place.").cost, parseLegendaryLine("Move (2 actions). Moves half its speed.").cost], [2, 2]);
  // A lair option's failure is laid by the same aoe_damage call.
  assert.match(lairResolution("The ground shakes; each creature makes a DC 15 Dex save or falls prone."), /dc 15, saveAbility "dex", condition "prone"/);
});

await test("Legendary actions printed run together are read apart (Creature Codex lord zombie, pack-corrections.ts).", () => {
  const data = correctedMonsterData({ document__slug: "cc", slug: "lord-zombie", legendary_actions: [{ name: "Shambling Hordes", desc: "The lord commands. Life Drain (Costs 2 Actions). The lord makes a life drain attack. Arise (Costs 3 Actions). A corpse rises." }] });
  assert.deepEqual(data.legendary_actions.map((entry) => entry.name), ["Shambling Hordes", "Life Drain (Costs 2 Actions)", "Arise (Costs 3 Actions)"]);
});

// ---- spellcasting ----

await test("Spellcasting is read wherever it is filed and however it is printed, and two entries are one list.", () => {
  // SRD 5.1 Ice Mephit: the one-spell innate form, its uses in its name.
  assert.deepEqual(parseSpellcasting("The mephit can innately cast _fog cloud_, requiring no material components. Its innate spellcasting ability is Charisma.", "Innate Spellcasting (1/Day)").spells, [{ name: "Fog Cloud", level: null, perDay: 1 }]);
  // A5e's notes with commas in brackets, its faerie dragon's ages, "each:spell".
  const aboleth = parseSpellcasting("The aboleths spellcasting ability is Charisma (spell save DC 16). It can innately cast the following spells, requiring no components: 3/day each: detect thoughts (range 120 ft, desc: ), project image (range 1 mile), phantasmal force");
  assert.deepEqual(aboleth.spells.map((spell) => spell.name), ["Detect Thoughts", "Project Image", "Phantasmal Force"]);
  const faerie = parseSpellcasting("It can innately cast spells, requiring no material components. 5 years old, at will: dancing lights, mage hand, 10 years old, 1/day: suggestion, 30 years old, 1/day each:major image");
  assert.deepEqual(faerie.spells.map((spell) => spell.name), ["Dancing Lights", "Mage Hand", "Suggestion", "Major Image"]);
  // Tome of Beasts' lowercase headings and a misprinted name.
  const chelicerae = parseSpellcasting("the chelicerae is an 8th-level spellcaster (spell save DC 13).\n\ncantrips: acid splash, mage hand\n\n1st level: burning hands\n\n8th level (1 slot): heroes feast");
  assert.deepEqual(chelicerae.spells.map((spell) => [spell.name, spell.level]), [["Acid Splash", 0], ["Mage Hand", 0], ["Burning Hands", 1], ["Heroes' Feast", 8]]);
  // Tome of Beasts 3: the ability and DC first, "3/day ea:".
  const tob3 = parseSpellcasting("Cha (DC 12) no material components: At will: minor illusion\n3/day ea: detect thoughts, suggestion");
  assert.deepEqual([tob3.dc, tob3.ability, tob3.spells.map((spell) => [spell.name, spell.perDay ?? null])], [12, "cha", [["Minor Illusion", null], ["Detect Thoughts", 3], ["Suggestion", 3]]]);
  // SRD 5.1 Green Hag: her innate spells only. Her coven's are cast "while
  // all three members of a hag coven are within 30 feet of one another"
  // (Hag Covens), never by a lone hag, so they are no part of her block.
  const hag = mk.parse({
    name: "Green Hag",
    special_abilities: [
      { name: "Innate Spellcasting", desc: "The hag's innate spellcasting ability is Charisma (spell save DC 12). She can innately cast the following spells, requiring no material components:\n\nAt will: dancing lights, minor illusion, vicious mockery" },
      { name: "Shared Spellcasting (Coven Only)", desc: "While all three members of a hag coven are within 30 feet of one another, they can each cast the following spells from the wizard's spell list but must share the spell slots among themselves:\n\n* 1st level (4 slots): identify, ray of sickness\n* 2nd level (3 slots): hold person, locate object" },
    ],
  });
  assert.deepEqual([hag.spellcasting.dc, hag.spellcasting.slots, hag.spells.includes("Hold Person"), hag.spells.includes("Vicious Mockery")], [12, {}, false, true]);
  // A5e's spell printed as an action is a spell, not an ability.
  const empyrean = mk.parse({ name: "Empyrean", actions: [{ name: "Hold Monster (5th-Level; V, S, Concentration)", desc: "One creature makes a DC 23 Wisdom saving throw. On a failure  the target is paralyzed for 1 minute." }] });
  assert.deepEqual([empyrean.spellcasting.spells, empyrean.specials], [[{ name: "Hold Monster", level: 5 }], undefined]);
});

// ---- Regeneration ----

await test("Regeneration in other words is read, with what stops it and when it works.", () => {
  assert.deepEqual(parseRegeneration("The troll regains 10 HP at the start of its turn. If the troll takes acid or fire damage, this trait doesn't function at the start of the troll's next turn. The troll dies only if it starts its turn with 0 HP and doesn't regenerate."), { amount: 10, stoppedBy: ["acid", "fire"], diesOnlyAtTurnStart: true });
  assert.deepEqual(parseRegeneration("Gains 3 hp at the start of its turn. If the trollkin takes acid or fire this ability doesn't function at the start of its next turn."), { amount: 3, stoppedBy: ["acid", "fire"] });
  assert.deepEqual(parseRegeneration("The thrall regains 2 HP at the start of its turn if it has at least 1 HP and isn't in sunlight. If the thrall takes radiant damage, this trait doesn't function at the start of the thrall's next turn."), { amount: 2, stoppedBy: ["radiant"], onlyIf: "isn't in sunlight" });
  assert.deepEqual(parseRegeneration("While the tarrasque is bloodied, it regains 50 hit points at the start of each of its turns. The tarrasque dies only if it starts its turn with 0 hit points and doesnt regenerate."), { amount: 50, stoppedBy: [], diesOnlyAtTurnStart: true, whileBloodied: true });
  assert.deepEqual(parseRegeneration("The vampire regains 20 hit points at the start of its turn if it has at least 1 hit point and hasnt taken radiant damage since its last turn."), { amount: 20, stoppedBy: ["radiant"] });
  assert.equal(parseRegeneration("If the host doesn't already have regeneration, it regains 2 hp at the start of its turn if it has at least 1 hit point."), null);
  assert.deepEqual(mk.parse({ name: "Thrall", special_abilities: [{ name: "Limited Regeneration", desc: "The thrall regains 2 HP at the start of its turn." }] }).regeneration, { amount: 2, stoppedBy: [] });
});

// ---- the engine runs them ----

const tank = world.addHero({ name: "Tank", class: "fighter", level: 5, proficiencies: TRAINED, maxHp: 300, ac: 10, acOverride: true });

async function stage(row) {
  await kit.endFight();
  world.patch(tank.id, { currentHp: 300, conditions: [], conditionMeta: {} });
  await kit.fight(1, { heroFaces: { [tank.id]: 19 } });
  const [enemy] = world.enemies();
  mk.stage(enemy.id, row);
  kit.place(tank.id, 5, 5);
  kit.place(enemy.id, 5, 7);
  kit.freshRound();
  return enemy;
}

// Ends turns until the round wraps, `faces` queued for the dice it rolls.
function nextRound(...faces) {
  const round = world.encounter().round;
  world.clearDice();
  world.dice(...faces);
  for (let guard = 0; guard < 10 && world.encounter().round === round; guard += 1) {
    assert.equal(kit.endTurn(kit.current().userId), true);
  }
  world.clearDice();
}

await test("Either breath spends the one recharge, and one d6 brings both back; the sleep it lays ends on damage.", async () => {
  const dragon = await stage(YOUNG_BRASS);
  const fire = await mk.forced([...new Array(12).fill(1), 1], () => world.invoke("aoe_damage", { characterIds: [tank.id], casterEnemyId: dragon.id, enemyAbility: "Fire Breath", saveAbility: "dex", dc: 14 }));
  assert.equal(fire.ok, true, fire.error);
  kit.freshRound();
  const refused = await world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: dragon.id, enemyAbility: "Sleep Breath", saveAbility: "con", dc: 14 });
  assert.match(refused.error ?? "", /Breath Weapons \(Sleep Breath\) has not recharged/);
  nextRound(5);
  const sleep = await mk.forced([1], () => world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: dragon.id, enemyAbility: "Sleep Breath", saveAbility: "con", dc: 14 }));
  assert.equal(sleep.ok, true, sleep.error);
  const sheet = world.sheet(tank.id);
  assert.ok(sheet.conditions.includes("unconscious"));
  assert.equal(sheet.conditionMeta.unconscious.endsOnDamage, true);
});

await test("A failure by the margin adds its condition, and the conditions listed with the first land with it.", async () => {
  const medusa = await stage({
    name: "Gazer", size: "Medium", type: "Monstrosity", armor_class: 15, hit_points: 120, cr: 6,
    actions: [
      { name: "Petrifying Gaze", desc: "The gazer forces one creature to make a DC 14 Constitution saving throw. If the saving throw fails by 5 or more, the creature is instantly petrified. Otherwise, a creature that fails the save begins to turn to stone and is restrained." },
      { name: "Dazzle", desc: "One creature must succeed on a DC 12 Constitution saving throw or be blinded and deafened for 1 minute." },
    ],
  });
  const near = await mk.forced([10], () => world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: medusa.id, enemyAbility: "Petrifying Gaze", saveAbility: "con", dc: 14 }));
  assert.equal(near.ok, true, near.error);
  assert.deepEqual([world.sheet(tank.id).conditions.includes("restrained"), world.sheet(tank.id).conditions.includes("petrified")], [true, false]);
  world.patch(tank.id, { conditions: [], conditionMeta: {} });
  kit.freshRound();
  const far = await mk.forced([1], () => world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: medusa.id, enemyAbility: "Petrifying Gaze", saveAbility: "con", dc: 14 }));
  assert.equal(far.ok, true, far.error);
  assert.ok(world.sheet(tank.id).conditions.includes("petrified"), JSON.stringify(far.result));
  world.patch(tank.id, { conditions: [], conditionMeta: {} });
  kit.freshRound();
  const dazzle = await mk.forced([1], () => world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: medusa.id, enemyAbility: "Dazzle", saveAbility: "con", dc: 12 }));
  assert.equal(dazzle.ok, true, dazzle.error);
  assert.deepEqual(["blinded", "deafened"].map((name) => world.sheet(tank.id).conditions.includes(name)), [true, true]);
});

await test("A second save comes only with its parent's use, on the same turn, and costs no action of its own.", async () => {
  const drake = await stage({
    name: "Deep Drake", size: "Large", type: "Dragon", armor_class: 17, hit_points: 150, cr: 9,
    actions: [{ name: "Breath Weapon (Recharge 5-6)", desc: "A deep drake blasts forth a crackling 80-foot line of energy. This attack deals 35 (10d6) necrotic damage, or half damage with a successful DC 16 Dexterity saving throw. Targets that fail this saving throw must also succeed on a DC 16 Constitution saving throw or become stunned for 1 minute." }],
  });
  const early = await world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: drake.id, enemyAbility: "Breath Weapon (Constitution save)", saveAbility: "con", dc: 16 });
  assert.match(early.error ?? "", /Use Breath Weapon first/);
  const breath = await mk.forced([...new Array(10).fill(1), 1], () => world.invoke("aoe_damage", { characterIds: [tank.id], casterEnemyId: drake.id, enemyAbility: "Breath Weapon", saveAbility: "dex", dc: 16 }));
  assert.equal(breath.ok, true, breath.error);
  assert.match(breath.result.next ?? "", /Breath Weapon \(Constitution save\)/);
  const second = await mk.forced([1], () => world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: drake.id, enemyAbility: "Breath Weapon (Constitution save)", saveAbility: "con", dc: 16 }));
  assert.equal(second.ok, true, second.error);
  assert.ok(world.sheet(tank.id).conditions.includes("stunned"));
});

await test("A once-a-turn ability is refused a second time that turn, and a Recharge Special one after its one use.", async () => {
  const monk = await stage({
    name: "Grandmaster", size: "Medium", type: "Humanoid", armor_class: 18, hit_points: 150, cr: 11,
    special_abilities: [{ name: "Stunning Strike (1/Turn)", desc: "When the grandmaster hits a creature with a melee attack, they can force it to make a DC 18 Constitution saving throw. On a failure, it is stunned until the end of the grandmasters next turn." }],
    actions: [{ name: "Flare (Recharge Special)", desc: "Each creature within 20 feet must make a DC 17 Dexterity saving throw, taking 22 (4d10) fire damage on a failed save. After using Flare, the alnaar is starving. It can't use Flare if it is starving." }],
  });
  assert.equal((await mk.forced([20], () => world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: monk.id, enemyAbility: "Stunning Strike", saveAbility: "con", dc: 18 }))).ok, true);
  const again = await world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: monk.id, enemyAbility: "Stunning Strike", saveAbility: "con", dc: 18 });
  assert.match(again.error ?? "", /once a turn/);
  nextRound();
  assert.equal((await mk.forced([20, 1, 1, 1, 1], () => world.invoke("aoe_damage", { characterIds: [tank.id], casterEnemyId: monk.id, enemyAbility: "Flare", saveAbility: "dex", dc: 17 }))).ok, true);
  nextRound();
  const flare = await world.invoke("aoe_damage", { characterIds: [tank.id], casterEnemyId: monk.id, enemyAbility: "Flare", saveAbility: "dex", dc: 17 });
  assert.match(flare.error ?? "", /its block says what brings it back/);
});

await test("A legendary action that prints an attack is rolled by enemy_attack; the count A5e prints is no option.", async () => {
  const queen = await stage({
    name: "Ankheg Queen", size: "Large", type: "Monstrosity", armor_class: 16, hit_points: 120, cr: 8,
    actions: [{ name: "Bite", desc: "Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 14 (2d8 + 5) slashing damage.", attack_bonus: 7, damage_dice: "2d8", damage_bonus: 5 }],
    legendary_actions: [
      { name: "The ankheg queen can take 1 legendary action", desc: "Only one legendary action can be used at a time and only at the end of another creatures turn." },
      { name: "Acid Glob", desc: "Ranged Weapon Attack: +5 to hit, range 30/90 feet, one target. Hit: 7 (1d8 + 3) acid damage." },
    ],
  });
  const profile = legendaryProfile(world.enemies()[0].stats);
  assert.deepEqual([profile.actionsPerRound, profile.actions.map((entry) => entry.name)], [1, ["Acid Glob"]]);
  const bought = await world.invoke("legendary_action", { enemyId: queen.id, action: "Acid Glob" });
  assert.equal(bought.ok, true, bought.error);
  assert.match(bought.result.next ?? "", /enemy_attack .*"Acid Glob"/);
  const glob = await mk.forced([15, 4], () => world.invoke("enemy_attack", { enemyId: queen.id, targetCharacterId: tank.id, attack: "Acid Glob" }));
  assert.equal(glob.ok, true, glob.error);
  assert.equal(world.sheet(tank.id).currentHp, 300 - 7);
});

await test("A spell from a Spellcasting filed as an action is cast from the block (Tome of Beasts 2023).", async () => {
  const caster = await stage({
    name: "Akyishigal", size: "Large", type: "Fiend", armor_class: 16, hit_points: 150, cr: 12,
    actions: [{ name: "Spellcasting", desc: "Akyishigal casts one of the following spells, requiring no material components and using Charisma as the spellcasting ability (spell save DC 17):\nAt will: detect evil and good, pass without trace\n3/day: dispel magic, insect plague" }],
  });
  const plague = await mk.forced([20], () => world.invoke("cast_at_player", { characterId: tank.id, casterEnemyId: caster.id, spell: "Insect Plague", saveAbility: "con", dc: 10, damage: "4d10" }));
  assert.equal(plague.ok, true, plague.error);
  assert.equal(plague.result.dc, 17);
});

await test("Bloodied Regeneration heals only at half its hit points or fewer.", async () => {
  const tarrasque = await stage({ name: "Tarrasque", size: "Gargantuan", type: "Monstrosity", armor_class: 25, hit_points: 600, cr: 30, special_abilities: [{ name: "Bloodied Regeneration", desc: "While the tarrasque is bloodied, it regains 50 hit points at the start of each of its turns." }] });
  kit.setEnemy(tarrasque.id, { currentHp: 400 });
  refillLegendaryForTurn(world.encounter(), world.enemies()[0]);
  assert.equal(world.enemies()[0].currentHp, 400);
  kit.setEnemy(tarrasque.id, { currentHp: 200 });
  const lines = refillLegendaryForTurn(world.encounter(), world.enemies()[0]);
  assert.equal(world.enemies()[0].currentHp, 250, lines.join(" "));
});

finish();
