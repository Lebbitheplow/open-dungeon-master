// The order of a tool's refusals (src/lib/dm/tool-errors.ts): what bars the
// act itself (the turn, the character's state, the action, the slots or
// uses) is refused before anything that asks the player a question or says
// the act can go without a part. Each case pairs one such question or
// partial with each thing that bars the act, through the call the turn loop
// dispatches for the model, and asserts the bar is what comes back.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";
import { fightDummies, layMap, wizard } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-check-order");

const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { listSheets } = await import("../src/lib/db/sheets.ts");
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { attacksAllowedFor, budgetFor, storeBudget } = await import("../src/lib/dm/turn-budget.ts");
const encounters = await import("../src/lib/db/encounters.ts");

// The model's call on a DM turn of the AI's own, after the actor's player spoke.
async function ai(world, name, args, actor) {
  world.say("player", "I do it.", actor);
  const turn = createDmTurn(world.campaignId, []);
  const sheets = listSheets(world.campaignId);
  return dispatchAdjudication(name, JSON.stringify(args), { campaign: world.campaign(), turn, sheets, sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])), realDiceUserIds: new Set() });
}

function turnTo(world, refId) {
  const encounter = world.encounter();
  const index = encounter.order.findIndex((entry) => entry.kind === "pc" && entry.characterId === refId);
  encounters.saveEncounter({ ...encounter, turnIndex: index, turnBudget: null, reactionsUsed: [] });
}

// What the turn has already spent, written into its budget.
function spendTurn(world, sheet, spent) {
  const encounter = world.encounter();
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet));
  storeBudget(encounter, { ...budget, ...spent(budget) });
}

const fighter = (extra = {}) => ({
  name: "Kara", class: "fighter", level: 5, maxHp: 50, proficiencies: TRAINED,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }], ...extra,
});
const monk = { name: "Kara", class: "monk", level: 5, maxHp: 40, proficiencies: TRAINED, abilities: { str: 10, dex: 16, con: 14, int: 10, wis: 15, cha: 8 }, equipment: [{ name: "Shortsword", qty: 1, equipped: true }] };
const caster = (base, prepared) => ({ ...base, spellcasting: { ...base.spellcasting, prepared } });
const evoker = caster(wizard(14, { name: "Kara", subclass: "School of Evocation" }), ["Disintegrate", "Magic Missile", "Polymorph", "Fireball"]);
const druid = (extra = {}) => ({
  name: "Kara", class: "druid", level: 5, maxHp: 40, proficiencies: TRAINED, abilities: { str: 10, dex: 14, con: 14, int: 12, wis: 16, cha: 8 },
  equipment: [{ name: "Druidic focus", qty: 1 }],
  spellcasting: { ability: "wis", cantrips: [], known: [], prepared: ["Conjure Animals"], slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } } },
  ...extra,
});
const cleric = {
  name: "Kara", class: "cleric", subclass: "Life Domain", level: 5, maxHp: 40, proficiencies: TRAINED, abilities: { str: 12, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
  equipment: [{ name: "Holy symbol", qty: 1, equipped: true }],
  spellcasting: { ability: "wis", cantrips: [], known: [], prepared: ["Bless"], slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } } },
};
const WOLF = { form: "Wolf", beastHp: 5, beastMaxHp: 11, beastAc: 13, kind: "wildshape" };

const ACTION_GONE = /already (made all|used their action)/;
// What bars the act, and how its refusal reads.
const BARS = {
  "another character's turn": { set: (world, ids) => turnTo(world, ids.ally), reads: /not Kara's turn|It is Bren's turn/ },
  stunned: { set: (world, ids) => world.patch(ids.hero, { conditions: ["stunned"] }), reads: /stunned/ },
  "the action spent": { set: (world, ids) => spendTurn(world, world.sheet(ids.hero), (budget) => ({ actionUsed: true, attacksMade: budget.attacksAllowed })), reads: ACTION_GONE },
  "the bonus action spent": { set: (world, ids) => spendTurn(world, world.sheet(ids.hero), () => ({ bonusUsed: true })), reads: /already used their bonus action/ },
  "no slot left": {
    set: (world, ids) => {
      const casting = world.sheet(ids.hero).spellcasting;
      world.patch(ids.hero, { spellcasting: { ...casting, slots: Object.fromEntries(Object.entries(casting.slots).map(([level, slot]) => [level, { ...slot, used: slot.max }])) } });
    },
    reads: /no spell slot of level/,
  },
  "no use left": {
    set: (world, ids) => world.patch(ids.hero, { resources: Object.fromEntries(Object.entries(world.sheet(ids.hero).resources).map(([key, value]) => [key, { ...value, used: value.max }])) }),
    reads: /has 0\/\d+ .* left/,
  },
};

// Each question or partial: who asks it, the call, what is arranged first,
// and the bars that apply to it.
const CASES = [
  { asks: "Great Weapon Master on a light weapon (attack without it)", hero: fighter({ feats: ["Great Weapon Master"] }), tool: "pc_attack", args: { weapon: "Longsword", powerAttack: true }, bars: ["another character's turn", "stunned", "the action spent"] },
  { asks: "a maneuver never picked (attack without it)", hero: fighter(), tool: "pc_attack", args: { weapon: "Longsword", maneuver: "Precision Attack" }, bars: ["another character's turn", "stunned", "the action spent"] },
  { asks: "Stunning Strike with no ki (attack without it)", hero: monk, tool: "pc_attack", args: { weapon: "Shortsword", stunningStrike: true }, arrange: (world, ids) => world.patch(ids.hero, { resources: { ...world.sheet(ids.hero).resources, ki: { ...world.sheet(ids.hero).resources.ki, used: 5 } } }), bars: ["another character's turn", "stunned", "the action spent"] },
  { asks: "Divine Smite at a spent level (which slot)", hero: fighter({ class: "paladin", spellcasting: { ability: "cha", cantrips: [], known: [], prepared: ["Bless"], slots: { 1: { max: 4, used: 4 }, 2: { max: 2, used: 0 } } } }), tool: "pc_attack", args: { weapon: "Longsword", smite: 1 }, bars: ["another character's turn", "stunned", "the action spent"] },
  { asks: "Flurry of Blows before the Attack action (attack first)", hero: monk, tool: "use_resource", args: { resource: "ki", variant: "flurry of blows" }, bars: ["another character's turn", "stunned", "the bonus action spent", "no use left"] },
  { asks: "Magic Missile at a spent level (which slot)", hero: evoker, tool: "cast_at_enemy", args: { spell: "Magic Missile", saveAbility: "dex" }, arrange: (world, ids) => world.patch(ids.hero, { spellcasting: { ...world.sheet(ids.hero).spellcasting, slots: { ...world.sheet(ids.hero).spellcasting.slots, 1: { max: 4, used: 4 } } } }), bars: ["another character's turn", "stunned", "the action spent"] },
  { asks: "Overchannel on a 6th-level spell (cast without it)", hero: evoker, tool: "cast_at_enemy", args: { spell: "Disintegrate", saveAbility: "dex", overchannel: true }, bars: ["another character's turn", "stunned", "the action spent", "no slot left"] },
  { asks: "Overchannel on an area by a caster without it (cast without it)", hero: caster(wizard(5, { name: "Kara" }), ["Fireball"]), tool: "aoe_damage", args: { spell: "Fireball", overchannel: true }, area: true, bars: ["another character's turn", "stunned", "the action spent", "no slot left"] },
  { asks: "Polymorph with no beast named (which beast)", hero: evoker, tool: "cast_at_enemy", args: { spell: "Polymorph", saveAbility: "wis" }, bars: ["another character's turn", "stunned", "the action spent", "no slot left"] },
  { asks: "Conjure Animals with no creature named (which creature)", hero: druid(), tool: "cast_buff", args: { spell: "Conjure Animals" }, bars: ["another character's turn", "stunned", "the action spent", "no slot left"] },
  { asks: "Wild Shape with no form named (which beast)", hero: druid(), tool: "use_resource", args: { resource: "wild_shape" }, bars: ["another character's turn", "stunned", "the action spent", "no use left"] },
  { asks: "Channel Divinity with no option named (which option)", hero: cleric, tool: "use_resource", args: { resource: "channel_divinity" }, bars: ["another character's turn", "stunned", "the action spent", "no use left"] },
  { asks: "Combat Wild Shape healing with no slot level (which slot)", hero: druid({ subclass: "Circle of the Moon" }), tool: "use_spell_slot", args: { spell: "Combat Wild Shape" }, arrange: (world, ids) => world.patch(ids.hero, { wildShape: WOLF }), bars: ["another character's turn", "stunned", "the bonus action spent"] },
  { asks: "stabilizing with a healer's kit they lack (try the check instead)", hero: fighter(), tool: "stabilize", stabilize: { method: "kit" }, bars: ["another character's turn", "stunned", "the action spent"] },
];

for (const entry of CASES) {
  for (const bar of entry.bars) {
    await test(`${entry.asks}: ${bar} is refused first`, async () => {
      const world = await openWorld({ campaign: { maxPlayers: 4 } });
      const kara = world.addHero(entry.hero);
      const ally = world.addHero(fighter({ name: "Bren" }));
      const [enemy, other] = await fightDummies(world, 2, { heroFaces: { [kara.id]: 20, [ally.id]: 2 } });
      await layMap(world, ["......", "......", "......"], { [kara.id]: { x: 1, y: 1 }, [ally.id]: { x: 0, y: 0 }, [enemy.id]: { x: 2, y: 1 }, [other.id]: { x: 2, y: 2 } });
      turnTo(world, kara.id);
      const ids = { hero: kara.id, ally: ally.id };
      entry.arrange?.(world, ids);
      // The question itself, with nothing else in the way.
      const args = entry.stabilize
        ? { characterId: ally.id, healerId: kara.id, ...entry.stabilize }
        : { ...(entry.area ? { casterId: kara.id, enemyIds: [enemy.id] } : { characterId: kara.id }), ...(entry.tool === "pc_attack" || entry.tool === "cast_at_enemy" ? { targetEnemyId: enemy.id } : {}), ...(entry.tool === "cast_buff" ? { targetCharacterIds: [kara.id] } : {}), ...entry.args };
      if (entry.stabilize) {
        world.patch(ally.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
      }
      const alone = await ai(world, entry.tool, args, kara);
      assert.equal(alone.retry, true, `the question itself: ${JSON.stringify(alone).slice(0, 300)}`);
      BARS[bar].set(world, ids);
      const barred = await ai(world, entry.tool, args, kara);
      assert.equal(barred.refused, "rules", `${bar}: ${JSON.stringify(barred).slice(0, 300)}`);
      assert.match(barred.error, BARS[bar].reads);
      world.close();
    });
  }
}

await finish();
