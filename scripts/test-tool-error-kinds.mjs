// Every tool error states its kind where it is written (src/lib/dm/tool-errors.ts),
// and the model reads it as written: retry true for a mistake in the call, a
// choice only the player makes, or a part of the call that cannot apply;
// refused "rules" when the game says no; refused "limit" for the turn's cap.
// Each case here is reached the way the turn loop reaches it, through the
// call it dispatches for the model (dispatchAdjudication on an AI turn) or
// the turn loop itself with a scripted model, and asserts the exact kind, so
// a site whose kind changes fails its case.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { fightDummies, onTurnOf, wizard } from "./lib/enforce-spells.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-tool-error-kinds");

const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { listSheets } = await import("../src/lib/db/sheets.ts");
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { applyEncounterCall } = await import("../src/lib/dm/encounter-tools.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { MUTATION_CAP_PER_TURN } = await import("../src/lib/dm/mutations.ts");

const kindOf = (result) => (result.retry === true ? "retry" : typeof result.refused === "string" ? result.refused : "ok");

// The call the turn loop makes for a model's tool call, on a DM turn of the
// AI's own, after the acting character's player has spoken (the AI acts on a
// character's turn only on their word: src/lib/dm/player-word.ts).
async function ai(world, name, args, actor = null) {
  if (actor) {
    world.say("player", "I do it.", actor);
  }
  const turn = createDmTurn(world.campaignId, []);
  const sheets = listSheets(world.campaignId);
  const context = { campaign: world.campaign(), turn, sheets, sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])), realDiceUserIds: new Set() };
  return dispatchAdjudication(name, JSON.stringify(args), context);
}

// The turn loop runs the encounter tools itself (resolveModelCall), past the
// dispatch above.
async function aiEncounter(world, name, args, actor = null) {
  if (actor) {
    world.say("player", "I do it.", actor);
  }
  const turn = createDmTurn(world.campaignId, []);
  const sheets = listSheets(world.campaignId);
  return applyEncounterCall(world.campaign(), turn, name, JSON.stringify(args), sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), {
    realDiceUserIds: new Set(),
    toolCallId: null,
  }).result;
}

function expect(result, kind, words) {
  assert.equal(kindOf(result), kind, `expected ${kind}: ${JSON.stringify(result).slice(0, 300)}`);
  if (words) {
    assert.match(String(result.error ?? ""), words);
  }
}

// The initiative pointer on a combatant (a hero's or an enemy's id), its turn fresh.
async function turnTo(world, refId) {
  const encounters = await import("../src/lib/db/encounters.ts");
  const encounter = world.encounter();
  const index = encounter.order.findIndex((entry) => (entry.kind === "pc" ? entry.characterId : entry.enemyId) === refId);
  assert.ok(index >= 0, `${refId} is not in the order`);
  // An enemy acts once end_turn has handed it its turn (src/lib/dm/enemy-turn-order.ts).
  const enemy = encounter.order[index].kind === "enemy";
  const legendary = enemy ? { ...encounter.legendary, due: [refId] } : encounter.legendary;
  encounters.saveEncounter({ ...encounter, turnIndex: index, turnBudget: null, reactionsUsed: [], legendary });
}

const spent = (levels) => Object.fromEntries(Object.entries(levels).map(([level, [max, used]]) => [level, { max, used }]));

// ---- a slot level that is spent (the caster chooses the slot) ----

await test("Magic Missile with its 1st-level slots spent and a 2nd free asks which level, naming the free ones lowest first; with none left the game says no", async () => {
  const world = await openWorld();
  const mage = world.addHero(wizard(5, { spellcasting: { slots: spent({ 1: [4, 4], 2: [3, 0], 3: [2, 1] }) } }));
  expect(await ai(world, "use_spell_slot", { characterId: mage.id, spell: "Magic Missile" }), "retry", /Free slots, lowest first: level 2 \(3 left\), level 3 \(1 left\)\. Ask the player which, unless they named one\./);
  world.patch(mage.id, { spellcasting: { ...world.sheet(mage.id).spellcasting, slots: spent({ 1: [4, 4], 2: [3, 3], 3: [2, 2] }) } });
  expect(await ai(world, "use_spell_slot", { characterId: mage.id, spell: "Magic Missile" }), "rules", /no spell slot of level 1 or higher left/);
  world.close();
});

await test("a spell the server does not know, with no level named, asks for the level", async () => {
  const world = await openWorld();
  const base = wizard(5);
  const mage = world.addHero({ ...base, spellcasting: { ...base.spellcasting, prepared: [...base.spellcasting.prepared, "Kara's Glimmer"] } });
  expect(await ai(world, "use_spell_slot", { characterId: mage.id, spell: "Kara's Glimmer" }), "retry", /must be named \(1 to 9\)/);
  world.close();
});

// ---- spell names ----

await test("a spell name resolves; a misspelling or another language is fixed from the caster's list; a spell the rules know that they lack is refused", async () => {
  const world = await openWorld();
  const mage = world.addHero(wizard(5));
  const [goblin] = await fightDummies(world, 1, { heroFaces: { [mage.id]: 20 } });
  await onTurnOf(world, mage.id, async () => {
    for (const tool of ["use_spell_slot", "cast_at_enemy", "aoe_damage"]) {
      const target = tool === "use_spell_slot" ? {} : tool === "aoe_damage" ? { casterId: mage.id, enemyIds: [goblin.id] } : { targetEnemyId: goblin.id };
      const caster = tool === "aoe_damage" ? {} : { characterId: mage.id };
      expect(await ai(world, tool, { ...caster, ...target, spell: "Firebal" }, mage), "retry", /No spell called "Firebal" is known/);
      expect(await ai(world, tool, { ...caster, ...target, spell: "Palla di fuoco" }, mage), "retry", /Fireball/);
      expect(await ai(world, tool, { ...caster, ...target, spell: "Lightning Bolt" }, mage), "rules", /not among the spells they know or have prepared/);
    }
    const fireball = await ai(world, "use_spell_slot", { characterId: mage.id, spell: "Fireball" }, mage);
    assert.equal(kindOf(fireball), "ok", JSON.stringify(fireball));
  });
  world.close();
});

// ---- the turn loop's own answers ----

// Qwen3.5 9B sent start_encounter ambush "none" twice: the turn refused the
// whole fight with no word of which field was wrong, and it never started.
await test("start_encounter on the AI's turn: a side it does not know is no side, and a field it refuses is named", async () => {
  const world = await openWorld();
  world.addHero({ class: "fighter", level: 3, proficiencies: TRAINED });
  const started = await aiEncounter(world, "start_encounter", { enemies: [{ monster: "goblin", count: 1 }], ambush: "none", surprised: "both" });
  expect(started, "ok");
  assert.ok(world.encounter(), "the fight started");
  const fresh = await openWorld();
  fresh.addHero({ class: "fighter", level: 3, proficiencies: TRAINED });
  expect(await aiEncounter(fresh, "start_encounter", { enemies: [], summary: "nobody" }), "retry", /fix or leave out: enemies/);
});

await test("an unknown tool is a retry, and the turn's cap on mutations is a limit", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const model = await fakeModel();
  model.pointAt(world);
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 3, proficiencies: TRAINED });
  const awards = Array.from({ length: MUTATION_CAP_PER_TURN + 1 }, () => call("award_xp", { characterIds: [kara.id], amount: 1, reason: "the test asks" }));
  const ghost = call("summon_dragon", {});
  model.script([reply({ calls: [ghost, ...awards] }), reply({ text: "The moment passes." })]);
  world.say("player", "We look around.", kara);
  await startDmTurn(world.campaignId);
  const results = new Map(model.requests.flatMap((request) => model.results(request)).map(({ id, result }) => [id, result]));
  expect(results.get(ghost.id), "retry", /no action called "summon_dragon"/);
  expect(results.get(awards.at(-1).id), "limit", /Mutation limit reached/);
  for (const award of awards.slice(0, -1)) {
    assert.equal(kindOf(results.get(award.id)), "ok", JSON.stringify(results.get(award.id)));
  }
  model.close();
  world.close();
});

// ---- options riding an attack or a spell ----

await test("Divine Smite at a spent level asks which free level; Stunning Strike with no ki is resent without it", async () => {
  const world = await openWorld();
  const paladin = world.addHero({
    name: "Brom",
    class: "paladin",
    level: 5,
    abilities: { str: 16, cha: 14 },
    proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
    spellcasting: { ability: "cha", slots: spent({ 1: [4, 4], 2: [2, 0] }), known: [], prepared: ["Bless"], cantrips: [] },
  });
  const monk = world.addHero({
    name: "Ama",
    class: "monk",
    level: 5,
    abilities: { dex: 16, wis: 14 },
    proficiencies: TRAINED,
  });
  const [goblin] = await fightDummies(world, 1, { heroFaces: { [paladin.id]: 20, [monk.id]: 19 } });
  await turnTo(world, paladin.id);
  expect(
    await aiEncounter(world, "pc_attack", { characterId: paladin.id, targetEnemyId: goblin.id, weapon: "Longsword", smite: 1 }, paladin),
    "retry",
    /Free slots, lowest first: level 2 \(2 left\)/,
  );
  const ki = world.sheet(monk.id).resources;
  const kiKey = Object.keys(ki).find((key) => /ki/i.test(key));
  assert.ok(kiKey, `the monk has ki: ${JSON.stringify(ki)}`);
  world.patch(monk.id, { resources: { ...ki, [kiKey]: { ...ki[kiKey], used: ki[kiKey].max } } });
  await turnTo(world, monk.id);
  expect(
    await aiEncounter(world, "pc_attack", { characterId: monk.id, targetEnemyId: goblin.id, weapon: "Unarmed strike", stunningStrike: true }, monk),
    "retry",
    /no ki point left for Stunning Strike\. They can make the attack without it/,
  );
  world.close();
});

await test("Overchannel on a caster without it asks whether to cast without it; a spell sent to the wrong tool names the right one", async () => {
  const world = await openWorld();
  const mage = world.addHero(wizard(5));
  const [goblin] = await fightDummies(world, 1, { heroFaces: { [mage.id]: 20 } });
  await turnTo(world, mage.id);
  expect(await ai(world, "aoe_damage", { casterId: mage.id, spell: "Fireball", enemyIds: [goblin.id], overchannel: true }, mage), "retry", /Ask the player whether to cast/);
  expect(await ai(world, "cast_at_enemy", { characterId: mage.id, targetEnemyId: goblin.id, spell: "Mage Armor" }, mage), "retry", /cast it with cast_buff/);
  world.close();
});

await test("Protection with no ally named asks for the ally; Shield with no hit on record is the rules saying no", async () => {
  const world = await openWorld();
  const guard = world.addHero({
    name: "Hale",
    class: "fighter",
    level: 3,
    abilities: { str: 16 },
    proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Shield", qty: 1, equipped: true }],
  });
  world.patch(guard.id, { features: [...world.sheet(guard.id).features, { name: "Fighting Style: Protection", source: "class" }] });
  const mage = world.addHero(wizard(5));
  await fightDummies(world, 1, { heroFaces: { [guard.id]: 20, [mage.id]: 19 } });
  expect(await aiEncounter(world, "use_reaction", { characterId: guard.id, feature: "Protection" }), "retry", /pass the ally's targetCharacterId/);
  expect(await aiEncounter(world, "use_reaction", { characterId: mage.id, feature: "Shield" }), "rules", /no hit on them this turn/);
  // Sent to cast_buff, a reaction spell is pointed to use_reaction, which checks its trigger.
  expect(await ai(world, "cast_buff", { characterId: mage.id, spell: "Shield" }, mage), "retry", /Shield is cast as a reaction: use_reaction with feature "Shield"/);
  world.close();
});

await test("an action off the character's turn is the rules saying no, and the declaration waits", async () => {
  const world = await openWorld();
  const mage = world.addHero(wizard(5));
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 3, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  const [goblin] = await fightDummies(world, 1, { heroFaces: { [mage.id]: 20, [kara.id]: 19 } });
  await turnTo(world, mage.id);
  expect(await aiEncounter(world, "pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Longsword" }), "rules", /waits for their turn/);
  world.close();
});

// ---- the creatures the DM plays ----

await test("an enemy's spell not on its block, or its save effect on a dead character, has it pick another action", async () => {
  const world = await openWorld();
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 3, abilities: { str: 16 }, proficiencies: TRAINED });
  const mira = world.addHero({ name: "Mira", class: "fighter", level: 3, abilities: { str: 16 }, proficiencies: TRAINED });
  const [goblin] = await fightDummies(world, 1, { heroFaces: { [kara.id]: 20, [mira.id]: 19 } });
  await turnTo(world, goblin.id);
  expect(await ai(world, "cast_at_player", { casterEnemyId: goblin.id, characterId: kara.id, spell: "Fireball", saveAbility: "dex", dc: 13 }), "retry", /not on its stat block/);
  world.patch(mira.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  expect(await ai(world, "cast_at_player", { casterEnemyId: goblin.id, characterId: mira.id, saveAbility: "dex", dc: 12, damage: "1d6" }), "retry", /DEAD/);
  world.close();
});

// ---- items, pets, table settings ----

await test("a potion name nobody knows lists what they carry; a potion the rules know that they lack is refused; a pet name miss lists their creatures", async () => {
  const world = await openWorld();
  const kara = world.addHero({
    name: "Kara",
    class: "fighter",
    level: 3,
    abilities: { str: 16 },
    proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Rope", qty: 1 }],
  });
  world.say("player", "I drink my potion.", kara);
  expect(await ai(world, "use_item", { characterId: kara.id, item: "Potoin of healing" }), "retry", /They carry: Longsword, Rope/);
  expect(await ai(world, "use_item", { characterId: kara.id, item: "Potion of Healing" }), "rules", /does not carry "Potion of Healing"/);
  // The SRD's adventuring gear is known with or without a content pack.
  expect(await ai(world, "remove_item", { characterId: kara.id, name: "Torch", reason: "the test asks" }), "rules", /does not carry "Torch"/);
  expect(await ai(world, "pet_attack", { characterId: kara.id, petName: "Shadow", targetEnemyId: "nobody" }), "retry", /has no bound creature called "Shadow"\. They have none/);
  world.close();
});

await test("a companion at a table with companions off is dropped", async () => {
  const world = await openWorld({ gameSettings: { companions: "off" } });
  world.addHero({ name: "Kara", class: "fighter", level: 3, proficiencies: TRAINED });
  expect(await ai(world, "add_companion", { name: "Pip", class: "rogue" }), "retry", /Companions are disabled/);
  world.close();
});

// ---- a server failure, and a spell with nothing to end ----

await test("a failed enemy update throws instead of reaching the model as a refusal", async () => {
  const world = await openWorld();
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 3, proficiencies: TRAINED });
  const [goblin] = await fightDummies(world, 1, { heroFaces: { [kara.id]: 20 } });
  const { applyEnemyDamage } = await import("../src/lib/dm/enemy-damage.ts");
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const stale = { ...goblin };
  getDatabase().prepare("DELETE FROM encounter_enemies WHERE id = ?").run(goblin.id);
  const sheets = listSheets(world.campaignId);
  assert.throws(
    () => applyEnemyDamage(world.campaign(), createDmTurn(world.campaignId, []), world.encounter(), stale, 3, sheets, new Map(sheets.map((sheet) => [sheet.id, sheet]))),
    /Failed to update enemy/,
  );
  world.close();
});

await test("Dispel Magic on a creature with no spell on it is cast: the slot is spent and nothing ends", async () => {
  const world = await openWorld();
  const base = wizard(5);
  const mage = world.addHero({ ...base, spellcasting: { ...base.spellcasting, prepared: [...base.spellcasting.prepared, "Dispel Magic"] } });
  const [goblin] = await fightDummies(world, 1, { heroFaces: { [mage.id]: 20 } });
  await turnTo(world, mage.id);
  const before = world.enemies().find((enemy) => enemy.id === goblin.id).conditions;
  const cast = await ai(world, "cast_at_enemy", { characterId: mage.id, targetEnemyId: goblin.id, spell: "Dispel Magic" }, mage);
  assert.equal(kindOf(cast), "ok", JSON.stringify(cast));
  assert.match(String(cast.note), /nothing the server tracks ended/);
  assert.equal(world.sheet(mage.id).spellcasting.slots["3"].used, 1);
  assert.deepEqual(world.enemies().find((enemy) => enemy.id === goblin.id).conditions, before);
  world.close();
});

// ---- one refusal of each kind more ----

const fighter = (overrides = {}) => ({
  name: "Kara",
  class: "fighter",
  level: 3,
  abilities: { str: 16, dex: 12 },
  proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  ...overrides,
});

await test("out of a fight: a missing ritual name and a missing form are asked for, a fight-only tool and a story with no arc are retries, downtime in a fight and a lift too heavy are the rules", async () => {
  const world = await openWorld();
  const mage = world.addHero(wizard(5));
  const druid = world.addHero({ name: "Fern", class: "druid", level: 2, abilities: { wis: 16 }, proficiencies: TRAINED });
  const kara = world.addHero(fighter({ abilities: { str: 8 } }));
  // A ritual needs its spell named.
  expect(await ai(world, "use_spell_slot", { characterId: mage.id, ritual: true }), "retry", /name the spell being cast/);
  // Wild Shape needs the beast.
  const asked = await ai(world, "use_resource", { characterId: druid.id, resource: "Wild Shape" });
  expect(asked, "retry", /needs the beast being assumed in form; at druid level 2 Fern can take: .*Wolf \(CR 1\/4\)/);
  assert.doesNotMatch(asked.error, /Brown Bear|Giant Eagle/, "a form above the druid's caps was offered");
  expect(await ai(world, "use_resource", { characterId: druid.id, resource: "Wild Shape", form: "brown bear" }), "retry", /CR 1\/4 or lower: .*Wolf \(CR 1\/4\).*Offer a form within the limit/);
  // A beast of its own the table lacks asks for its stat block; it never becomes the Hamster inside its name.
  expect(await ai(world, "use_resource", { characterId: druid.id, resource: "Wild Shape", form: "giant hamster" }), "retry", /"giant hamster" is not in the beast-form table/);
  // A giant elk is a form of its own (CR 2), never the Elk inside its name.
  expect(await ai(world, "use_resource", { characterId: druid.id, resource: "Wild Shape", form: "giant elk" }), "retry", /Giant Elk is CR 2; at level 2 Fern can Wild Shape into beasts of CR 1\/4 or lower/);
  // A fight-only tool with no fight.
  expect(await ai(world, "aoe_damage", { saveAbility: "dex", dc: 12, damage: "2d6", characterIds: [kara.id] }), "retry", /No active encounter/);
  // The DM's own bookkeeping with nothing to act on.
  expect(await ai(world, "complete_beat", { beat: 1 }), "retry", /no story arc/);
  // A lift the character attempts and cannot make.
  expect(await ai(world, "lift", { characterId: kara.id, weightLb: 2000 }), "rules", /does not mo/);
  // Ready is for a fight.
  expect(await ai(world, "take_action", { characterId: kara.id, action: "ready", trigger: "when the door opens" }), "rules", /no active fight/);
  await fightDummies(world, 1, { heroFaces: { [kara.id]: 20 } });
  // Downtime in a fight.
  expect(await ai(world, "downtime", { days: 1, characterId: kara.id, activity: "research", topic: "the old keep" }), "rules", /end the fight first/);
  world.close();
});

await test("in a fight: options riding an attack the character lacks or cannot use, a target down or banished, a two-handed weapon with a shield, a second action", async () => {
  const world = await openWorld();
  const kara = world.addHero(fighter({ equipment: [{ name: "Light Crossbow", qty: 1, equipped: true }, { name: "Crossbow bolts", qty: 20 }, { name: "Longsword", qty: 1 }] }));
  const brute = world.addHero(fighter({ name: "Brom", equipment: [{ name: "Greatsword", qty: 1, equipped: true }, { name: "Shield", qty: 1, equipped: true }] }));
  const mage = world.addHero(wizard(5));
  const [first, second] = await fightDummies(world, 2, { heroFaces: { [kara.id]: 20, [brute.id]: 19, [mage.id]: 18 } });
  await turnTo(world, kara.id);
  // An option the character does not have, on a legal attack.
  expect(await aiEncounter(world, "pc_attack", { characterId: kara.id, targetEnemyId: first.id, weapon: "Longsword", hurlThroughHell: true }, kara), "retry", /attack without hurlThroughHell/);
  // P3 too: a maneuver the rules know that they never picked; a name nobody knows is fixed from their picks.
  expect(await aiEncounter(world, "pc_attack", { characterId: kara.id, targetEnemyId: first.id, weapon: "Longsword", maneuver: "Precision Attack" }, kara), "retry", /knows no maneuver "Precision Attack"\. They have no maneuver picks\. They can make the attack without it\./);
  expect(await aiEncounter(world, "pc_attack", { characterId: kara.id, targetEnemyId: first.id, weapon: "Longsword", maneuver: "Precisoin Atack" }, kara), "retry", /No maneuver called "Precisoin Atack" is known/);
  // An option this attack does not meet.
  expect(await aiEncounter(world, "pc_attack", { characterId: kara.id, targetEnemyId: first.id, weapon: "Light Crossbow", nonlethal: true }, kara), "retry", /this one is ranged/);
  // A multi-target feature with one target it cannot take.
  world.patch(kara.id, { features: [...world.sheet(kara.id).features, { name: "Multiattack: Whirlwind Attack", source: "class" }] });
  expect(await aiEncounter(world, "pc_attack", { characterId: kara.id, targetEnemyId: first.id, weapon: "Light Crossbow", whirlwind: true }, kara), "retry", /without this creature/);
  // The sheet lacks what the attack needs.
  world.patch(kara.id, { conditions: ["flame blade"] });
  expect(await aiEncounter(world, "pc_attack", { characterId: kara.id, targetEnemyId: first.id, weapon: "Flame Blade" }, kara), "rules", /no spell attack bonus/);
  world.patch(kara.id, { conditions: [] });
  // An extra attack that is the feature itself, not theirs.
  expect(await aiEncounter(world, "pc_attack", { characterId: kara.id, targetEnemyId: first.id, weapon: "Unarmed strike", bonusAttack: "martial arts" }, kara), "rules", /has no Martial Arts/);
  // A target nothing reaches.
  const encounters = await import("../src/lib/db/encounters.ts");
  encounters.patchEnemyConditions(second.id, ["banished"], {});
  expect(await aiEncounter(world, "pc_attack", { characterId: kara.id, targetEnemyId: second.id, weapon: "Longsword" }, kara), "rules", /banished/);
  // A target already down.
  encounters.patchEnemyHp(first.id, 0, "dead");
  expect(await aiEncounter(world, "pc_attack", { characterId: kara.id, targetEnemyId: first.id, weapon: "Longsword" }, kara), "retry", /is already dead/);
  // A two-handed weapon with a shield on.
  await turnTo(world, brute.id);
  encounters.patchEnemyConditions(second.id, [], {});
  expect(await aiEncounter(world, "pc_attack", { characterId: brute.id, targetEnemyId: second.id, weapon: "Greatsword" }, brute), "rules", /needs both hands/);
  // A second action in the turn.
  await turnTo(world, mage.id);
  assert.equal(kindOf(await ai(world, "use_spell_slot", { characterId: mage.id, spell: "Magic Missile" }, mage)), "ok");
  expect(await ai(world, "use_spell_slot", { characterId: mage.id, spell: "Burning Hands" }, mage), "rules", /already used their action/);
  // A caster at 0 HP.
  world.patch(mage.id, { currentHp: 0 });
  expect(await ai(world, "cast_buff", { characterId: mage.id, spell: "Mage Armor", targetCharacterIds: [mage.id] }, mage), "rules", /at 0 HP/);
  world.close();
});

await test("the DM's own bookkeeping: malformed arguments, a numbers-less area, a player's character dismissed, a token off the map are retries; a failed save that is not there is skipped", async () => {
  const world = await openWorld();
  const kara = world.addHero(fighter());
  await fightDummies(world, 1, { heroFaces: { [kara.id]: 20 } });
  // Malformed arguments.
  expect(await ai(world, "take_action", { characterId: kara.id }, kara), "retry", /Invalid arguments/);
  // Numbers the DM supplies.
  expect(await ai(world, "aoe_damage", { characterIds: [kara.id], damage: "2d6" }), "retry", /for an effect that names no spell/);
  // An edit beyond the engine's limits.
  expect(await ai(world, "dismiss_companion", { characterId: kara.id }), "retry", /player's character/);
  world.close();
});

await test("a party member who is dead cannot be healed, a purse too thin to pay is the rules, a spell the class cannot learn is the rules", async () => {
  const world = await openWorld();
  const cleric = world.addHero({ name: "Sera", class: "cleric", level: 5, abilities: { wis: 16 }, proficiencies: TRAINED, spellcasting: { ability: "wis", slots: spent({ 1: [4, 0], 2: [3, 0], 3: [2, 0] }), known: [], prepared: ["Cure Wounds"], cantrips: [] } });
  const kara = world.addHero(fighter({ gold: 1 }));
  const mage = world.addHero(wizard(5));
  world.patch(kara.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  // The dead.
  expect(await ai(world, "heal", { casterId: cleric.id, characterId: kara.id, spell: "Cure Wounds", level: 1 }), "rules", /DEAD/);
  // How much is the player's to say.
  expect(await ai(world, "party_stash", { do: "deposit", characterId: kara.id }), "retry", /Say how much/);
  // Money.
  expect(await ai(world, "party_stash", { do: "deposit", characterId: kara.id, coins: "50 gp" }), "rules", /only has/);
  // Learning the rules bar.
  expect(await ai(world, "learn_spell", { characterId: mage.id, spell: "Cure Wounds", action: "add" }), "rules", /not on the wizard spell list/);
  world.close();
});

await test("choices only the player makes are asked for: a Channel Divinity option, a load too heavy, a spell's target count, a stabilize method, a companion slot", async () => {
  const world = await openWorld({ gameSettings: { inventoryApprovals: false, companions: "full", maxCompanions: 1 } });
  const cleric = world.addHero({ name: "Sera", class: "cleric", level: 5, abilities: { wis: 16 }, proficiencies: TRAINED, spellcasting: { ability: "wis", slots: spent({ 1: [4, 0], 2: [3, 0], 3: [2, 0] }), known: [], prepared: ["Bless", "Cure Wounds"], cantrips: [] } });
  const weak = world.addHero(fighter({ name: "Pell", abilities: { str: 8 } }));
  const kara = world.addHero(fighter());
  const mira = world.addHero(fighter({ name: "Mira" }));
  const dax = world.addHero(fighter({ name: "Dax" }));
  // More than they can carry.
  expect(await ai(world, "grant_item", { characterId: weak.id, name: "Plate Armor", qty: 3, reason: "the test asks" }), "retry", /Ask the player which/);
  // Stabilize with a kit they do not have.
  world.patch(kara.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  expect(await ai(world, "stabilize", { healerId: mira.id, characterId: kara.id, method: "kit" }), "retry", /Ask the player whether to try it/);
  // The companion limit.
  const companion = { class: "rogue", gender: "Unknown", personality: "wry", kind: "party" };
  assert.equal(kindOf(await ai(world, "add_companion", { ...companion, name: "Pip" })), "ok");
  expect(await ai(world, "add_companion", { ...companion, name: "Tam" }), "retry", /Ask the players which/);
  await fightDummies(world, 1, { heroFaces: { [cleric.id]: 20 } });
  await turnTo(world, cleric.id);
  // More targets than the spell takes.
  expect(await ai(world, "cast_buff", { characterId: cleric.id, spell: "Bless", targetCharacterIds: [kara.id, mira.id, dax.id, weak.id], level: 1 }, cleric), "retry", /affects at most 3/);
  // An option the player picks.
  expect(await ai(world, "use_resource", { characterId: cleric.id, resource: "Channel Divinity" }, cleric), "retry", /Ask the player which, unless they named one/);
  world.close();
});

await test("in a fight on a map: a square off the board and a target out of reach are fixed from the board; an enemy out of its turn, a resistance with nothing to answer, a feature they lack or have spent are as decided", async () => {
  const world = await openWorld();
  const kara = world.addHero(fighter());
  const mage = world.addHero(wizard(5));
  const kit = await combatKit(world);
  await kit.fight(1, { heroFaces: { [kara.id]: 20, [mage.id]: 19 }, enemyFace: 1 });
  const [goblin] = world.enemies();
  kit.place(kara.id, 1, 1);
  kit.place(mage.id, 1, 3);
  kit.place(goblin.id, 8, 8);
  await turnTo(world, kara.id);
  // Out of melee reach, the character can move to it.
  expect(await aiEncounter(world, "pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Longsword" }, kara), "retry", /out of melee reach/);
  // A square off the board.
  expect(await aiEncounter(world, "move_token", { tokenName: goblin.displayName, x: 999, y: 999, forced: true }), "retry", /outside the/);
  // An enemy acting before its turn.
  expect(await aiEncounter(world, "enemy_attack", { enemyId: goblin.id, targetCharacterId: kara.id }), "retry", /turn has not come yet/);
  // A character without the feature.
  expect(await ai(world, "cast_at_enemy", { characterId: kara.id, targetEnemyId: goblin.id, spell: "Fire Bolt" }, kara), "rules", /cannot cast spells/);
  // Nothing to act on in what a player declared.
  expect(await ai(world, "take_action", { characterId: kara.id, action: "escape" }, kara), "rules", /not grappled/);
  // Out of uses.
  const resources = world.sheet(kara.id).resources;
  const wind = Object.keys(resources).find((key) => /second.?wind/i.test(key));
  assert.ok(wind, `the fighter has Second Wind: ${JSON.stringify(resources)}`);
  world.patch(kara.id, { resources: { ...resources, [wind]: { ...resources[wind], used: resources[wind].max } } });
  expect(await ai(world, "use_resource", { characterId: kara.id, resource: "Second Wind" }, kara), "rules", /left/);
  // Legendary Resistance with no failed save to answer.
  const encounters = await import("../src/lib/db/encounters.ts");
  const live = world.encounter();
  encounters.saveEncounter({ ...live, legendary: { ...live.legendary, pools: { ...live.legendary.pools, [goblin.id]: { actions: 0, resistances: 3 } } } });
  expect(await aiEncounter(world, "legendary_resist", { enemyId: goblin.id }), "retry", /no failed save/);
  world.close();
});

await test("bookkeeping with nothing to work on: no board for a teleport is skipped, a full quest log is fixed", async () => {
  const world = await openWorld();
  const kara = world.addHero(fighter());
  // No board.
  expect(await ai(world, "teleport_token", { tokenName: kara.name, x: 1, y: 1, cause: "hazard" }), "retry", /no board/);
  // A cap the DM manages.
  for (let index = 0; index < 40; index += 1) {
    assert.equal(kindOf(await ai(world, "set_quest", { title: `Quest ${index}` })), "ok");
  }
  expect(await ai(world, "set_quest", { title: "One more" }), "retry", /quest log is full/);
  world.close();
});

await test("the same offer twice is dropped while the first waits; a romance step the story has not earned is the rules", async () => {
  const world = await openWorld({ gameSettings: { inventoryApprovals: true, romance: true } });
  const kara = world.addHero(fighter());
  // Pacing, the DM's own offer already waiting.
  const offer = { characterId: kara.id, name: "Coin purse", qty: 1, tags: [], reason: "the test asks" };
  assert.equal(kindOf(await ai(world, "grant_item", offer)), "ok");
  expect(await ai(world, "grant_item", offer), "retry", /still waiting/);
  // A relationship the story has not earned.
  const npc = await ai(world, "set_npc", { name: "Lisa", role: "innkeeper", disposition: "friendly" });
  assert.equal(kindOf(npc), "ok", JSON.stringify(npc));
  world.say("player", "Kara asks Lisa to marry her.", kara);
  expect(await ai(world, "romance_advance", { characterId: kara.id, subject: "Lisa", to: "married" }), "rules", /one step at a time|barely know/);
  world.close();
});

await test("a reaction the rules know that the character lacks is the rules, before anything about its target; a name nobody knows lists their features", async () => {
  const world = await openWorld();
  const kara = world.addHero(fighter({ level: 5 }));
  await fightDummies(world, 1, { heroFaces: { [kara.id]: 20 } });
  for (const feature of ["Riposte", "Warding Flare", "Hellish Rebuke"]) {
    expect(await aiEncounter(world, "use_reaction", { characterId: kara.id, feature }), "rules", /no reaction called|cannot cast spells/);
  }
  expect(await aiEncounter(world, "use_reaction", { characterId: kara.id, feature: "Uncany Dodge" }), "retry", /Kara's features are/);
  world.close();
});

await test("an enemy's spell its own state or the target's plane forbids is the DM's to re-pick", async () => {
  const world = await openWorld();
  const kara = world.addHero(fighter());
  const mira = world.addHero(fighter({ name: "Mira" }));
  const [goblin] = await fightDummies(world, 1, { heroFaces: { [kara.id]: 20, [mira.id]: 19 }, stats: { spells: ["Hold Person"] } });
  const encounters = await import("../src/lib/db/encounters.ts");
  await turnTo(world, goblin.id);
  world.patch(mira.id, { conditions: ["ethereal"] });
  expect(await ai(world, "cast_at_player", { casterEnemyId: goblin.id, characterId: mira.id, spell: "Hold Person", saveAbility: "wis", dc: 12 }), "retry", /Nothing was spent/);
  encounters.patchEnemyConditions(goblin.id, ["feebleminded"], {});
  expect(await ai(world, "cast_at_player", { casterEnemyId: goblin.id, characterId: kara.id, spell: "Hold Person", saveAbility: "wis", dc: 12 }), "retry", /cannot cast/);
  world.close();
});

finish();
