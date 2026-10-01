// Class features and racial traits outside the attack roll: what a rest gives
// back, what a spend resolves, what damage and conditions a feature keeps
// off, and the numbers a feature adds to the sheet. Each rule reads the
// stored sheet, the encounter row, a roll record or a refusal.
//
// The rules, from SRD 5.1:
//   - Evasion: on a DEX save for half damage, none on a success, half on a
//     failure, whatever sends the effect (a trap, a spell, a breath).
//   - Font of Inspiration: from bard 5 Bardic Inspiration comes back on a
//     short rest. Sorcerous Restoration: 4 sorcery points on a short rest.
//     Superior Inspiration and Perfect Self: uses back on rolling initiative.
//   - Draconic Resilience: +1 hit point per sorcerer level.
//   - Aura of Courage, Aura of Devotion, Mindless Rage, Purity of Body, Fey
//     Ancestry's magical sleep: conditions the character cannot be given.
//     Purity of Body: immunity to poison damage too.
//   - Turn Undead: undead within 30 feet make a WIS save or are turned;
//     Destroy Undead destroys the ones at or under the CR threshold.
//   - Relentless Rage: raging and dropped to 0, a CON save (DC 10, +5 per
//     use until a rest) leaves them at 1 hit point.
//   - Primal Champion: +4 STR and CON, to 24.
//   - Wholeness of Body, Survivor, Dark One's Own Luck, Channel Divinity
//     options, Use Magic Device, Song of Rest, CON items and hit points.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { patchSheetAs } from "./lib/enforce-srd-progression.mjs";

const { test, finish } = suite("test-enforce-feature-uses");
const world = await openWorld({ campaign: { maxPlayers: 30 } });
const kit = await combatKit(world);

const race = (...names) => names.map((name) => ({ name, source: "race" }));
const klass = (classId, ...names) => names.map((name) => ({ name, source: "class", classId }));

const fresh = (id, patch = {}) =>
  world.patch(id, { conditions: [], conditionMeta: {}, exhaustion: 0, tempHp: 0, ...patch });

// ---- Evasion ----

const rogue = world.addHero({
  class: "rogue", level: 7, abilities: { dex: 16 }, maxHp: 60,
  features: klass("rogue", "Evasion"), proficiencies: { ...TRAINED, saves: ["dex", "int"] },
});

await test("F:H4: Evasion holds on every save-for-half path: a made DEX save takes nothing, a failed one half.", async () => {
  const { saveDamageTaken } = await import("../src/lib/srd/trait-rules.ts");
  const sheet = world.sheet(rogue.id);
  assert.deepEqual(saveDamageTaken({ total: 14, saved: true, halfOnSave: true, ability: "dex", sheet }), { damage: 0, evasion: "no damage" });
  assert.deepEqual(saveDamageTaken({ total: 14, saved: false, halfOnSave: true, ability: "dex", sheet }), { damage: 7, evasion: "half damage" });
  assert.equal(saveDamageTaken({ total: 14, saved: false, halfOnSave: true, ability: "con", sheet }).damage, 14);
  // A trap through apply_hazard.
  fresh(rogue.id, { currentHp: 60 });
  world.clearDice();
  world.dice(20, 6, 6, 6, 6);
  const made = await world.invoke("apply_hazard", {
    type: "generic", characterIds: [rogue.id], saveAbility: "dex", dc: 15, damage: "4d6", damageType: "fire", halfOnSave: true,
  });
  world.clearDice();
  assert.equal(made.ok, true, made.error);
  assert.equal(world.sheet(rogue.id).currentHp, 60, "a made save takes nothing");
  world.dice(1, 6, 6, 6, 6);
  await world.invoke("apply_hazard", {
    type: "generic", characterIds: [rogue.id], saveAbility: "dex", dc: 15, damage: "4d6", damageType: "fire", halfOnSave: true,
  });
  world.clearDice();
  assert.equal(world.sheet(rogue.id).currentHp, 60 - 12, "a failed save takes half");
});

// ---- rests and refills ----

await test("F:H6: Font of Inspiration: from bard 5 Bardic Inspiration comes back on a short rest; before 5 it waits for a long rest.", async () => {
  const bard5 = world.addHero({ class: "bard", level: 5, abilities: { cha: 16 }, features: klass("bard", "Bardic Inspiration (d8)", "Font of Inspiration") });
  const bard4 = world.addHero({ class: "bard", level: 4, abilities: { cha: 16 }, features: klass("bard", "Bardic Inspiration (d6)") });
  world.patch(bard5.id, { resources: { ...world.sheet(bard5.id).resources, bardic_inspiration: { max: 3, used: 1 } } });
  world.patch(bard4.id, { resources: { ...world.sheet(bard4.id).resources, bardic_inspiration: { max: 3, used: 1 } } });
  const rest = await world.invoke("take_rest", { kind: "short" });
  assert.equal(rest.ok, true, rest.error);
  assert.equal(world.sheet(bard5.id).resources.bardic_inspiration.used, 0);
  assert.equal(world.sheet(bard4.id).resources.bardic_inspiration.used, 1);
});

await test("F:L12: Sorcerous Restoration gives back 4 sorcery points on a short rest; Superior Inspiration and Perfect Self give uses back on initiative.", async () => {
  const sorcerer = world.addHero({ class: "sorcerer", level: 20, features: klass("sorcerer", "Font of Magic", "Sorcerous Restoration") });
  world.patch(sorcerer.id, { resources: { ...world.sheet(sorcerer.id).resources, sorcery_points: { max: 20, used: 10 } } });
  await world.invoke("take_rest", { kind: "short" });
  assert.equal(world.sheet(sorcerer.id).resources.sorcery_points.used, 6);
  const bard = world.addHero({ class: "bard", level: 20, abilities: { cha: 16 }, features: klass("bard", "Bardic Inspiration (d12)", "Superior Inspiration") });
  world.patch(bard.id, { resources: { ...world.sheet(bard.id).resources, bardic_inspiration: { max: 3, used: 3 } } });
  world.dice(10);
  const rolled = await world.invoke("request_roll", { characterId: bard.id, kind: "initiative", reason: "fight" });
  world.clearDice();
  assert.equal(rolled.ok, true, rolled.error);
  assert.equal(world.sheet(bard.id).resources.bardic_inspiration.used, 2);
});

await test("F:L20: Song of Rest is reported only when somebody spent a Hit Die.", async () => {
  world.addHero({ class: "bard", level: 3, features: klass("bard", "Song of Rest (d6)") });
  for (const sheet of world.sheets()) {
    world.patch(sheet.id, { currentHp: sheet.maxHp });
  }
  const rest = await world.invoke("take_rest", { kind: "short" });
  assert.equal(rest.ok, true, rest.error);
  assert.equal(rest.result.songOfRest, undefined);
});

// ---- conditions a feature keeps off ----

const paladin = world.addHero({
  class: "paladin", level: 10, abilities: { cha: 14 },
  features: klass("paladin", "Aura of Protection", "Aura of Courage"),
});
const monk = world.addHero({ class: "monk", level: 10, maxHp: 50, features: klass("monk", "Purity of Body") });
const elf = world.addHero({ race: "high_elf", class: "wizard", level: 3, features: race("Fey Ancestry (adv. vs charm, immune to magical sleep)") });

await test("F:M6: Conditions a feature makes a character immune to are refused: Aura of Courage (and allies within 10 feet), Purity of Body, and poison damage for Purity of Body.", async () => {
  const scared = await world.invoke("set_condition", { characterId: paladin.id, condition: "frightened", rounds: 3 });
  assert.equal(scared.ok, false, "the paladin cannot be frightened");
  assert.ok(!world.sheet(paladin.id).conditions.includes("frightened"));
  const poisoned = await world.invoke("set_condition", { characterId: monk.id, condition: "poisoned", rounds: 3 });
  assert.equal(poisoned.ok, false, "the monk cannot be poisoned");
  fresh(monk.id, { currentHp: 50 });
  await world.invoke("apply_damage", { characterId: monk.id, amount: 10, type: "poison" });
  assert.equal(world.sheet(monk.id).currentHp, 50, "poison damage does nothing to Purity of Body");
  // On a map: an ally beside the paladin is covered, one across the field is not.
  await kit.fight(1);
  kit.place(paladin.id, 2, 2);
  kit.place(monk.id, 3, 2);
  kit.place(elf.id, 12, 12);
  const near = await world.invoke("set_condition", { characterId: monk.id, condition: "frightened", rounds: 3 });
  const far = await world.invoke("set_condition", { characterId: elf.id, condition: "frightened", rounds: 3 });
  await kit.endFight();
  assert.equal(near.ok, false, "the ally inside the aura cannot be frightened");
  assert.equal(far.ok, true, "the ally outside it can");
});

await test("F:M2 sleep: Fey Ancestry: magic cannot put an elf to sleep.", async () => {
  fresh(elf.id);
  const slept = await world.invoke("set_condition", { characterId: elf.id, condition: "unconscious", rounds: 3, reason: "Sleep spell" });
  assert.equal(slept.ok, false);
  assert.ok(!world.sheet(elf.id).conditions.includes("unconscious"));
});

// ---- hit points and scores ----

await test("F:M5: Draconic Resilience adds one hit point per sorcerer level.", async () => {
  const { derivedMaxHp } = await import("../src/lib/srd/hit-points.ts");
  const { featureHitPoints } = await import("../src/lib/srd/trait-rules.ts");
  const draconic = { class: "sorcerer", subclass: "Draconic Bloodline", level: 5, classes: [], features: [] };
  const extra = featureHitPoints(draconic);
  assert.equal(extra, 5);
  assert.equal(derivedMaxHp("average", { classes: [{ die: 6, level: 5 }], con: 10, extraHp: extra }), 6 + 4 * 4 + 5);
});

await test("F:M21: Primal Champion: barbarian 20 raises STR and CON by 4, to a maximum of 24, and the sheet stays legal.", async () => {
  // A table of its own: the level-up is the player's PATCH on their sheet.
  const table = await openWorld();
  const route = await table.route("campaigns/[campaignId]/sheet");
  const barbarian = table.addHero({
    class: "barbarian", level: 19, maxHp: 200, abilities: { str: 20, dex: 14, con: 18 },
    features: klass("barbarian", "Rage"),
  });
  for (let left = 355000; left > 0; left -= 20000) {
    await table.invoke("award_xp", { characterIds: [barbarian.id], amount: Math.min(20000, left), reason: "earned" });
  }
  const response = await patchSheetAs(table, route, table.owner, { level: 20 });
  assert.equal(response.status, 200, response.json.error);
  const after = table.sheet(barbarian.id);
  assert.equal(after.abilities.str, 24);
  assert.equal(after.abilities.con, 22);
  const { abilityProblems } = await import("../src/lib/srd/legality/abilities.ts");
  assert.deepEqual(abilityProblems({
    scores: { str: 24, dex: 14, con: 22, int: 8, wis: 12, cha: 10 },
    racial: {}, recorded: [], freePoints: 10, mode: "bounds", pools: [],
    grants: { str: 4, con: 4 },
  }), []);
});

await test("X:AH1: An item that sets Constitution raises the hit point maximum by the modifier change times the level.", async () => {
  const hero = world.addHero({ class: "fighter", level: 10, maxHp: 60, abilities: { con: 10 } });
  world.patch(hero.id, { currentHp: 30, equipment: [{ name: "Amulet of Health", equipped: true, attuned: true }] });
  const { effectiveMaxHp } = await import("../src/lib/dm/condition-logic.ts");
  assert.equal(effectiveMaxHp(world.sheet(hero.id)), 60 + (abilityMod(19) - abilityMod(10)) * 10);
  await world.invoke("heal", { characterId: hero.id, amount: 100 });
  assert.equal(world.sheet(hero.id).currentHp, 100);
});

// ---- spends ----

await test("F:M10: Turn Undead: each undead in range saves (WIS vs the spell DC); a failure turns it, and at cleric 5 a CR 1/2 or lower undead is destroyed.", async () => {
  const cleric = world.addHero({
    class: "cleric", level: 5, abilities: { wis: 16 },
    features: klass("cleric", "Channel Divinity (1/rest)", "Destroy Undead (CR 1/2)"),
    spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: [] },
  });
  await kit.fight(2);
  const [zombie, ghoul] = world.enemies();
  kit.setEnemy(zombie.id, { stats: { type: "undead", cr: 0.25 } });
  kit.setEnemy(ghoul.id, { stats: { type: "undead", cr: 1 } });
  kit.place(cleric.id, 2, 2);
  kit.place(zombie.id, 4, 2);
  kit.place(ghoul.id, 5, 2);
  kit.giveTurn(cleric.id);
  world.clearDice();
  world.dice(1, 1);
  const out = await world.invoke("use_resource", { characterId: cleric.id, resource: "Channel Divinity", variant: "turn undead" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(zombie.id).status, "dead", "the CR 1/4 zombie is destroyed");
  assert.equal(kit.enemy(ghoul.id).status, "alive");
  assert.ok(kit.enemy(ghoul.id).conditions.includes("turned"), "the CR 1 ghoul is turned");
  assert.equal(world.sheet(cleric.id).resources.channel_divinity.used, 1);
  await kit.endFight();
});

await test("F:M13: Relentless Rage: a raging barbarian dropped to 0 makes a CON save (DC 10, +5 per use) and stays at 1 hit point on a success.", async () => {
  const barbarian = world.addHero({ class: "barbarian", level: 11, maxHp: 100, features: klass("barbarian", "Rage", "Relentless Rage") });
  fresh(barbarian.id, { currentHp: 5, conditions: ["raging"], conditionMeta: { raging: { rounds: 10 } } });
  world.clearDice();
  world.dice(15);
  await world.invoke("apply_damage", { characterId: barbarian.id, amount: 20, type: "slashing" });
  world.clearDice();
  assert.equal(world.sheet(barbarian.id).currentHp, 1);
  assert.equal(world.sheet(barbarian.id).resources.relentless_rage?.used, 1, "the next save is DC 15");
  world.dice(12);
  await world.invoke("apply_damage", { characterId: barbarian.id, amount: 20, type: "slashing" });
  world.clearDice();
  assert.equal(world.sheet(barbarian.id).currentHp, 0, "12 misses DC 15");
});

await test("F:L9: Wholeness of Body heals three times the monk level, once per long rest.", async () => {
  const monk6 = world.addHero({ class: "monk", subclass: "Way of the Open Hand", level: 6, maxHp: 40, features: klass("monk", "Wholeness of Body") });
  fresh(monk6.id, { currentHp: 10 });
  const out = await world.invoke("use_resource", { characterId: monk6.id, resource: "Wholeness of Body" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(monk6.id).currentHp, 28);
});

await test("F:L10: Survivor: at the start of their turn a champion at or under half hit points (and above 0) regains 5 + CON.", async () => {
  const champion = world.addHero({ class: "fighter", subclass: "Champion", level: 18, maxHp: 100, abilities: { con: 14 }, features: klass("fighter", "Survivor") });
  await kit.fight(1);
  fresh(champion.id, { currentHp: 10 });
  const { startTurnConditions } = await import("../src/lib/dm/condition-tick.ts");
  startTurnConditions(world.campaign(), world.encounter(), [champion.id]);
  const after = world.sheet(champion.id).currentHp;
  fresh(champion.id, { currentHp: 0 });
  startTurnConditions(world.campaign(), world.encounter(), [champion.id]);
  const down = world.sheet(champion.id).currentHp;
  await kit.endFight();
  assert.equal(after, 10 + 5 + abilityMod(14));
  assert.equal(down, 0, "not at 0 hit points");
});

await test("F:M17: Dark One's Own Luck adds a d10 to the warlock's next check or save.", async () => {
  const warlock = world.addHero({ class: "warlock", subclass: "The Fiend", level: 6, abilities: { cha: 16 }, features: klass("warlock", "Dark One's Own Luck") });
  const spent = await world.invoke("use_resource", { characterId: warlock.id, resource: "Dark One's Own Luck" });
  assert.equal(spent.ok, true, spent.error);
  world.dice(10, 7);
  const saved = await world.invoke("request_roll", { characterId: warlock.id, kind: "saving_throw", ability: "wis", dc: 15, reason: "x" });
  world.clearDice();
  const d10 = saved.result.dice.find((term) => term.sides === 10);
  assert.equal(d10?.subtotal, 7, "the d10 rides the save");
  assert.ok(!world.sheet(warlock.id).conditions.some((name) => name.includes("own luck")), "the die is spent");
});

await test("F:M18: Preserve Life heals up to 5 x cleric level, split among the wounded, none past half their maximum.", async () => {
  const life = world.addHero({ class: "cleric", level: 2, subclass: "Life Domain", features: klass("cleric", "Channel Divinity (1/rest)", "Channel Divinity: Preserve Life") });
  const first = world.addHero({ class: "fighter", level: 2, maxHp: 30 });
  const second = world.addHero({ class: "fighter", level: 2, maxHp: 30 });
  for (const sheet of world.sheets()) {
    fresh(sheet.id, { currentHp: sheet.maxHp });
  }
  fresh(first.id, { currentHp: 10 });
  fresh(second.id, { currentHp: 12 });
  const out = await world.invoke("use_resource", { characterId: life.id, resource: "Channel Divinity", variant: "preserve life", targetCharacterId: first.id });
  assert.equal(out.ok, true, out.error);
  // 10 points: 5 lift the first to half (15), 3 the second, 2 find no one.
  assert.equal(world.sheet(first.id).currentHp, 15);
  assert.equal(world.sheet(second.id).currentHp, 15);
  assert.equal(world.sheet(life.id).resources.channel_divinity.used, 1);
});

await test("F:L14: Use Magic Device: a thief of 13th level ignores class, race and level requirements to attune.", async () => {
  const { mayAttune } = await import("../src/lib/srd/magic-items.ts");
  const clericOnly = { attunedBy: { text: "requires attunement by a cleric", classes: ["cleric"] } };
  assert.equal(mayAttune(clericOnly, { class: "rogue", features: [{ name: "Use Magic Device" }] }), true);
  assert.equal(mayAttune(clericOnly, { class: "rogue", features: [] }), false);
});

await test("F:M18: Sacred Weapon adds the paladin's Charisma modifier to their weapon attack rolls", async () => {
  const devoted = world.addHero({
    class: "paladin", subclass: "Oath of Devotion", level: 3, abilities: { str: 10, cha: 16 },
    features: klass("paladin", "Channel Divinity (1/rest)", "Channel Divinity: Sacred Weapon"),
    equipment: [{ name: "Longsword", equipped: true }], proficiencies: TRAINED,
  });
  await kit.fight(1);
  const [enemy] = world.enemies();
  kit.place(devoted.id, 2, 2);
  kit.place(enemy.id, 3, 2);
  kit.giveTurn(devoted.id);
  const used = await world.invoke("use_resource", { characterId: devoted.id, resource: "Channel Divinity", variant: "sacred weapon" });
  assert.equal(used.ok, true, used.error);
  assert.ok(world.sheet(devoted.id).conditions.includes("sacred weapon (+3)"));
  kit.freshTurn();
  const swing = await kit.swing(devoted.id, enemy.id, [10, 1], { weapon: "Longsword" });
  await kit.endFight();
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit.total, 10 + 0 + 2 + 3);
});

await test("F:M17: Dark One's Blessing gives temporary hit points on a kill, and Fiendish Resilience resists the type chosen", async () => {
  const fiend = world.addHero({
    class: "warlock", subclass: "The Fiend", level: 10, abilities: { cha: 16, dex: 14 },
    features: klass("warlock", "Dark One's Blessing", "Fiendish Resilience"),
    equipment: [{ name: "Dagger", equipped: true }], proficiencies: TRAINED, maxHp: 60,
  });
  await kit.fight(1);
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { currentHp: 1 });
  kit.place(fiend.id, 2, 2);
  kit.place(enemy.id, 3, 2);
  kit.giveTurn(fiend.id);
  fresh(fiend.id);
  const swing = await kit.swing(fiend.id, enemy.id, [15, 3], { weapon: "Dagger" });
  const tempHp = world.sheet(fiend.id).tempHp;
  await kit.endFight();
  assert.equal(swing.ok, true, swing.error);
  assert.equal(tempHp, abilityMod(16) + 10);
  const chosen = await world.invoke("use_resource", { characterId: fiend.id, resource: "Fiendish Resilience", variant: "fire" });
  assert.equal(chosen.ok, true, chosen.error);
  fresh(fiend.id, { currentHp: 60 });
  await world.invoke("apply_damage", { characterId: fiend.id, amount: 10, type: "fire" });
  assert.equal(world.sheet(fiend.id).currentHp, 55);
});

await test("F:M15: Naturally Stealthy lets a halfling hide behind a creature larger than them", async () => {
  const halfling = world.addHero({
    race: "lightfoot_halfling", class: "rogue", level: 3, abilities: { dex: 16 },
    features: race("Naturally Stealthy"), proficiencies: { ...TRAINED, skills: ["stealth"] },
  });
  const wall = world.addHero({ class: "fighter", level: 3 });
  await kit.fight(1);
  const [enemy] = world.enemies();
  kit.place(enemy.id, 2, 2);
  kit.place(halfling.id, 6, 2);
  kit.place(wall.id, 12, 12);
  kit.giveTurn(halfling.id);
  const open = await world.invoke("take_action", { characterId: halfling.id, action: "hide" });
  assert.equal(open.ok, false, "in plain sight with nobody between, no hiding");
  kit.place(wall.id, 4, 2);
  kit.freshTurn();
  world.dice(12);
  const screened = await world.invoke("take_action", { characterId: halfling.id, action: "hide" });
  world.clearDice();
  await kit.endFight();
  assert.equal(screened.ok, true, screened.error);
});

await test("F:L13: Sunlight Sensitivity: in direct sunlight a drow attacks, and makes Perception checks by sight, at disadvantage.", async () => {
  const drow = world.addHero({
    race: "drow", class: "fighter", level: 3, abilities: { str: 14 },
    features: race("Sunlight Sensitivity (disadvantage on attacks and sight-based Perception in direct sunlight)"),
    equipment: [{ name: "Longsword", equipped: true }], proficiencies: TRAINED,
  });
  await kit.fight(1);
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const { getClock, setClock } = await import("../src/lib/db/clock.ts");
  const { breakDown } = await import("../src/lib/dm/calendar.ts");
  getDatabase().prepare("UPDATE battle_maps SET outdoors = 1, ambient = 'bright' WHERE id = ?").run(kit.map().id);
  const clock = getClock(world.campaignId);
  let instant = clock.instant;
  while (breakDown(clock.calendar, instant).hour !== 12) {
    instant += 60;
  }
  setClock(world.campaignId, { ...clock, instant, weather: null });
  const [enemy] = world.enemies();
  kit.place(drow.id, 2, 2);
  kit.place(enemy.id, 3, 2);
  kit.giveTurn(drow.id);
  const swing = await kit.swing(drow.id, enemy.id, [15, 3, 4], { weapon: "Longsword" });
  const faces = swing.toHit ? swing.toHit.breakdown.terms.find((term) => term.sides === 20)?.dice.length : 0;
  world.dice(5, 15);
  const look = await world.invoke("request_roll", { characterId: drow.id, kind: "skill_check", skill: "perception", reason: "x" });
  world.clearDice();
  await kit.endFight();
  assert.equal(faces, 2, "the attack rolls two d20s (disadvantage)");
  assert.equal(look.result.dice.find((term) => term.sides === 20)?.dice.length, 2);
});

await test("F:M15: Mask of the Wild lets a wood elf hide in plain sight when heavy weather lightly obscures an outdoor field", async () => {
  const elfScout = world.addHero({
    race: "wood_elf", class: "ranger", level: 3, abilities: { dex: 16 },
    features: race("Mask of the Wild (hide when lightly obscured by nature)"), proficiencies: { ...TRAINED, skills: ["stealth"] },
  });
  await kit.fight(1);
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const { getClock, setClock } = await import("../src/lib/db/clock.ts");
  getDatabase().prepare("UPDATE battle_maps SET outdoors = 1 WHERE id = ?").run(kit.map().id);
  const clock = getClock(world.campaignId);
  const [enemy] = world.enemies();
  kit.place(enemy.id, 2, 2);
  kit.place(elfScout.id, 6, 2);
  kit.giveTurn(elfScout.id);
  setClock(world.campaignId, { ...clock, weather: { ...(clock.weather ?? {}), sky: "clear", precipitation: 0 } });
  const clear = await world.invoke("take_action", { characterId: elfScout.id, action: "hide" });
  setClock(world.campaignId, { ...clock, weather: { ...(clock.weather ?? {}), sky: "fog", precipitation: 0 } });
  kit.freshTurn();
  world.dice(12);
  const fog = await world.invoke("take_action", { characterId: elfScout.id, action: "hide" });
  world.clearDice();
  setClock(world.campaignId, clock);
  await kit.endFight();
  assert.equal(clear.ok, false, "in clear weather they are seen");
  assert.equal(fog.ok, true, fog.error);
});

await test("F:M6: every condition immunity a feature grants is on the list set_condition reads, rage-gated ones only while raging", async () => {
  const { featureConditionImmunities, featureDamageImmunities } = await import("../src/lib/srd/trait-rules.ts");
  const holds = (names, conditions = []) =>
    featureConditionImmunities({ features: names.map((name) => ({ name })), conditions }).conditions.map((entry) => entry.condition);
  assert.deepEqual(holds(["Aura of Devotion"]), ["charmed"]);
  assert.deepEqual(holds(["Mindless Rage"]), [], "not while calm");
  assert.deepEqual(holds(["Mindless Rage"], ["raging"]).sort(), ["charmed", "frightened"]);
  assert.deepEqual(holds(["Divine Health"]), ["diseased"]);
  assert.deepEqual(holds(["Nature's Ward"]).sort(), ["diseased", "poisoned"]);
  assert.deepEqual(featureDamageImmunities({ features: [{ name: "Nature's Ward" }] }), ["poison"]);
});

await test("F:L12: Perfect Self gives 4 ki back on initiative when none is left", async () => {
  const { initiativeRefills } = await import("../src/lib/srd/resource-refills.ts");
  const refill = initiativeRefills({ ki: { max: 20, used: 20 } }, [{ name: "Perfect Self" }]);
  assert.deepEqual(refill?.resources.ki, { max: 20, used: 16 });
  assert.equal(initiativeRefills({ ki: { max: 20, used: 19 } }, [{ name: "Perfect Self" }]), null, "only when empty");
});

await test("F:L21: Stillness of Mind ends a charm with the action; Eldritch Master brings the pact slots back once; Purity of Spirit keeps a fiend's fear off", async () => {
  const monk7 = world.addHero({ class: "monk", level: 7, features: klass("monk", "Stillness of Mind") });
  fresh(monk7.id, { conditions: ["charmed"], conditionMeta: { charmed: { rounds: 10 } } });
  const still = await world.invoke("use_resource", { characterId: monk7.id, resource: "Stillness of Mind" });
  assert.equal(still.ok, true, still.error);
  assert.ok(!world.sheet(monk7.id).conditions.includes("charmed"));
  const warlock20 = world.addHero({
    class: "warlock", level: 20, features: klass("warlock", "Eldritch Master"),
    spellcasting: { ability: "cha", slots: { 5: { max: 4, used: 4 } }, prepared: [], known: [], cantrips: [] },
  });
  const master = await world.invoke("use_resource", { characterId: warlock20.id, resource: "Eldritch Master" });
  assert.equal(master.ok, true, master.error);
  assert.equal(world.sheet(warlock20.id).spellcasting.slots[5].used, 0);
  const again = await world.invoke("use_resource", { characterId: warlock20.id, resource: "Eldritch Master" });
  assert.equal(again.ok, false, "once per long rest");
  const devoted = world.addHero({ class: "paladin", subclass: "Oath of Devotion", level: 15, features: klass("paladin", "Purity of Spirit") });
  await kit.fight(1);
  const [fiend] = world.enemies();
  kit.setEnemy(fiend.id, { stats: { type: "fiend" } });
  const byFiend = await world.invoke("set_condition", { characterId: devoted.id, condition: "frightened", rounds: 3, sourceEnemyId: fiend.id });
  await kit.endFight();
  assert.equal(byFiend.ok, false, "a fiend's fear does not land");
  // A beast's fear is not what Purity of Spirit wards (this paladin's own
  // Aura of Courage answers fear in play, so the rule is read directly).
  const { sourcedConditionImmunity } = await import("../src/lib/srd/trait-rules.ts");
  assert.equal(sourcedConditionImmunity(world.sheet(devoted.id), "frightened", "beast"), null);
  assert.equal(sourcedConditionImmunity(world.sheet(devoted.id), "charmed", "undead"), "Purity of Spirit");
});

await test("F:L11: Indomitable rerolls the save just failed, and a success lifts the condition it put on", async () => {
  const fighter = world.addHero({
    class: "fighter", level: 9, abilities: { wis: 10 },
    features: klass("fighter", "Indomitable (1 use)"),
  });
  world.clearDice();
  world.dice(2);
  const held = await world.invoke("cast_at_player", {
    characterId: fighter.id, saveAbility: "wis", dc: 15, condition: "paralyzed", source: "Hold Person",
  });
  world.clearDice();
  assert.equal(held.ok, true, held.error);
  assert.ok(world.sheet(fighter.id).conditions.includes("paralyzed"));
  world.dice(19);
  const reroll = await world.invoke("use_resource", { characterId: fighter.id, resource: "Indomitable" });
  world.clearDice();
  assert.equal(reroll.ok, true, reroll.error);
  assert.ok(!world.sheet(fighter.id).conditions.includes("paralyzed"));
  assert.equal(world.sheet(fighter.id).resources.indomitable.used, 1);
  const again = await world.invoke("use_resource", { characterId: fighter.id, resource: "Indomitable" });
  assert.equal(again.ok, false, "no use left");
});

await test("F:L9: Empty Body spends 4 ki for invisibility and resistance to all damage but force; Diamond Soul spends 1 ki to reroll a failed save", async () => {
  const monk18 = world.addHero({
    class: "monk", level: 18, maxHp: 100, abilities: { wis: 10 },
    features: klass("monk", "Ki", "Empty Body", "Diamond Soul"),
  });
  const empty = await world.invoke("use_resource", { characterId: monk18.id, resource: "Ki", variant: "empty body" });
  assert.equal(empty.ok, true, empty.error);
  assert.equal(world.sheet(monk18.id).resources.ki.used, 4);
  assert.ok(world.sheet(monk18.id).conditions.includes("invisible"));
  fresh(monk18.id, { currentHp: 100, conditions: ["empty body"], conditionMeta: { "empty body": { rounds: 10 } } });
  await world.invoke("apply_damage", { characterId: monk18.id, amount: 20, type: "fire" });
  await world.invoke("apply_damage", { characterId: monk18.id, amount: 20, type: "force" });
  assert.equal(world.sheet(monk18.id).currentHp, 100 - 10 - 20);
  fresh(monk18.id);
  world.dice(1);
  await world.invoke("cast_at_player", { characterId: monk18.id, saveAbility: "wis", dc: 25, condition: "paralyzed", source: "a spell" });
  world.clearDice();
  assert.ok(world.sheet(monk18.id).conditions.includes("paralyzed"));
  world.dice(20);
  const soul = await world.invoke("use_resource", { characterId: monk18.id, resource: "Ki", variant: "diamond soul" });
  world.clearDice();
  assert.equal(soul.ok, true, soul.error);
  assert.equal(world.sheet(monk18.id).resources.ki.used, 5, "one more ki");
  assert.ok(!world.sheet(monk18.id).conditions.includes("paralyzed"), "20 + WIS + PB beats DC 25");
});

await test("F:L21: Turn the Unholy turns fiends and undead with no destruction, and the Hunter's Evasion is Evasion", async () => {
  const devoted = world.addHero({
    class: "paladin", subclass: "Oath of Devotion", level: 5, abilities: { cha: 16 },
    features: klass("paladin", "Channel Divinity (1/rest)", "Channel Divinity: Turn the Unholy"),
  });
  await kit.fight(2);
  const [fiend, beast] = world.enemies();
  kit.setEnemy(fiend.id, { stats: { type: "fiend", cr: 0.25 } });
  kit.setEnemy(beast.id, { stats: { type: "beast", cr: 0.25 } });
  kit.place(devoted.id, 2, 2);
  kit.place(fiend.id, 3, 2);
  kit.place(beast.id, 4, 2);
  kit.giveTurn(devoted.id);
  world.dice(1);
  const out = await world.invoke("use_resource", { characterId: devoted.id, resource: "Channel Divinity", variant: "turn the unholy" });
  world.clearDice();
  const fiendNow = kit.enemy(fiend.id);
  const beastNow = kit.enemy(beast.id);
  await kit.endFight();
  assert.equal(out.ok, true, out.error);
  assert.equal(fiendNow.status, "alive", "turned, never destroyed");
  assert.ok(fiendNow.conditions.includes("turned"));
  assert.ok(!beastNow.conditions.includes("turned"), "a beast is neither");
  const { defenseRiders } = await import("../src/lib/srd/feature-effects.ts");
  assert.equal(defenseRiders({ class: "ranger", level: 15, features: [{ name: "Superior Hunter's Defense: Evasion" }] }).evasion, true);
});

world.close();
finish();
