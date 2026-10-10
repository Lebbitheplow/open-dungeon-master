// The seam between the AI narrator and the rules engine.
//
// The engine resolves and the model narrates, so what the model is TOLD must
// match what the engine does, and what the model SENDS must reach the engine
// only by the rules path. Three kinds of check live here:
//
//   - The prompt: the built system text and the tool schemas the model is
//     offered, read as text. No model is called; a stale sentence that tells
//     the model to do something the engine refuses (or to bypass what it
//     enforces) is the failure.
//   - The AI's door into the engine: invokeEngine with actor kind "ai", the
//     way a delegated turn reaches the handlers, and what it leaves stored.
//   - The turn loop itself, run whole against a scripted fake model
//     (scripts/lib/enforce-narrator.mjs): the order a reply's calls resolve
//     in, the correction call held in reserve for the narration guard, the
//     prose withheld beside an outcome tool, and the intent a player's card
//     carries. What is read is stored state: sheets, enemy rows, the stored
//     DM message, and the requests the loop sent.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { aiEngine, call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-narrator");
const world = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: true } });
const kit = await combatKit(world);
const ai = await aiEngine(world);
const model = await fakeModel();
model.pointAt(world);

const { buildDmMessages, requestRollTool } = await import("../src/lib/dm/prompt.ts");
const { mutationTools } = await import("../src/lib/dm/mutations.ts");
const { listMembers } = await import("../src/lib/db/campaigns.ts");
const { checkNarration } = await import("../src/lib/dm/engine-boundary.ts");
const { emptyTurnLine } = await import("../src/lib/dm/empty-turn.ts");

const kara = world.addHero({
  name: "Kara", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});
const mira = world.addHero({
  name: "Mira", class: "wizard", level: 5, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: {
    ability: "int", slots: { 1: { max: 4, used: 0 }, 3: { max: 2, used: 0 } },
    prepared: ["Magic Missile", "Fireball", "Shield"], known: [], cantrips: ["Fire Bolt"],
  },
});

// ---- the prompt, as text ----

const ENEMY_STATE = {
  round: 1,
  orderReady: true,
  order: [{ name: "Kara", current: true }],
  awaitingInitiative: [],
  turnBudget: null,
  enemies: [{
    enemyId: "enemy-1", name: "Goblin 1", hp: "7/7", ac: 15, status: "alive", conditions: [],
    attacks: [], traits: [], resist: "", immune: "", vulnerable: "", concentration: null,
  }],
  map: null,
};

// The whole system message a turn would send, for a campaign as given.
function systemText({ campaign = world.campaign(), encounter = ENEMY_STATE } = {}) {
  const messages = buildDmMessages(
    {
      campaign,
      members: listMembers(world.campaignId),
      sheets: world.sheets(),
      encounter,
      recentRolls: [],
      storySummary: "",
    },
    [],
  );
  return messages[0].content;
}

function withVariant(name, on) {
  const campaign = world.campaign();
  return {
    ...campaign,
    gameSettings: {
      ...campaign.gameSettings,
      variantRules: { ...campaign.gameSettings.variantRules, [name]: on },
    },
  };
}

const updateSheetTool = mutationTools.find((entry) => entry.function.name === "update_sheet");

await test("The prompt never tells the model to change a level or an ability score with update_sheet; a level-up is the player's.", () => {
  const text = systemText();
  assert.doesNotMatch(text, /level or ability score change/i);
  assert.doesNotMatch(updateSheetTool.function.description, /level or ability score/i);
});

await test("The AI's update_sheet schema offers no level, XP, hit points, AC, conditions, gold, class or subclass.", () => {
  const offered = Object.keys(updateSheetTool.function.parameters.properties);
  for (const field of ["level", "xp", "maxHp", "currentHp", "tempHp", "ac", "conditions", "gold", "class", "subclass"]) {
    assert.ok(!offered.includes(field), `update_sheet still offers ${field}`);
  }
});

await test("A save effect on one character goes through cast_at_player; the prompt never offers request_roll plus apply_damage for it.", () => {
  assert.doesNotMatch(systemText(), /request_roll kind=saving_throw plus apply_damage/);
});

await test("The prompt says stabilize rolls the Medicine check itself, not that it follows one.", () => {
  const text = systemText();
  assert.doesNotMatch(text, /after a successful DC 10 Medicine check/);
  assert.match(text, /stabilize[^.]*healerId[^.]*rolls/);
});

await test("With the ammunition variant on, the prompt never tells the model that ammunition is not tracked.", () => {
  const on = systemText({ campaign: withVariant("ammunition", true) });
  assert.doesNotMatch(on, /Never track ammunition/);
  assert.doesNotMatch(on, /Ammunition is never tracked/);
  assert.match(on, /ammunition/i);
  const off = systemText({ campaign: withVariant("ammunition", false) });
  assert.match(off, /Never track ammunition|Ammunition is never tracked/);
});

await test("Where a shop is open, the prompt sends buying and selling to buy_item and sell_item, which price from the shelf.", () => {
  const rule = systemText().split("\n").find((line) => line.startsWith("- One roll per uncertain action")) ?? "";
  assert.match(rule, /buy_item[^.]*sell_item/);
});

await test("request_roll's expression never suggests rolling an NPC attack.", () => {
  assert.doesNotMatch(requestRollTool.function.parameters.properties.expression.description, /NPC attack/);
});

await test("GAME STATE never names damage_enemy as a way a blow changes an enemy's hit points.", () => {
  assert.doesNotMatch(systemText(), /only damage_enemy and enemy_attack change them/);
});

await test("The set_enemy_condition rule says a character's grapple, shove or spell applies its condition through its own tool.", () => {
  const rule = systemText().split("\n").find((line) => line.includes("call set_enemy_condition BEFORE")) ?? "";
  assert.match(rule, /take_action/);
  assert.match(rule, /cast_at_enemy/);
});

await test("request_roll offers damageType, so a damage roll the engine applies meets resistance and immunity.", () => {
  assert.ok(requestRollTool.function.parameters.properties.damageType, "no damageType on request_roll");
});

await test("Every tool the rules name is one the turn offers, and every other snake_case word is one of the tools' own arguments.", async () => {
  const { dmTurnToolCatalogue } = await import("../src/lib/dm/turn.ts");
  const catalogue = dmTurnToolCatalogue(world.campaign(), true, false);
  const tools = new Set(catalogue.map((entry) => entry.function.name));
  const argumentWords = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        argumentWords.add(key);
        walk(inner);
      }
    } else if (typeof value === "string") {
      argumentWords.add(value);
    }
  };
  catalogue.forEach((entry) => walk(entry.function.parameters));
  const named = [...new Set(systemText().match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])];
  // complete_beat is offered only at a table with a story arc; the rule
  // that names it stands either way.
  const unknown = named.filter((word) => !tools.has(word) && !argumentWords.has(word) && word !== "complete_beat");
  assert.deepEqual(unknown, [], `the prompt names ${unknown.join(", ")}, which no offered tool knows`);
  for (const option of ["reckless", "stunningStrike", "nonlethal", "bonusAttack", "advantageReason", "useInspiration", "damageType"]) {
    assert.ok(argumentWords.has(option), `the prompt teaches ${option}, which no tool takes`);
  }
});

await test("GAME STATE lists each carried magic item with its worn and attuned state and the effect the server applies.", async () => {
  const { describeSheet } = await import("../src/lib/dm/prompt.ts");
  const ringed = {
    ...world.sheet(kara.id),
    equipment: [
      { name: "Longsword", qty: 1, equipped: true },
      { name: "Ring of Protection", qty: 1, equipped: true, attuned: true },
      { name: "Cloak of Protection", qty: 1 },
    ],
  };
  const text = describeSheet(ringed, "player", false);
  const ring = /\[Ring of Protection: ([^\]]*)\]/.exec(text)?.[1] ?? "";
  assert.match(ring, /\+1 AC/);
  assert.match(ring, /\+1 saves/);
  assert.match(ring, /attuned, worn$/);
  const cloak = /\[Cloak of Protection: ([^\]]*)\]/.exec(text)?.[1] ?? "";
  assert.match(cloak, /not attuned/);
  assert.doesNotMatch(cloak, /worn/);
  assert.match(text, /Longsword/);
});

// ---- the prompt against what the other workstreams' engine changes now do ----
//
// Each sentence below was asked for by the workstream that changed the rule
// (/tmp/odm-enf2/fixes/<area>.md, "Requests: prompt"). The tests read the
// built system text and the offered tool schemas, so a later edit that brings
// back a stale instruction, or drops the one the engine relies on, fails here.

const { dmTurnToolCatalogue } = await import("../src/lib/dm/turn.ts");
const { companionRules } = await import("../src/lib/dm/prompt.ts");

function offeredTools() {
  return dmTurnToolCatalogue(world.campaign(), true, false);
}

function offeredTool(name) {
  const found = offeredTools().find((entry) => entry.function.name === name);
  assert.ok(found, `the turn does not offer ${name}`);
  return found.function;
}

// Every description string a tool carries, its own and its arguments'.
function descriptionsOf(fn) {
  const out = [fn.description];
  const walk = (value) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (key === "description" && typeof inner === "string") {
          out.push(inner);
        } else {
          walk(inner);
        }
      }
    }
  };
  walk(fn.parameters);
  return out.join("\n");
}

// The one rule line that starts with the given words.
function ruleLine(text, start) {
  return text.split("\n").find((line) => line.startsWith(start)) ?? "";
}

await test("No sentence the model reads tells it to heal the difference or narrate a reaction's effect itself; use_reaction re-resolves the recorded attack.", () => {
  const everything = [systemText(), ...offeredTools().map((entry) => descriptionsOf(entry.function))].join("\n");
  assert.doesNotMatch(everything, /heal the difference|heal it back|narrate accordingly/i);
  assert.match(systemText(), /use_reaction right after the attack or effect they answer: the server keeps the last attack against each character, re-resolves it/);
  assert.match(systemText(), /Never heal or refund the difference yourself/);
});

await test("Every reaction the prompt sends to use_reaction is one use_reaction resolves.", () => {
  const rule = ruleLine(systemText(), "- Dodge, Dash, Disengage");
  const tool = descriptionsOf(offeredTool("use_reaction"));
  const named = [...rule.matchAll(/\(([^)]*)\) go through use_reaction|Reactions that answer an attack \(([^)]*)\)/g)]
    .flatMap((match) => (match[1] ?? match[2]).split(/,\s*|\s+and\s+/))
    .map((name) => name.replace(/^a monk's\s+/, "").trim())
    .filter(Boolean);
  assert.ok(named.length >= 8, `found only ${named.join(", ")}`);
  for (const name of named) {
    assert.ok(tool.includes(name), `the prompt sends ${name} to use_reaction, which never names it`);
  }
  assert.doesNotMatch(rule, /Absorb Elements/);
});

await test("Counterspell is taught as called before the enemy's spell resolves, and a countered spell is never cast.", () => {
  const rule = ruleLine(systemText(), "- Dodge, Dash, Disengage");
  assert.match(rule, /Counterspell is the exception: it is called BEFORE you resolve the enemy's spell/);
  assert.match(rule, /do not call cast_at_player or aoe_damage for it/);
  assert.match(rule, /Deflect Missiles with the missile caught throws it back when you pass targetEnemyId/);
  assert.match(rule, /take_action escape with its enemyId and no characterId/);
});

await test("The prompt says a grapple or shove replaces one attack, and a character attacks off their turn only as an opportunity attack or a readied action.", () => {
  const rule = ruleLine(systemText(), "- Dodge, Dash, Disengage");
  assert.match(rule, /A grapple or shove replaces one attack of the Attack action/);
  assert.match(rule, /Off their own turn a character attacks ONLY as an opportunity attack or with a readied action; the server refuses any other off-turn pc_attack/);
  assert.match(rule, /Ready takes the trigger/);
  assert.doesNotMatch(systemText(), /applied directly/i);
});

await test("The last foe falling to an opportunity attack does not end the fight by itself; the prompt asks for end_encounter.", () => {
  assert.match(systemText(), /When the last enemy falls to an opportunity attack the fight does not end by itself: narrate it and call end_encounter with outcome victory/);
});

await test("Potions in a fight are the user's action on their own turn, within 5 feet to feed one, and nothing at 0 HP.", () => {
  const text = systemText();
  assert.match(text, /in a fight it is the user's action on their own turn, and feeding a potion to someone needs them within 5 feet/);
  assert.match(text, /A character at 0 HP uses nothing/);
});

await test("pc_attack's class options and the advantage rule are in the prompt, and it never invites advantage for what the server applies.", () => {
  const rule = ruleLine(systemText(), "- Enemy HP and AC in GAME STATE");
  for (const option of ["reckless", "stunningStrike", "nonlethal", "bonusAttack \"martial arts\" or \"frenzy\""]) {
    assert.ok(rule.includes(option), `pc_attack option ${option} missing from the rule`);
  }
  assert.match(rule, /A knocked-out enemy is out of the fight but alive/);
  assert.match(rule, /counts only with advantageReason naming a circumstance the server cannot see/);
  assert.match(rule, /Hunter's Mark and Hex ride hits on one creature/);
  assert.match(rule, /Invisibility \(not Greater Invisibility\) ends when the invisible character attacks or casts/);
  assert.doesNotMatch(systemText(), /(pass|give|grant) advantage (for|when)[^.]*(dark|hidden|cover)/i);
  assert.match(requestRollTool.function.parameters.properties.advantage.description ?? "", /useInspiration/);
});

await test("A dead character comes back only through a revival spell with its window; the old 'only the party lead can reverse a death' line is gone.", () => {
  const text = systemText();
  assert.doesNotMatch(text, /only the party lead can reverse a death/);
  assert.match(text, /revival spell cast with heal \(spell and casterId: Revivify within a minute of the death, Raise Dead within ten days, Resurrection within a century, True Resurrection within two hundred years/);
});

await test("The spell rules match the spell engine: one aoe_damage with casterId, no slot for a concentration spell's later turns, the buff list, set_condition refusing spell effects, and a break ending only that casting.", () => {
  const text = systemText();
  assert.match(text, /aoe_damage \(with spell and the caster's casterId\)/);
  assert.match(text, /An area spell \(Fireball, Entangle, Hypnotic Pattern, Slow, Sleep\) is ONE aoe_damage call/);
  assert.match(text, /refuses a spell with neither casterId nor casterEnemyId/);
  assert.match(text, /later turns \([^)]*\) are the same tool again, and the server spends no slot for them/);
  for (const buff of ["Spirit Guardians", "Aid", "Heroism", "Death Ward", "Magic Weapon", "Beacon of Hope", "Mirror Image", "Sanctuary"]) {
    assert.ok(text.includes(buff), `${buff} missing from the cast_buff list`);
  }
  assert.match(text, /Dispel Magic goes through cast_buff on an ally or cast_at_enemy on an enemy/);
  assert.match(text, /Never set a spell's effect \(blessed, hasted, aided\.\.\.\) with set_condition: the server refuses it/);
  assert.match(text, /that casting's effects end immediately, and only that casting's/);
});

await test("set_effect's examples never name a spell or a class aura, which have their own tools.", () => {
  const effect = descriptionsOf(offeredTool("set_effect"));
  assert.doesNotMatch(effect, /'Bless'|Spirit Guardians 15|Aura of Protection 10/);
});

await test("The feature rules match the feature engine: Inspiration, the Channel Divinity and Ki variants, what the server applies, condition immunity.", () => {
  const text = systemText();
  assert.match(text, /set_condition condition "inspiration"/);
  assert.match(text, /pass useInspiration true on their request_roll/);
  assert.match(text, /Channel Divinity variant 'turn undead', 'turn the unholy', 'sacred weapon' or 'preserve life'/);
  assert.match(text, /never set turned or frightened by hand/);
  assert.match(text, /'empty body' or 'diamond soul'/);
  assert.match(text, /Indomitable rerolls the last failed save by itself/);
  assert.match(text, /The server applies Aura of Protection \(on and off the map\), Danger Sense, Evasion, Relentless Rage, Survivor, and the racial save advantages/);
  assert.match(text, /immune to a condition refuses it through set_condition/);
  assert.match(text, /Damage goes to its tool at the full amount with its type/);
  assert.doesNotMatch(text, /apply the frightened condition/i);
  const roll = requestRollTool.function.parameters.properties;
  assert.match(roll.against.description, /'spell'/);
  assert.match(roll.tool.description, /proficiency bonus/);
  assert.match(roll.useInspiration.description, /Inspiration/);
});

await test("The gear rules match the gear engine: damage_object remembers damage and rolls a weapon blow, purchase prices itself, charged items and scrolls, hit dice chosen by players, attuning on a rest.", () => {
  const text = systemText();
  const everything = [text, descriptionsOf(offeredTool("damage_object"))].join("\n");
  assert.doesNotMatch(everything, /cumulative/i);
  assert.match(text, /remembers the damage a named object has already taken/);
  assert.match(text, /for a character's weapon blow pass characterId and weapon and the server rolls the attack/);
  assert.match(text, /list price to buy, half to sell, full value for gems, art, and trade goods/);
  // A charged item or a scroll names its spell on use_item, and that spell's
  // own tool then casts it with no slot (last-explore N8).
  assert.match(text, /A charged item \(a wand, a staff\) goes through use_item with the spell it casts named in spell/);
  assert.match(text, /the server spends no slot for it and uses the item's save DC and attack bonus/);
  assert.match(text, /the server refuses a scroll the reader cannot read \(and the scroll is kept\) and rolls the check for one above their level/);
  assert.match(text, /a player at the table chooses and rolls their own hit dice from their sheet/);
  assert.match(text, /Attuning to a magic item takes a short rest/);
  assert.doesNotMatch(text, /every purchase, sale, or trade goes through ONE purchase call/);
});

await test("The monster rules match the monster engine: damage_enemy needs a hazard source, cast_at_player reads the block, enemy_attack resolves its rider, and ambushes are rolled.", () => {
  const text = systemText();
  const rule = ruleLine(text, "- Enemy HP and AC in GAME STATE");
  assert.match(rule, /with source 'hazard' or 'environment': the server refuses it for anything else/);
  const sources = offeredTool("damage_enemy").parameters.properties.source.enum;
  for (const source of ["hazard", "environment"]) {
    assert.ok(sources.includes(source), `damage_enemy does not take source ${source}`);
  }
  assert.match(text, /an enemy that falls takes it with fallFeet instead of an amount/);
  assert.ok(offeredTool("damage_enemy").parameters.properties.fallFeet, "damage_enemy takes no fallFeet");
  assert.match(text, /Pass casterEnemyId with the ability or spell by the name its block uses/);
  assert.match(text, /a Recharge ability is refused until it recharges/);
  assert.match(text, /on a hit it also resolves the rider the attack prints/);
  assert.match(text, /For an ambush pass ambush with the side lying in wait/);
  assert.ok(offeredTool("start_encounter").parameters.properties.ambush, "start_encounter takes no ambush");
  assert.match(text, /pass disengage when an enemy Disengages before it walks/);
  assert.ok(offeredTool("move_token").parameters.properties.disengage, "move_token takes no disengage");
  assert.match(text, /A teleport \(Misty Step, a portal\) is teleport_token with spell and casterId/);
  assert.match(text, /take the turns of the enemies its result lists as enemiesToAct/);
  assert.match(text, /An enemy acts only on its own turn: off it, it only reacts \(opportunity attacks are automatic\) or takes a legendary action/);
});

await test("A companion walks with move_token and no forced on its own turn; the rules never send forced:true for it.", () => {
  const rules = companionRules(world.campaign(), "full");
  assert.doesNotMatch(rules, /move_token \(forced:true\) if they need to reposition/);
  assert.match(rules, /move_token with no forced if they need to reposition/);
  assert.match(systemText(), /On a character's own turn, move_token with no forced walks them: an AI companion/);
});

await test("The level-up rule never lets a lead's request turn into a level the server refuses from the model.", () => {
  const text = systemText();
  assert.doesNotMatch(text, /unless the party lead directs it/);
  assert.match(text, /the server refuses a level or hit points from you even at the party lead's request/);
  assert.doesNotMatch(text, /You never set a level, hit points, feature, or spell yourself/);
});

// ---- the AI's door: update_sheet ----

await test("update_sheet from the AI never sets a level: a level-up is built from the player's choices.", async () => {
  const before = world.sheet(kara.id);
  const out = await ai.invoke("update_sheet", { characterId: kara.id, level: 6, reason: "story" });
  assert.equal(out.ok, false, "the AI set a level");
  assert.equal(world.sheet(kara.id).level, before.level);
  assert.equal(world.sheet(kara.id).maxHp, before.maxHp);
});

await test("update_sheet from the AI never pins the armor class; AC stays derived.", async () => {
  world.patch(kara.id, { acOverride: false });
  const derived = world.sheet(kara.id).ac;
  const out = await ai.invoke("update_sheet", { characterId: kara.id, ac: 19, reason: "a blessing" });
  assert.equal(out.ok, false, "the AI wrote an AC");
  assert.equal(world.sheet(kara.id).acOverride, false);
  assert.equal(world.sheet(kara.id).ac, derived);
});

await test("update_sheet from the AI writes no hit points, XP, gold or conditions: those move through heal, apply_damage, award_xp, modify_gold and the condition tools.", async () => {
  world.patch(kara.id, { currentHp: 10, conditions: [] });
  for (const fields of [{ currentHp: 30 }, { maxHp: 60 }, { xp: 6500 }, { gold: 500 }, { conditions: ["poisoned"] }, { tempHp: 5 }]) {
    const before = JSON.stringify(world.sheet(kara.id));
    const out = await ai.invoke("update_sheet", { characterId: kara.id, reason: "story", ...fields });
    assert.equal(out.ok, false, `the AI wrote ${Object.keys(fields)[0]}`);
    const after = world.sheet(kara.id);
    assert.equal(JSON.stringify({ ...after, updatedAt: 0 }), JSON.stringify({ ...JSON.parse(before), updatedAt: 0 }));
  }
  world.patch(kara.id, { currentHp: world.sheet(kara.id).maxHp });
});

await test("update_sheet from the AI still renames and records a story feature", async () => {
  const out = await ai.invoke("update_sheet", {
    characterId: mira.id, name: "Mira the Grey", reason: "a new name",
    features: [...world.sheet(mira.id).features, { name: "Touched by the Veil", source: "story" }],
  });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mira.id).name, "Mira the Grey");
  assert.ok(world.sheet(mira.id).features.some((feature) => feature.name === "Touched by the Veil"));
  world.patch(mira.id, { name: "Mira" });
});

await test("update_sheet from the DM's console keeps its correction power, and pins the AC it writes", async () => {
  world.patch(kara.id, { acOverride: false });
  const out = await world.invoke("update_sheet", { characterId: kara.id, ac: 19, reason: "correction" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(kara.id).ac, 19);
  assert.equal(world.sheet(kara.id).acOverride, true);
  world.patch(kara.id, { acOverride: false });
});

// ---- request_roll damage ----

await test("A party character's damage in a fight goes through pc_attack; request_roll kind=damage aimed at an enemy for them is refused and the enemy is untouched.", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [mira.id]: 5 } });
  const [enemy] = world.enemies();
  world.dice(10, 10, 10, 10);
  const out = await world.invoke("request_roll", {
    characterId: mira.id, kind: "damage", expression: "4d10", targetEnemyId: enemy.id,
  });
  world.clearDice();
  assert.equal(out.ok, false, "a party character's damage roll hit an enemy");
  assert.equal(kit.enemy(enemy.id).currentHp, enemy.currentHp);
});

await test("request_roll kind=damage with no character still lands on an enemy (an NPC ally's blow)", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [mira.id]: 5 } });
  const [enemy] = world.enemies();
  // The console's form always names a character, so this is the model's
  // call, straight into the one request_roll handler.
  const { handleRequestRoll } = await import("../src/lib/dm/invoke-roll.ts");
  const sheets = world.sheets();
  world.dice(3);
  const out = handleRequestRoll(
    world.campaign(), ai.turn(), JSON.stringify({ kind: "damage", expression: "1d6", targetEnemyId: enemy.id }),
    sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])), new Set(), { toolCallId: null },
  );
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(enemy.id).currentHp, enemy.currentHp - 3);
  kit.setEnemy(enemy.id, { currentHp: enemy.maxHp });
});

// ---- the invoke caps ----

await test("The AI's per-turn caps on the invoke path count calls that resolved, not refusals, as the turn loop does.", async () => {
  ai.fresh();
  for (let index = 0; index < 10; index += 1) {
    const refused = await ai.invoke("heal", { characterId: "nobody-here", amount: 1 });
    assert.equal(refused.ok, false);
  }
  world.patch(kara.id, { currentHp: 20 });
  // The model's healing is dice the server rolls (src/lib/dm/ai-gate.ts).
  world.dice(1);
  const out = await ai.invoke("heal", { characterId: kara.id, dice: "1d4", reason: "a draught" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(kara.id).currentHp, 21);
  world.patch(kara.id, { currentHp: world.sheet(kara.id).maxHp });
});

// ---- the guard, fed with live state ----

const party = [kara.name, mira.name];
function conversationOf(exchanges) {
  return [
    { role: "system", content: "system prompt" },
    { role: "user", content: "[Kara | attempt] I swing at the goblin." },
    {
      role: "assistant",
      content: "",
      tool_calls: exchanges.map((entry, index) => ({
        id: `call-${index}`, type: "function",
        function: { name: entry.name, arguments: JSON.stringify(entry.args) },
      })),
    },
    ...exchanges.map((entry, index) => ({
      role: "tool", tool_call_id: `call-${index}`, content: JSON.stringify(entry.result),
    })),
  ];
}

const LIVE = { enemies: [{ id: "enemy-1", name: "Goblin 1", hp: 7, maxHp: 7, status: "alive" }] };
const kinds = (narration, exchanges, extra = {}) =>
  checkNarration({ conversation: conversationOf(exchanges), narration, partyNames: party, ...extra })
    .map((entry) => entry.kind)
    .sort();

await test("A hit narrated on an attack the engine refused is a contradiction.", () => {
  const refused = {
    name: "pc_attack",
    args: { characterId: kara.id, targetEnemyId: "enemy-1", weapon: "Longsword" },
    result: { error: "Kara is 30 ft from Goblin 1 and cannot reach them." },
  };
  assert.deepEqual(kinds("Kara's blade bites into the goblin.", [refused], { live: LIVE }), ["hit"]);
});

await test("A death narrated with no tool call, on an enemy the live encounter shows alive, is a contradiction.", () => {
  assert.deepEqual(kinds("Kara cuts down the goblin.", [], { live: LIVE }), ["death"]);
  assert.deepEqual(kinds("The goblin snarls and circles.", [], { live: LIVE }), []);
  // In a running fight a damage figure needs a roll behind it, tool or none.
  assert.deepEqual(kinds("Kara deals 14 damage to the goblin.", [], { live: LIVE }), ["number"]);
});

await test("The prose-spell check knows every leveled spell in the spell data and the verbs a narrator casts with.", async () => {
  const guard = await import("../src/lib/dm/narration-guard.ts");
  assert.equal(typeof guard.leveledSpellNames, "function", "no spell list from the data");
  const leveledSpells = guard.leveledSpellNames();
  assert.deepEqual(kinds("Mira casts Guiding Bolt at the goblin.", [], { leveledSpells }), ["spell"]);
  assert.deepEqual(kinds("Mira hurls a fireball into the goblins.", [], { leveledSpells }), ["spell"]);
  assert.deepEqual(kinds("Mira casts Fire Bolt at the goblin.", [], { leveledSpells }), []);
});

// ---- tool results: argument faults and rules refusals ----

await test("The empty-turn line shows a player only a rules refusal, never an argument fault meant for the model.", () => {
  const fault = [
    { role: "assistant", content: "", tool_calls: [{ id: "a", type: "function", function: { name: "pc_attack", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "a", content: JSON.stringify({ error: "Unknown targetEnemyId; use one from GAME STATE." }) },
  ];
  assert.doesNotMatch(emptyTurnLine(fault), /targetEnemyId/);
  const ruling = [
    { role: "assistant", content: "", tool_calls: [{ id: "b", type: "function", function: { name: "pc_attack", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "b", content: JSON.stringify({ error: "Kara is at 0 HP and cannot attack. They act again once they are healed above 0." }) },
  ];
  assert.match(emptyTurnLine(ruling), /0 HP/);
});

await test("The MCP bridge hands an engine refusal to an agent program as an error.", async () => {
  const bridge = await import("../src/lib/harness/bridge.ts");
  assert.equal(typeof bridge.toolResultIsError, "function");
  assert.equal(bridge.toolResultIsError(JSON.stringify({ error: "no" })), true);
  assert.equal(bridge.toolResultIsError(JSON.stringify({ ok: true })), false);
});

// ---- the turn loop ----

// A fight with Kara up, next to the only enemy, dice cleared.
async function karaUp() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [mira.id]: 5 } });
  const [enemy] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(kara.id);
  return enemy;
}

await test("A tool result tells the model whether an error is its own argument fault (retry) or the rules refusing (narrate it).", async () => {
  const enemy = await karaUp();
  world.patch(mira.id, { currentHp: 0 });
  const bad = call("pc_attack", { characterId: kara.id, targetEnemyId: "no-such-enemy", weapon: "Longsword" });
  const down = call("pc_attack", { characterId: mira.id, targetEnemyId: enemy.id, weapon: "Fire Bolt" });
  model.script([reply({ calls: [bad, down] }), reply({ text: "Steel rings, and nothing gives." })]);
  await model.turn(world, "I attack.", kara.id);
  world.patch(mira.id, { currentHp: world.sheet(mira.id).maxHp });
  const results = new Map(model.results(model.requests[1]).map((entry) => [entry.id, entry.result]));
  assert.equal(results.get(bad.id)?.retry, true, JSON.stringify(results.get(bad.id)));
  assert.equal(results.get(down.id)?.refused, "rules", JSON.stringify(results.get(down.id)));
});

await test("Tool calls in one model reply resolve in the order the model sent them: a Rage called before the attack rides it.", async () => {
  const brute = world.addHero({
    name: "Brakka", class: "barbarian", level: 1, abilities: { str: 16 }, proficiencies: TRAINED,
    features: [{ name: "Rage", source: "class", level: 1 }],
    equipment: [{ name: "Longsword", qty: 1 }],
  });
  assert.ok(world.sheet(brute.id).resources.rage, "the barbarian has no Rage counter to spend");
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [brute.id]: 20 } });
  const [enemy] = world.enemies();
  kit.place(brute.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(brute.id);
  model.script([
    reply({ calls: [
      call("use_resource", { characterId: brute.id, resource: "rage", reason: "fury" }),
      call("pc_attack", { characterId: brute.id, targetEnemyId: enemy.id, weapon: "Longsword" }),
    ] }),
    reply({ text: "Brakka roars and swings." }),
  ]);
  world.clearDice();
  world.dice(15, 4);
  await model.turn(world, "I rage and attack the goblin.", brute.id, brute.userId);
  world.clearDice();
  assert.ok(world.sheet(brute.id).conditions.includes("raging"), "the rage never landed");
  // 4 on the d8, +3 Strength, +2 Rage.
  assert.equal(kit.enemy(enemy.id).currentHp, 40 - 9);
});

await test("Prose sent beside any outcome-resolving tool (take_action, cast_at_player, use_reaction, request_roll damage...) is withheld; the table reads only the narration written from the result.", async () => {
  await karaUp();
  const guess = "PREMATURE-GUESS: Kara dodges every blow with ease.";
  model.script([
    reply({ text: guess, calls: [call("take_action", { characterId: kara.id, action: "dodge" })] }),
    reply({ text: "Kara settles into a guarded stance." }),
  ]);
  const message = await model.turn(world, "I dodge.", kara.id);
  assert.ok(message, "the turn wrote no message");
  assert.ok(!message.content.includes("PREMATURE-GUESS"), "the premature prose reached the table");
});

await test("A kill narrated with no tool call, on an enemy the encounter holds alive, is sent back for a rewrite.", async () => {
  const enemy = await karaUp();
  const rewrite = "Kara's blade flashes, but the goblin twists aside and keeps its feet, snarling as it circles her with its club held low and ready.";
  model.script([reply({ text: "Kara cuts down the goblin." }), reply({ text: rewrite })]);
  const message = await model.turn(world, "I attack the goblin.", kara.id);
  assert.equal(kit.enemy(enemy.id).status, "alive");
  assert.equal(model.served(), 2, "no correction call was made");
  assert.equal(message?.content, rewrite);
});

await test("The narration guard's rewrite has one reserved call outside the four-call turn budget.", async () => {
  const enemy = await karaUp();
  const rewrite = "Kara's blade whistles past the goblin, and the creature snarls as it circles back toward her with its club raised, looking for an opening.";
  const check = () => call("request_roll", { characterId: kara.id, kind: "skill_check", skill: "perception", difficulty: "easy" });
  world.clearDice();
  world.dice(2, 10, 10);
  model.script([
    reply({ calls: [call("pc_attack", { characterId: kara.id, targetEnemyId: enemy.id, weapon: "Longsword" })] }),
    reply({ calls: [check()] }),
    reply({ calls: [check()] }),
    reply({ text: "Kara's blade bites into the goblin." }),
    reply({ text: rewrite }),
  ]);
  const message = await model.turn(world, "I attack the goblin.", kara.id);
  world.clearDice();
  assert.equal(kit.enemy(enemy.id).currentHp, kit.enemy(enemy.id).maxHp, "the swing was meant to miss");
  assert.equal(model.served(), 5, "the correction had no call left");
  assert.equal(message?.content.replace(/\[roll:[^\]]*\]\s*/g, "").trim(), rewrite);
});

// ---- the Hand's intent ----

async function postAction(table, userId, body) {
  const route = await table.route("campaigns/[campaignId]/actions");
  table.signIn({ id: userId });
  const response = await route.POST(
    new Request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ campaignId: table.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}

// A second table for the route, with its own fake model: the route wakes a
// DM turn of its own, which must never reach a real backend.
const routeWorld = await openWorld({ gameSettings: { ttsEnabled: false } });
const routeModel = await fakeModel();
routeModel.pointAt(routeWorld);
const lead = routeWorld.addHero({
  name: "Lead", class: "fighter", level: 3, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }],
});
const sage = routeWorld.addHero({
  name: "Sage", class: "wizard", level: 3, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Magic Missile"], known: [], cantrips: [] },
});
const { listRecentMessages } = await import("../src/lib/db/messages.ts");

await test("The actions route stores the Hand's structured intent on the player's message.", async () => {
  const intent = { card: "spell", spell: "Magic Missile", slotLevel: 1, targetName: "the dark" };
  const out = await postAction(routeWorld, sage.userId, { content: "I cast Magic Missile.", kind: "do", intent });
  assert.equal(out.status, 202, JSON.stringify(out.json));
  const stored = listRecentMessages(routeWorld.campaignId, 5).find((message) => message.id === out.json.messageId);
  assert.equal(stored?.intent?.card, "spell");
  assert.equal(stored?.intent?.spell, "Magic Missile");
});

await test("A Hand card the engine would refuse is refused up front with the engine's reason, and no message is posted: a spell not on the sheet.", async () => {
  const before = listRecentMessages(routeWorld.campaignId, 50).length;
  const out = await postAction(routeWorld, sage.userId, {
    content: "I cast Fireball.", kind: "do", intent: { card: "spell", spell: "Fireball", slotLevel: 3 },
  });
  assert.equal(out.status, 409, JSON.stringify(out.json));
  assert.match(out.json.error ?? "", /Fireball/);
  assert.equal(listRecentMessages(routeWorld.campaignId, 50).length, before);
});

await test("A Hand attack card from a character at 0 HP is refused up front with the engine's reason.", async () => {
  routeWorld.patch(lead.id, { currentHp: 0 });
  const out = await postAction(routeWorld, lead.userId, {
    content: "I attack the bandit with my Longsword.", kind: "do", intent: { card: "attack", weapon: "Longsword" },
  });
  routeWorld.patch(lead.id, { currentHp: routeWorld.sheet(lead.id).maxHp });
  assert.equal(out.status, 409, JSON.stringify(out.json));
  assert.match(out.json.error ?? "", /0 HP/);
});

await test("a typed action with no card is never dry-run: the model still reads the prose", async () => {
  const out = await postAction(routeWorld, sage.userId, { content: "I cast Fireball.", kind: "do" });
  assert.equal(out.status, 202, JSON.stringify(out.json));
});

await test("A card's intent reaches the model as a structured line beside the player's words.", () => {
  const history = [{
    id: "m1", campaignId: world.campaignId, seq: 1, authorType: "player", userId: world.owner.id,
    characterId: kara.id, content: "I attack Goblin 1 with my Longsword.", createdAt: new Date().toISOString(),
    intent: { card: "attack", weapon: "Longsword", targetId: "enemy-1", targetName: "Goblin 1", targetKind: "enemy" },
  }];
  const messages = buildDmMessages(
    { campaign: world.campaign(), members: listMembers(world.campaignId), sheets: world.sheets(), encounter: ENEMY_STATE, recentRolls: [], storySummary: "" },
    history,
  );
  const line = messages.find((message) => message.role === "user" && message.content.includes("I attack Goblin 1"));
  assert.match(line?.content ?? "", /pc_attack/);
  assert.match(line?.content ?? "", /enemy-1/);
});

await test("When a card's attack gets no pc_attack call, the turn sends one corrective call and the attack resolves.", async () => {
  const enemy = await karaUp();
  world.clearDice();
  world.dice(15, 4);
  model.script([
    reply({ text: "Kara lunges at the goblin." }),
    reply({ calls: [call("pc_attack", { characterId: kara.id, targetEnemyId: enemy.id, weapon: "Longsword" })] }),
    reply({ text: "The blade bites." }),
  ]);
  await model.turn(world, "I attack Goblin 1 with my Longsword.", kara.id, world.owner.id, {
    intent: { card: "attack", weapon: "Longsword", targetId: enemy.id, targetName: enemy.displayName, targetKind: "enemy" },
  });
  world.clearDice();
  assert.ok(model.served() >= 2, "no corrective call");
  assert.equal(kit.enemy(enemy.id).currentHp, 40 - 7);
});

// ---- a connected agent program in the DM seat ----

async function agentCall(table, userId, routeName, body, agent = true) {
  const route = await table.route(routeName);
  table.signIn({ id: userId });
  const response = await route.POST(
    new Request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json", ...(agent ? { "x-odm-client": "agent" } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ campaignId: table.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}

const agentWorld = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: true } });
routeModel.pointAt(agentWorld);
const { setDmMode } = await import("../src/lib/db/campaigns.ts");
setDmMode(agentWorld.campaignId, "human", agentWorld.owner.id);
const tamsin = agentWorld.addHero({ name: "Tamsin", class: "fighter", level: 3, user: agentWorld.addUser("tamsin") });

await test("An agent program in the DM seat gets the AI's rails: update_sheet cannot set a level for it, while the person at the console still can.", async () => {
  const agent = await agentCall(agentWorld, agentWorld.owner.id, "campaigns/[campaignId]/dm/invoke", {
    name: "update_sheet", args: { characterId: tamsin.id, level: 5, reason: "the agent says so" },
  });
  assert.equal(agent.status, 409, JSON.stringify(agent.json));
  assert.equal(agentWorld.sheet(tamsin.id).level, 3);
  const person = await agentCall(agentWorld, agentWorld.owner.id, "campaigns/[campaignId]/dm/invoke", {
    name: "update_sheet", args: { characterId: tamsin.id, name: "Tamsin Vale", reason: "a correction" },
  }, false);
  assert.equal(person.status, 200, JSON.stringify(person.json));
});

await test("An agent program's narration is checked against the live encounter, and a kill the engine denies is refused unposted.", async () => {
  await agentWorld.beginFight([{ monster: "goblin", count: 1 }]);
  const before = listRecentMessages(agentWorld.campaignId, 50).length;
  const refused = await agentCall(agentWorld, agentWorld.owner.id, "campaigns/[campaignId]/dm/narrate", {
    content: "Tamsin cuts down the goblin.",
  });
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.equal(listRecentMessages(agentWorld.campaignId, 50).length, before);
  const fine = await agentCall(agentWorld, agentWorld.owner.id, "campaigns/[campaignId]/dm/narrate", {
    content: "The goblin snarls and circles Tamsin, looking for an opening.",
  });
  assert.equal(fine.status, 201, JSON.stringify(fine.json));
});

// ---- a manual slot tick ----

await test("A slot a player ticked by hand for a cast pays for that cast: the cast the DM then resolves spends no second slot.", async () => {
  await kit.endFight();
  const route = await world.route("campaigns/[campaignId]/sheet/usage");
  world.signIn({ id: world.sheet(mira.id).userId });
  world.patch(mira.id, { spellcasting: { ...world.sheet(mira.id).spellcasting, slots: { 1: { max: 4, used: 0 }, 3: { max: 2, used: 0 } } } });
  const response = await route.POST(
    new Request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slots: { 1: 1 } }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(world.sheet(mira.id).spellcasting.slots[1].used, 1);
  const out = await world.invoke("use_spell_slot", { characterId: mira.id, spell: "Magic Missile", level: 1 });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(mira.id).spellcasting.slots[1].used, 1, "the cast paid a second slot");
  // The next cast has no tick behind it and pays its own slot.
  const next = await world.invoke("use_spell_slot", { characterId: mira.id, spell: "Magic Missile", level: 1 });
  assert.equal(next.ok, true, next.error);
  assert.equal(world.sheet(mira.id).spellcasting.slots[1].used, 2);
  // The last slot of a level ticked by hand still pays for its cast.
  const last = await route.POST(
    new Request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slots: { 3: 2 } }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(last.status, 200);
  const fireball = await world.invoke("use_spell_slot", { characterId: mira.id, spell: "Fireball", level: 3 });
  assert.equal(fireball.ok, true, fireball.error);
  assert.equal(world.sheet(mira.id).spellcasting.slots[3].used, 2);
});

model.close();
routeModel.close();
await kit.endFight();
world.close();
finish();
