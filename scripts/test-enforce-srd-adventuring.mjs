// The SRD 5.1 text audit (issue #570), slice 2 of 6: the rules pages
// "Using Ability Scores", "Adventuring", "Beyond 1st Level",
// "Multiclassing", "Feats" (Grappler), "Inspiration" and "Backgrounds",
// read from the bundled src/lib/rulebook/srd-5.1.json (page id and heading
// named on each row) and held against the engine.
//
// Each test() labelled ADV-nn was a finding of the #570 SRD text audit (the
// engine did something other than the quoted sentence says), reproduced
// against the real code and now held. Each other test() is a row of the same
// pages the audit found held and that no other suite stated. The rows other
// suites already hold are listed in the audit's report, not repeated here.
//
// Needs no content pack: every check runs on the SRD fallback in src/lib/srd/,
// so the suite reads the same with CONTENT_DB_PATH pointed at nothing.
import assert from "node:assert/strict";
import { openTable, storedSlots } from "./lib/enforce-multiclass.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-srd-adventuring");
// Seven seats: the owner's hero and six more, each at a seat of its own.
const table = await openTable({ campaign: { maxPlayers: 8 } });
const { world, hero, now, levelInto } = table;
const { resolveRollExpression } = await import("../src/lib/dm/rolls.ts");
const { rollExtrasFor } = await import("../src/lib/dm/forced-save.ts");
const { computeSheetDerived, speedFor } = await import("../src/lib/srd/index.ts");
const { encumbranceFor } = await import("../src/lib/srd/encumbrance.ts");

// A broken setup must fail the suite, not pass for an open gap: the harness
// records only an assertion as the finding, so preconditions throw plainly.
function need(condition, message) {
  if (!condition) {
    throw new Error(`setup: ${message}`);
  }
}

const all13 = { str: 13, dex: 13, con: 13, int: 13, wis: 13, cha: 13 };
const profs = (overrides = {}) => ({ ...TRAINED, ...overrides });

// The d20s a request_roll threw, read off the forced-dice log.
async function rolled(args, faces) {
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  const out = await world.invoke("request_roll", { reason: "test", ...args });
  const d20s = world.diceLog().filter((die) => die.sides === 20).map((die) => die.face);
  world.clearDice();
  need(out.ok, `request_roll refused: ${out.error}`);
  return { out, d20s };
}

// How many d20s a character's initiative throws, resolved the way a fight's
// opening resolves it (src/lib/dm/encounter-open.ts: resolveRollExpression
// with rollExtrasFor). `campaign` lets a case turn a variant rule on.
function initiativeD20s(sheetId, campaign = world.campaign()) {
  const sheet = world.sheet(sheetId);
  const resolved = resolveRollExpression(
    { kind: "initiative", characterId: sheet.id },
    sheet,
    rollExtrasFor(campaign, sheet, "initiative"),
  );
  need(resolved.expression, `initiative did not resolve: ${resolved.error}`);
  const match = /(\d*)d20/.exec(resolved.expression);
  return match ? Number(match[1] || 1) : 1;
}

const withVariant = (name) => {
  const campaign = world.campaign();
  return {
    ...campaign,
    gameSettings: {
      ...campaign.gameSettings,
      variantRules: { ...campaign.gameSettings.variantRules, [name]: true },
    },
  };
};

// ---- Multiclassing: Spellcasting ----
// Runs first: openTable's hero() replaces the owner's sheet, and the
// heroes added after it each sit at a seat of their own.

await test(
  "ADV-01: multiclassing / Spellcasting: \"If you multiclass but have the Spellcasting feature from only one class, you follow the rules as described in that class.\" A paladin or ranger gains Spellcasting at 2nd level, so a ranger 3 / paladin 1 keeps the ranger's 3 first-level slots and a paladin 5 / ranger 1 the paladin's 4 + 2",
  async () => {
    hero({ class: "ranger", level: 3, abilities: all13, spellcasting: { ability: "wis", slots: { 1: { max: 3, used: 0 } }, prepared: [], known: [], cantrips: [] } });
    need(JSON.stringify(storedSlots(now())) === JSON.stringify({ 1: 3 }), `a ranger 3 starts with ${JSON.stringify(storedSlots(now()))}`);
    await levelInto("paladin");
    assert.deepEqual(storedSlots(now()), { 1: 3 }, `ranger 3 / paladin 1 holds ${JSON.stringify(storedSlots(now()))}, not the ranger's three 1st-level slots`);
    hero({ class: "paladin", level: 5, abilities: all13, spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, prepared: [], known: [], cantrips: [] } });
    await levelInto("ranger");
    assert.deepEqual(storedSlots(now()), { 1: 4, 2: 2 }, `paladin 5 / ranger 1 holds ${JSON.stringify(storedSlots(now()))}, not the paladin's 4 + 2`);
  },
);

// ---- Using Ability Scores: Proficiency Bonus ----

await test("using-ability-scores / Proficiency Bonus: a bonus that would apply more than once is still added once and halved once; Jack of All Trades beside Remarkable Athlete is half the bonus, not the whole of it.", () => {
  const both = world.addHero({
    class: "fighter", subclass: "Champion", level: 9, proficiencies: profs(),
    classes: [{ id: "fighter", level: 7, subclass: "Champion" }, { id: "bard", level: 2, subclass: "" }],
    features: [{ name: "Remarkable Athlete", classId: "fighter" }, { name: "Jack of All Trades", classId: "bard" }],
  });
  const derived = computeSheetDerived(world.sheet(both.id));
  need(derived.proficiencyBonus === 4, `a 9th-level character's proficiency bonus is ${derived.proficiencyBonus}`);
  assert.equal(derived.initiative, 2, `initiative with both halves is +${derived.initiative}`);
  assert.equal(derived.skills.athletics, 2, `an untrained Athletics with both halves is +${derived.skills.athletics}`);
});

// ---- Using Ability Scores: Dexterity, Initiative ----

const runner = world.addHero({ class: "fighter", level: 5, acOverride: false, abilities: { str: 16, dex: 14 }, proficiencies: profs() });

await test("using-ability-scores / Initiative: initiative is a Dexterity check, so what puts ability checks at disadvantage (poisoned, a level of exhaustion) puts initiative there too.", () => {
  world.patch(runner.id, { conditions: [], exhaustion: 0 });
  assert.equal(initiativeD20s(runner.id), 1, "a clear initiative rolled at disadvantage");
  world.patch(runner.id, { conditions: ["poisoned"] });
  assert.equal(initiativeD20s(runner.id), 2, "a poisoned character's initiative is not at disadvantage");
  world.patch(runner.id, { conditions: [], exhaustion: 1 });
  assert.equal(initiativeD20s(runner.id), 2, "an exhausted character's initiative is not at disadvantage");
  world.patch(runner.id, { exhaustion: 0 });
});

await test(
  "ADV-03: using-ability-scores / Initiative: \"At the beginning of every combat, you roll initiative by making a Dexterity check.\" A Dexterity check at disadvantage (armor worn without training; heavily encumbered under Variant: Encumbrance, \"disadvantage on ability checks ... that use Strength, Dexterity, or Constitution\") is an initiative roll at disadvantage",
  () => {
    world.patch(runner.id, {
      conditions: [],
      proficiencies: profs({ armor: ["light"] }),
      equipment: [{ name: "Scale Mail", qty: 1 }],
    });
    const dexCheck = resolveRollExpression({ kind: "ability_check", ability: "dex", characterId: runner.id }, world.sheet(runner.id), rollExtrasFor(world.campaign(), world.sheet(runner.id), "ability_check"));
    need(/^2d20kl1/.test(dexCheck.expression), `untrained scale mail did not put a Dexterity check at disadvantage: ${dexCheck.expression}`);
    assert.equal(initiativeD20s(runner.id), 2, "initiative in untrained scale mail rolled one d20; a Dexterity check in it rolls two, the lower kept");
    world.patch(runner.id, {
      proficiencies: profs(),
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      equipment: [{ name: "Leather", qty: 1 }, { name: "Plate", qty: 1, equipped: false }, { name: "Chain Mail", qty: 1, equipped: false }],
    });
    const load = encumbranceFor({ strength: 10, equipment: world.sheet(runner.id).equipment, coins: 0 });
    need(load.tier === "heavily_encumbered", `the load is ${load.tier}, not heavily encumbered`);
    assert.equal(initiativeD20s(runner.id, withVariant("encumbrance")), 2, "a heavily encumbered character's initiative rolled one d20 under the encumbrance variant");
  },
);
world.patch(runner.id, { proficiencies: profs(), abilities: { str: 16, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, equipment: [], conditions: [] });

// ---- Using Ability Scores: Variant: Encumbrance ----

await test(
  "ADV-02: using-ability-scores / Variant: Encumbrance: \"When you use this variant, ignore the Strength column of the Armor table.\" Plate (Str 15) worn at Strength 13 with nothing else carried (65 lb, not in excess of 5 x 13) leaves the speed at 30",
  () => {
    world.patch(runner.id, { abilities: { str: 13, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, equipment: [{ name: "Plate", qty: 1 }], speed: 30, race: "human" });
    const sheet = world.sheet(runner.id);
    need(speedFor(sheet) === 20, `without the variant plate at Strength 13 moves ${speedFor(sheet)} ft, not the armor table's 20`);
    const load = encumbranceFor({ strength: 13, equipment: sheet.equipment, coins: 0 });
    need(load.speedPenalty === 0, `65 lb at Strength 13 already costs ${load.speedPenalty} ft of speed`);
    assert.equal(speedFor(sheet, { encumbrance: true }), 30, `under the encumbrance variant plate at Strength 13 moves ${speedFor(sheet, { encumbrance: true })} ft`);
  },
);
world.patch(runner.id, { abilities: { str: 16, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, equipment: [] });

// ---- Using Ability Scores: Passive Checks; Adventuring: Vision and Light ----

const scout = world.addHero({ class: "rogue", level: 1, abilities: { wis: 14 }, proficiencies: profs({ skills: ["perception"], tools: ["thieves' tools"] }) });
const helper = world.addHero({ class: "fighter", level: 1, proficiencies: profs() });
const passive = () => computeSheetDerived(world.sheet(scout.id)).passivePerception;

await test("adventuring / Vision and Light with using-ability-scores / Passive Checks: dim light is lightly obscured, disadvantage on Perception by sight, so a passive Perception there is 5 lower.", async () => {
  world.patch(scout.id, { conditions: [] });
  const score = passive();
  const caught = await world.invoke("check_notice", { sense: "perception", dc: score - 5, characterIds: [scout.id], light: "dim" });
  assert.equal(caught.ok, true, caught.error);
  assert.equal(caught.result.anyNoticed, true, "dim light cost more than 5 off a passive Perception");
  const missed = await world.invoke("check_notice", { sense: "perception", dc: score - 4, characterIds: [scout.id], light: "dim" });
  assert.equal(missed.result.anyNoticed, false, "dim light cost nothing off a passive Perception");
});

await test(
  "ADV-04: using-ability-scores / Passive Checks: \"If the character has advantage on the check, add 5. For disadvantage, subtract 5.\" with Advantage and Disadvantage: \"you don't roll more than one additional d20\". Poisoned (disadvantage on checks) and dim light (disadvantage on Perception by sight) together are one disadvantage, -5, not -10",
  async () => {
    world.patch(scout.id, { conditions: ["poisoned"] });
    const score = passive();
    const out = await world.invoke("check_notice", { sense: "perception", dc: score - 5, characterIds: [scout.id], light: "dim" });
    need(out.ok, out.error);
    world.patch(scout.id, { conditions: [] });
    assert.equal(out.result.anyNoticed, true, `a poisoned lookout in dim light missed a DC ${score - 5} thing with passive Perception ${score}: two disadvantages were taken as -10`);
  },
);

// ---- Using Ability Scores: Working Together ----

await test(
  "ADV-09: using-ability-scores / Working Together: \"A character can only provide help if the task is one that he or she could attempt alone. For example, trying to open a lock requires proficiency with thieves' tools, so a character who lacks that proficiency can't help another character in that task.\"",
  async () => {
    world.patch(scout.id, { conditions: [] });
    const helped = await world.invoke("take_action", { characterId: helper.id, action: "help", targetCharacterId: scout.id });
    need(helped.ok, `Help was refused: ${helped.error}`);
    need((world.sheet(helper.id).proficiencies.tools ?? []).length === 0, "the helper holds a tool proficiency");
    const { d20s } = await rolled({ characterId: scout.id, kind: "ability_check", ability: "dex", tool: "thieves' tools" }, [15, 4]);
    assert.equal(d20s.length, 1, "a helper with no thieves' tools proficiency gave advantage on picking a lock");
    // Trained with the tools, the same helper's Help gives the advantage.
    world.patch(helper.id, { proficiencies: profs({ tools: ["thieves' tools"] }) });
    const trained = await rolled({ characterId: scout.id, kind: "ability_check", ability: "dex", tool: "thieves' tools" }, [15, 4]);
    world.patch(helper.id, { proficiencies: profs() });
    world.patch(scout.id, { conditions: [], conditionMeta: {} });
    assert.equal(trained.d20s.length, 2, "a helper trained with thieves' tools gave no advantage on picking a lock");
  },
);

// ---- Using Ability Scores: Advantage and Disadvantage (Lucky) ----

const halfling = world.addHero({
  class: "rogue", level: 1, race: "halfling", proficiencies: profs(),
  features: [{ name: "Lucky", source: "race" }],
});

await test(
  "ADV-05: using-ability-scores / Advantage and Disadvantage: \"When you have advantage or disadvantage and something in the game, such as the halfling's Lucky trait, lets you reroll or replace the d20, you can reroll or replace only one of the dice.\" At disadvantage two 1s stay a 1: one die is rerolled, the other 1 is the lower",
  async () => {
    world.patch(halfling.id, { conditions: ["poisoned"] });
    const { out, d20s } = await rolled({ characterId: halfling.id, kind: "ability_check", ability: "dex" }, [1, 15, 1, 12]);
    world.patch(halfling.id, { conditions: [] });
    need(d20s.length >= 3, `a poisoned halfling threw ${d20s.length} d20s`);
    assert.equal(out.result.total, 1, `a poisoned halfling's two 1s became ${out.result.total}: both dice were rerolled`);
  },
);

// ---- Inspiration ----

await test("inspiration / Gaining Inspiration: you either have inspiration or you don't; a second award holds one, not two.", async () => {
  const first = await world.invoke("set_condition", { characterId: scout.id, condition: "inspiration", reason: "a fine speech" });
  assert.equal(first.ok, true, first.error);
  const second = await world.invoke("set_condition", { characterId: scout.id, condition: "inspiration", reason: "another" });
  assert.equal(second.ok, true, second.error);
  const held = world.sheet(scout.id).resources.inspiration;
  assert.equal(held.max - held.used, 1, `two awards hold ${held.max - held.used}`);
});

await test(
  "ADV-10: inspiration / Using Inspiration: \"if you have inspiration, you can reward another player ... you can give up your inspiration to give that character inspiration.\" Passing it spends the giver's and gives the other character one",
  async () => {
    need(world.sheet(scout.id).resources.inspiration.used === 0, "the giver holds no Inspiration");
    const passed = await world.invoke("set_condition", { characterId: helper.id, condition: "inspiration", sourceCharacterId: scout.id, reason: "for the rescue" });
    const giver = world.sheet(scout.id).resources.inspiration;
    const receiver = world.sheet(helper.id).resources?.inspiration;
    world.patch(scout.id, { resources: { ...world.sheet(scout.id).resources, inspiration: { max: 1, used: 1 } } });
    assert.equal(passed.ok, true, passed.error);
    assert.equal(receiver ? receiver.max - receiver.used : 0, 1, "the receiver holds no Inspiration");
    assert.equal(giver.max - giver.used, 0, "the giver kept their Inspiration after giving it away");
    // Only one who has it can give it up.
    world.patch(helper.id, { resources: { ...world.sheet(helper.id).resources, inspiration: { max: 1, used: 1 } } });
    const empty = await world.invoke("set_condition", { characterId: helper.id, condition: "inspiration", sourceCharacterId: scout.id, reason: "again" });
    assert.equal(empty.ok, false, "a giver with no Inspiration passed one on");
    assert.equal(world.sheet(helper.id).resources.inspiration.used, 1, "a refused pass still gave the receiver Inspiration");
  },
);

// ---- Adventuring: Travel Pace ----

await test(
  "ADV-11: adventuring / Travel Pace, the table's Day column: a day's travel (8 hours) covers 30 miles at a fast pace and 18 at a slow pace, not the hour column times 8 (32 and 16)",
  async () => {
    // An 8-hour leg rolls a new sky from Math.random (src/lib/dm/sky.ts), and
    // a frigid one is 8 hourly saves against extreme cold for the scout: a
    // few runs in a hundred their exhaustion broke the Vision and Light
    // checks below, and six levels killed them. 0.5 keeps the clear sky with
    // no drift, as scripts/test-enforce-exploration.mjs does.
    const random = Math.random;
    Math.random = () => 0.5;
    let fast;
    let slow;
    try {
      await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
      fast = await world.invoke("travel", { hours: 8, pace: "fast", characterIds: [scout.id] });
      need(fast.ok, fast.error);
      await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
      slow = await world.invoke("travel", { hours: 8, pace: "slow", characterIds: [scout.id] });
      need(slow.ok, slow.error);
    } finally {
      Math.random = random;
    }
    need(!fast.result.exposure && !slow.result.exposure, `the march rolled a hazard: ${fast.result.weather} then ${slow.result.weather}`);
    await world.invoke("pass_time", { amount: 10, unit: "minutes" });
    assert.deepEqual([fast.result.miles, slow.result.miles], [30, 18], `a day at a fast pace covers ${fast.result.miles} miles and at a slow pace ${slow.result.miles}`);
    // Forced March: each hour past 8 adds the Hour column; a day's 18 slow miles take the day.
    const { milesCovered, travelLeg } = await import("../src/lib/srd/travel.ts");
    assert.equal(milesCovered({ pace: "fast", hours: 10 }), 38, "two forced-march hours at a fast pace did not add 4 miles each to the 30");
    assert.equal(travelLeg({ pace: "slow", miles: 18 }).hours, 8, "18 miles at a slow pace did not take a full day");
  },
);

// ---- Adventuring: Vision and Light, a rolled check ----

// Night, off the board: the place's light is the sky's, dark at 22:00.
const clock = await import("../src/lib/db/clock.ts");
const { breakDown } = await import("../src/lib/dm/calendar.ts");
const hourNow = () => {
  const now = clock.getClock(world.campaignId);
  return breakDown(now.calendar, now.instant).hour;
};
await world.invoke("pass_time", { amount: (22 - hourNow() + 24) % 24 || 24, unit: "hours" });
// The hours just passed rolled fresh weather; rain or wind would put the
// checks below at disadvantage for a reason of their own.
await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
// The darkness alone is what fails the checks below: exhaustion would put
// them at disadvantage, and a dead scout notices nothing at any hour.
const fit = world.sheet(scout.id);
need(
  !(fit.exhaustion ?? 0) && !fit.conditions.length && !fit.deathSaves?.dead && fit.currentHp > 0,
  `the scout is not fit for the night checks: ${JSON.stringify({ exhaustion: fit.exhaustion, conditions: fit.conditions, hp: fit.currentHp, deathSaves: fit.deathSaves })}`,
);

await test("adventuring / Vision and Light: darkness blocks vision, not hearing; a Perception check by ear in the dark rolls as usual.", async () => {
  const { out, d20s } = await rolled({ characterId: scout.id, kind: "skill_check", skill: "perception", by: "hearing", dc: 10 }, [15]);
  assert.equal(d20s.length, 1);
  assert.equal(out.result.success, true);
});

await test(
  "ADV-06: adventuring / Vision and Light: \"A heavily obscured area, such as darkness ... blocks vision entirely. A creature effectively suffers from the blinded condition when trying to see something in that area\" (and in dim light \"creatures have disadvantage on Wisdom (Perception) checks that rely on sight\"). A rolled Perception check by sight in the dark, with no darkvision and no light, fails",
  async () => {
    need(hourNow() === 22, `the clock reads ${hourNow()}:00, not night`);
    const gate = await world.invoke("check_notice", { sense: "perception", dc: 5, characterIds: [scout.id] });
    need(gate.ok && (gate.result.applied ?? []).some((line) => /darkness/.test(line)), `check_notice did not see darkness: ${JSON.stringify(gate.result ?? gate.error)}`);
    const { out } = await rolled({ characterId: scout.id, kind: "skill_check", skill: "perception", by: "sight", dc: 10 }, [15, 4]);
    assert.equal(out.result.success, false, `a human with no light rolled ${out.result.total} on Perception by sight at night and saw what was there`);
  },
);

await test("adventuring / Vision and Light: darkvision sees in darkness as if it were dim light, so a rolled Perception by sight at night is at disadvantage, not failed.", async () => {
  const dwarf = world.addHero({ class: "fighter", level: 1, race: "dwarf", proficiencies: profs(), features: [{ name: "Darkvision", source: "race" }] });
  const { d20s } = await rolled({ characterId: dwarf.id, kind: "skill_check", skill: "perception", by: "sight", dc: 10 }, [15, 4]);
  assert.equal(d20s.length, 2, "a dwarf's Perception by sight in the dark rolled one d20, as in bright light");
});

// ---- Feats: Grappler ----

// Morning again: an outdoor board at night is dark, and the darkness's own
// advantage and disadvantage would cancel the Grappler's advantage.
await world.invoke("pass_time", { amount: 10, unit: "hours" });
need(hourNow() === 8, `the clock reads ${hourNow()}:00, not morning`);
const kit = await combatKit(world);
const grappler = world.addHero({
  class: "fighter", level: 5, abilities: { str: 12, dex: 12 }, proficiencies: profs(),
  equipment: [{ name: "Longsword", qty: 1 }], feats: ["Grappler"],
});

async function grapplingFight() {
  await kit.endFight();
  const heroFaces = Object.fromEntries(world.sheets().map((sheet) => [sheet.id, sheet.id === grappler.id ? 19 : 2]));
  await kit.fight(1, { heroFaces });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, conditions: ["grappled"], conditionMeta: { grappled: { source: grappler.id } } });
  kit.place(grappler.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  need(kit.current()?.characterId === grappler.id, "the grappler does not hold the turn");
  return enemy;
}

await test(
  "ADV-08: feats: \"If you ever lose a feat's prerequisite, you can't use that feat until you regain the prerequisite. For example, the Grappler feat requires you to have a Strength of 13 or higher. If your Strength is reduced below 13 ... you can't benefit from the Grappler feat\"",
  async () => {
    const enemy = await grapplingFight();
    need(world.sheet(grappler.id).abilities.str === 12, "the grappler's Strength is not 12");
    const swing = await kit.swing(grappler.id, enemy.id, [15, 4, 3], { weapon: "Longsword" });
    need(swing.ok, `the swing was refused: ${swing.error}`);
    assert.equal(d20Faces(swing.toHit).length, 1, "a Grappler at Strength 12 still attacked the creature it holds with advantage");
  },
);

await test(
  "ADV-07: feats / Grappler: \"You can use your action to try to pin a creature grappled by you. To do so, make another grapple check. If you succeed, you and the creature are both restrained until the grapple ends.\"",
  async () => {
    world.patch(grappler.id, { abilities: { str: 16, dex: 12, con: 10, int: 10, wis: 10, cha: 10 } });
    const enemy = await grapplingFight();
    kit.freshTurn();
    world.clearDice();
    world.dice(20, 1, 1);
    const pinned = await world.invoke("take_action", { characterId: grappler.id, action: "pin", targetEnemyId: enemy.id });
    world.clearDice();
    assert.equal(pinned.ok, true, `the pin was refused: ${pinned.error}`);
    const held = kit.enemy(enemy.id).conditions.map((name) => name.toLowerCase());
    const self = world.sheet(grappler.id).conditions.map((name) => name.toLowerCase());
    assert.ok(held.includes("restrained") && self.includes("restrained"), `after the pin the creature holds [${held}] and the grappler [${self}]`);
    // "Until the grapple ends": the grapple let go, the grappler's own restraint goes with it.
    const letGo = await world.invoke("clear_enemy_condition", { enemyId: enemy.id, condition: "grappled", reason: "lets go" });
    assert.equal(letGo.ok, true, letGo.error);
    const after = world.sheet(grappler.id).conditions.map((name) => name.toLowerCase());
    assert.ok(!after.includes("restrained"), `the grapple ended and the grappler is still [${after}]`);
  },
);

await kit.endFight();
world.close();
finish();
