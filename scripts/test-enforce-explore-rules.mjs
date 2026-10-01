// The exploration rows the recount found narrated or missing
// (/tmp/odm-enf2/recount/explore.md, section 3), each written here as the
// engine holding it.
//
// The rules, from SRD 5.1:
//   - Contests: both sides roll a check and the higher total wins; a tie
//     leaves things as they were. A monster's check uses its stat block.
//   - Variant, Skills with Different Abilities: a Constitution (Athletics)
//     check adds Constitution and the Athletics proficiency.
//   - Travel Pace: only a slow pace lets the party use stealth; a pace covers
//     4, 3 or 2 miles an hour, half that in difficult terrain.
//   - Vision and Light: characters face darkness outdoors at night and
//     within an unlit dungeon or subterranean vault.
//   - Lifting and Carrying: carrying capacity is Strength x 15 pounds; a
//     creature can push, drag or lift up to twice that (30 x Strength), and
//     while pushing or dragging more than its capacity its speed is 5 feet.
//   - Armor, Getting Into and Out of Armor: light 1 minute on and off,
//     medium 5 on and 1 off, heavy 10 on and 5 off.
//   - Food and Water: a character already exhausted takes two levels for a
//     day without water.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { postUsage, clockOf } from "./lib/enforce-resources.mjs";

const { test, finish } = suite("test-enforce-explore-rules");
const world = await openWorld({ campaign: { maxPlayers: 30 } });
const kit = await combatKit(world);
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { getClock, setClockInstant } = await import("../src/lib/db/clock.ts");
const { upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { speedFor } = await import("../src/lib/srd/index.ts");

const profs = (extra = {}) => ({
  saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [], ...extra,
});
const lastRollOf = (id) => listRecentRolls(world.campaignId, 20).find((roll) => roll.characterId === id && roll.kind === "skill_check");
await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
const at = async (hour) => {
  const day = Math.floor(getClock(world.campaignId).instant / 1440) + 1;
  setClockInstant(world.campaignId, day * 1440 + hour * 60);
  await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
};

// ---- contests against a creature ----

await test("A check contested by a creature rolls the creature's own check from its stat block: a character's Deception against an enemy with Insight +5 that rolls 10 needs 16 (a tie leaves things as they were).", async () => {
  const liar = world.addHero({ class: "rogue", level: 3, abilities: { cha: 14 }, proficiencies: profs({ skills: ["deception"] }) });
  await kit.fight(1, { heroFaces: { [liar.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { stats: { skills: { insight: 5 } } });
  world.clearDice();
  world.dice(10, 12);
  const out = await world.invoke("request_roll", { characterId: liar.id, kind: "skill_check", skill: "deception", againstEnemyId: enemy.id, reason: "a bluff" });
  world.clearDice();
  await kit.endFight();
  assert.equal(out.ok, true, out.error);
  assert.equal(lastRollOf(liar.id).dc, 16, "the contest was not rolled against the creature's Insight");
  assert.equal(out.result.success, true, "12 + 4 = 16 beats the creature's 15");
});

await test("A hidden creature is noticed against its own Stealth check: a passive Perception 15 misses an enemy with Stealth +6 that rolls 10 (16), and catches it when it rolls 8 (14).", async () => {
  const lookout = world.addHero({ class: "ranger", level: 1, abilities: { wis: 16 }, proficiencies: profs({ skills: ["perception"] }) });
  await kit.fight(1, { heroFaces: { [lookout.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { stats: { skills: { stealth: 6 } } });
  world.clearDice();
  world.dice(10);
  const hidden = await world.invoke("check_notice", { characterIds: [lookout.id], againstEnemyId: enemy.id, reason: "a goblin in the brush" });
  world.dice(8);
  const seen = await world.invoke("check_notice", { characterIds: [lookout.id], againstEnemyId: enemy.id, reason: "a goblin in the brush" });
  world.clearDice();
  await kit.endFight();
  assert.equal(hidden.ok, true, hidden.error);
  assert.equal(hidden.result.dc, 16);
  assert.deepEqual(hidden.result.noticedBy, []);
  assert.equal(seen.result.dc, 14);
  assert.equal(seen.result.noticedBy.length, 1);
});

// ---- a skill with a different ability ----

await test("A Constitution (Athletics) check adds the Constitution modifier and the Athletics proficiency: CON 16, STR 8, proficiency +2, a 10 on the die is 15.", async () => {
  const swimmer = world.addHero({ class: "fighter", level: 1, abilities: { str: 8, con: 16 }, proficiencies: profs({ skills: ["athletics"] }) });
  world.clearDice();
  world.dice(10);
  const out = await world.invoke("request_roll", { characterId: swimmer.id, kind: "skill_check", skill: "athletics", ability: "con", reason: "a long swim" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(lastRollOf(swimmer.id).total, 15);
});

// ---- travel ----

const walker = world.addHero({ class: "rogue", level: 3, abilities: { dex: 14 }, proficiencies: profs({ skills: ["stealth"] }) });

await test("While the party marches at a normal or fast pace no one can use stealth: a Stealth check or group check is refused until a slow pace or the march ends.", async () => {
  await at(9);
  await world.invoke("travel", { hours: 2, pace: "normal", characterIds: [walker.id] });
  const sneak = await world.invoke("request_roll", { characterId: walker.id, kind: "skill_check", skill: "stealth", reason: "past a patrol" });
  const group = await world.invoke("group_check", { skill: "stealth", characterIds: [walker.id], difficulty: "moderate" });
  await world.invoke("travel", { hours: 2, pace: "slow", characterIds: [walker.id] });
  world.dice(10);
  const slow = await world.invoke("request_roll", { characterId: walker.id, kind: "skill_check", skill: "stealth", reason: "past a patrol" });
  world.clearDice();
  assert.equal(sneak.ok, false, "a normal-pace march allowed stealth");
  assert.equal(group.ok, false, "a normal-pace march allowed a group stealth check");
  assert.equal(slow.ok, true, slow.error);
  await world.invoke("pass_time", { amount: 10, unit: "minutes" });
});

await test("Travel reports the miles covered (4, 3 or 2 an hour, half in difficult terrain), and a journey given in miles takes the hours its pace needs.", async () => {
  await at(8);
  const fast = await world.invoke("travel", { hours: 6, pace: "fast", characterIds: [walker.id] });
  assert.equal(fast.ok, true, fast.error);
  assert.equal(fast.result.miles, 24);
  // A long march can roll new weather; the rough leg is measured in clear air.
  await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
  const rough = await world.invoke("travel", { hours: 6, pace: "normal", terrain: "difficult", characterIds: [walker.id] });
  assert.equal(rough.result.miles, 9);
  await at(8);
  const before = clockOf(world);
  const leg = await world.invoke("travel", { miles: 9, pace: "slow", characterIds: [walker.id] });
  assert.equal(leg.ok, true, leg.error);
  assert.equal(clockOf(world) - before, 270, "9 miles at 2 miles an hour is 4.5 hours");
  await world.invoke("pass_time", { amount: 10, unit: "minutes" });
});

// ---- light off the board ----

const scout = world.addHero({ class: "fighter", level: 3, abilities: { wis: 14 }, proficiencies: profs({ skills: ["perception"] }) });
const notices = async (extra = {}, dc = 5) => {
  const out = await world.invoke("check_notice", { dc, characterIds: [scout.id], ...extra });
  assert.equal(out.ok, true, out.error);
  return out.result.noticedBy.length === 1;
};

await test("Off the board the light is the place's, not the sky's: a lit inn at night lets a character see, a cave at noon is dark, and a light the DM names (dim) is -5.", async () => {
  await at(22);
  upsertCurrentLocation({ campaignId: world.campaignId, name: "The Prancing Pony Inn", layoutDescription: "a busy common room" });
  assert.equal(await notices(), true, "a lit inn at night was darkness");
  await at(12);
  upsertCurrentLocation({ campaignId: world.campaignId, name: "Goblin Cave", layoutDescription: "a damp cavern under the hill" });
  assert.equal(await notices(), false, "a cave at noon was bright");
  world.patch(scout.id, { equipment: [{ name: "Torch", qty: 1 }] });
  assert.equal(await notices(), true, "a torch in the cave gave no light");
  world.patch(scout.id, { equipment: [] });
  upsertCurrentLocation({ campaignId: world.campaignId, name: "Kingsroad", layoutDescription: "an open road" });
  // Passive Perception 14 (WIS +2, proficiency +2): DC 14 is caught in bright
  // light and missed in dim.
  assert.equal(await notices({}, 14), true);
  assert.equal(await notices({ light: "dim" }, 14), false, "the light the DM named was ignored");
});

// ---- carrying, lifting ----

await test("A character cannot carry more than Strength x 15 pounds: 65 lb of plate is refused to a Strength 3 character, and one already past the capacity moves at 5 feet.", async () => {
  const weak = world.addHero({ class: "wizard", level: 1, abilities: { str: 3 } });
  const refused = await world.invoke("grant_item", { characterId: weak.id, name: "Plate Armor" });
  assert.equal(refused.ok, false, "65 lb of plate was granted past a 45 lb capacity");
  world.patch(weak.id, { gold: 2000 });
  const bought = await world.invoke("purchase", { characterId: weak.id, item: "Plate Armor", price: 1500, action: "buy" });
  assert.equal(bought.ok, false, "65 lb of plate was bought past a 45 lb capacity");
  const strong = world.addHero({ class: "fighter", level: 1, abilities: { str: 10 } });
  const granted = await world.invoke("grant_item", { characterId: strong.id, name: "Plate Armor" });
  assert.equal(granted.ok, true, granted.error);
  world.patch(strong.id, { equipment: [{ name: "Plate Armor", qty: 2 }, { name: "Chain Mail", qty: 1 }] });
  assert.equal(speedFor(world.sheet(strong.id)), 5, "185 lb on a 150 lb capacity did not drop the speed to 5 feet");
});

await test("A character can push, drag or lift up to 30 x Strength pounds: 301 lb is refused at Strength 10, and 250 lb is moved at 5 feet (past the 150 lb capacity).", async () => {
  const mover = world.addHero({ class: "fighter", level: 1, abilities: { str: 10 } });
  const heavy = await world.invoke("lift", { characterId: mover.id, weightLb: 301, how: "drag", reason: "a fallen beam" });
  assert.equal(heavy.ok, false, "301 lb was dragged at Strength 10");
  const drag = await world.invoke("lift", { characterId: mover.id, weightLb: 250, how: "drag", reason: "a crate" });
  assert.equal(drag.ok, true, drag.error);
  assert.equal(drag.result.speed, 5);
});

// ---- armor takes time out of a fight ----

await test("Putting on heavy armor takes 10 minutes and taking it off 5, and the clock moves by that much.", async () => {
  const knight = world.addHero({ class: "fighter", level: 1, abilities: { str: 16 }, proficiencies: profs({ armor: ["light", "medium", "heavy", "shields"] }), equipment: [{ name: "Plate Armor", qty: 1, equipped: false }, { name: "Longsword", qty: 1, equipped: true }] });
  const before = clockOf(world);
  const on = await postUsage(world, knight.id, { gear: { "Plate Armor": { equipped: true } } });
  assert.equal(on.status, 200, on.json.error);
  assert.equal(clockOf(world) - before, 10, "donning plate moved no time");
  const off = await postUsage(world, knight.id, { gear: { "Plate Armor": { equipped: false } } });
  assert.equal(off.status, 200, off.json.error);
  assert.equal(clockOf(world) - before, 15, "doffing plate moved no time");
});

await test("Ending attunement on purpose takes another short rest spent with the item: out of a fight the clock moves an hour; a pending attunement is dropped at once.", async () => {
  const wearer = world.addHero({ class: "fighter", level: 1, equipment: [{ name: "Ring of Protection", qty: 1, equipped: true, attuned: true }, { name: "Cloak of Protection", qty: 1, equipped: true, attuning: true }] });
  const before = clockOf(world);
  const pending = await postUsage(world, wearer.id, { gear: { "Cloak of Protection": { attuned: false } } });
  assert.equal(pending.status, 200, pending.json.error);
  assert.equal(clockOf(world) - before, 0, "dropping a pending attunement took time");
  const ended = await postUsage(world, wearer.id, { gear: { "Ring of Protection": { attuned: false } } });
  assert.equal(ended.status, 200, ended.json.error);
  assert.equal(world.sheet(wearer.id).equipment.find((item) => item.name === "Ring of Protection").attuned, false);
  assert.equal(clockOf(world) - before, 60, "ending an attunement moved no time");
});

// ---- food and water ----

const RULES = {
  flanking: false, criticalFumbles: false, encumbrance: false, lingeringInjuries: false,
  powerfulCritical: false, criticalDamageMods: false, ammunition: false, restVariant: "standard",
};
const fed = await openWorld({ gameSettings: { variantRules: { ...RULES, supplies: true } } });

await test("Under the supplies variant a character already exhausted takes two levels, not one, for a day without water.", async () => {
  const parched = fed.addHero({ class: "fighter", level: 3, maxHp: 30, equipment: [{ name: "Rations (1 day)", qty: 2 }] });
  fed.patch(parched.id, { exhaustion: 1 });
  await fed.invoke("pass_time", { amount: 1, unit: "days" });
  assert.equal(fed.sheet(parched.id).exhaustion, 3);
});

await test("Under the supplies variant, a day on half the water a character needs is a DC 15 CON save or a level of exhaustion, and a day with none is a level whatever they carry.", async () => {
  const thirsty = fed.addHero({ class: "fighter", level: 3, maxHp: 30, abilities: { con: 10 }, equipment: [{ name: "Rations (1 day)", qty: 4 }, { name: "Waterskin", qty: 1 }] });
  fed.clearDice();
  fed.dice(5);
  const half = await fed.invoke("pass_time", { amount: 1, unit: "days", water: "half" });
  fed.clearDice();
  assert.equal(half.ok, true, half.error);
  assert.equal(fed.sheet(thirsty.id).exhaustion, 1, "a failed DC 15 save on half water cost no exhaustion");
  fed.dice(18);
  await fed.invoke("pass_time", { amount: 1, unit: "days" });
  fed.clearDice();
  assert.equal(fed.sheet(thirsty.id).exhaustion, 1, "a made save on half water still cost exhaustion");
  await fed.invoke("pass_time", { amount: 1, unit: "days", water: "none" });
  assert.equal(fed.sheet(thirsty.id).exhaustion, 3, "a day with no water, already exhausted, is two levels");
  await fed.invoke("pass_time", { amount: 1, unit: "hours", water: "plenty" });
});

// ---- what the narrator is told ----

await test("The narrator's rules name the tools and arguments these rows now run on, and the combat rules carry last-combat's grapple, drag, troll, parry and underwater sentences.", async () => {
  const { dmSystemText, encounterRulesText, requestRollTool } = await import("../src/lib/dm/prompt.ts");
  const text = dmSystemText(false);
  for (const phrase of [
    "againstEnemyId in a fight or againstMonster",
    "passes that ability beside the skill",
    "nobody can sneak",
    "are laid on with afflict",
    "set_lifestyle when the party settles in town",
    "downtime for days of crafting",
    "shifting something heavy is lift",
    "Putting armor on or taking it off outside a fight takes its SRD minutes",
    "reports the miles covered",
    "pass light when you know better",
    "A blinded character automatically fails a check that needs sight",
    "the server spends no slot for it and uses the item's save DC",
  ]) {
    assert.ok(text.includes(phrase), `the rules never say "${phrase}"`);
  }
  assert.equal(text.includes("resolve its effect with aoe_damage, apply_damage, set_condition, or heal"), false, "the old charged-item sentence still stands");
  const combat = encounterRulesText(false);
  for (const phrase of [
    "against the escape DC the stat block prints",
    "move_token with drag true halves its speed",
    "narrate it collapsing, not dying",
    "never narrate a parry the attack result does not report",
    "fights underwater",
  ]) {
    assert.ok(combat.includes(phrase), `the combat rules never say "${phrase}"`);
  }
  const roll = requestRollTool.function.parameters.properties;
  for (const key of ["againstEnemyId", "againstMonster", "contestSkill", "ability"]) {
    assert.ok(roll[key], `request_roll does not offer ${key}`);
  }
});

world.close();
finish();
