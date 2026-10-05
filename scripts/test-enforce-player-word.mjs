// A player character acts on their own turn when their player says so
// (src/lib/dm/player-word.ts; issue 17: "perform an attack without any
// command being given"). For the AI DM, every call that spends a
// character's turn is refused while it is their own turn and their player
// has said nothing in the input the DM turn answers, and the refusal spends
// nothing:
//   - attacks (pc_attack, pet_attack), the casting tools with the character
//     as caster (cast_at_enemy, cast_buff, aoe_damage, heal, teleport_token,
//     use_spell_slot), actions (take_action, stabilize), items
//     and features (use_item, use_resource), and ending the turn (end_turn);
//   - the input is every line since the DM last spoke, table talk aside;
//   - GAME STATE tells the model the turn waits on the player first, and
//     the refusal is the backstop.
// A character who cannot act has no turn to play: the AI passes it with no
// word, as the server would. What stays as it was: with the player's word
// every one of them resolves,
// a companion is the AI's to play, the person at the console keeps a free
// hand, nothing off the character's own turn is asked, and a turn parked
// for a player's dice resumes on the input it parked with. A line through
// the actions route is the word whoever sends it (the chat box, an agent
// piloting the character), and an agent program in the DM seat gets the
// refusal as the AI does.
import assert from "node:assert/strict";
import { call as callRoute } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { aiEngine, call, fakeModel, reply } from "./lib/enforce-narrator.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-player-word");
const world = await openWorld({ campaign: { maxPlayers: 20 }, gameSettings: { ttsEnabled: false, dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const ai = await aiEngine(world);
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { createCompanionUser } = await import("../src/lib/db/users.ts");
const { createSheet, markSheetAsCompanion } = await import("../src/lib/db/sheets.ts");
const { getDmTurn, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { characterAwaitingPlayer } = await import("../src/lib/dm/player-word.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");

const hero = (overrides) => world.addHero({ maxHp: 60, proficiencies: TRAINED, ...overrides });
const kara = hero({
  name: "Kara", class: "fighter", level: 5, abilities: { str: 16 },
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Potion of Healing", qty: 2 }, { name: "Healer's Kit", qty: 1, charges: 10 }],
});
const brom = hero({ name: "Brom", class: "fighter", level: 5, abilities: { str: 16 }, equipment: [{ name: "Longsword", qty: 1 }] });
const sage = hero({ name: "Sage", ...caster("cleric", "wis", ["Bless", "Cure Wounds", "Detect Magic"]) });
const mage = hero({ name: "Mage", ...caster("wizard", "int", ["Magic Missile", "Burning Hands", "Misty Step"]) });
const rhea = hero({ name: "Rhea", class: "ranger", subclass: "Beast Master", level: 3, abilities: { dex: 16, wis: 14 }, equipment: [{ name: "Longbow", qty: 1 }] });
// A companion is a sheet the AI plays, seated like the heroes.
const pip = (() => {
  const made = createSheet(world.campaignId, createCompanionUser("Pip").id, 5, { ...world.sheet(brom.id), name: "Pip" });
  markSheetAsCompanion(made.id, "party", "cheerful");
  return world.sheet(made.id);
})();
const roster = [kara, brom, sage, mage, rhea, pip];

// The GAME STATE line the model reads first; the refusal is the backstop.
const WAITING = (name) =>
  `Waiting on ${name}'s player: they have not declared an action this turn. Set the scene and ask what ${name} does; the server refuses any action or end_turn for ${name} until they do.`;
const systemPrompt = (request) => request.messages.find((message) => message.role === "system").content;

const REFUSAL = (name) =>
  `${name} has not acted: their player hasn't declared an action this turn, and nothing was spent. Don't narrate an attempt; wait for them to say what ${name} does, or narrate the moment and stop.`;

// A fight on `who`'s turn with Brom next, the goblin beside them, and the
// DM's last line the newest in the transcript: nobody has spoken since.
async function stage(who) {
  await kit.endFight();
  const heroFaces = Object.fromEntries(roster.map((entry) => [entry.id, entry.id === who.id ? 20 : entry.id === brom.id ? 19 : 3]));
  await kit.fight(1, { heroFaces });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(who.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  assert.equal(kit.current().characterId, who.id);
  world.say("dm", `The goblin snarls. ${who.name}, it's your turn.`);
  ai.fresh();
  return enemy;
}

// Everything a call could spend: the turn's budget, every sheet's hit
// points, slots, uses, items and pets, the goblin's hit points, the rolls.
const spendable = () =>
  JSON.stringify({
    budget: world.encounter().turnBudget,
    sheets: world.sheets().map((sheet) => [sheet.currentHp, sheet.spellcasting?.slots ?? null, sheet.resources, sheet.equipment, sheet.pets]),
    enemies: world.enemies().map((enemy) => [enemy.currentHp, enemy.conditions]),
    rolls: listRecentRolls(world.campaignId, 200).length,
    order: world.encounter().order.length,
    turn: [world.encounter().round, world.encounter().turnIndex],
  });

// ---- every family of turn-spending call ----

// Each family: who acts, any set-up beyond the stage, the call, the player's
// line that asks for it, and the dice it rolls once asked.
const FAMILIES = [
  { tool: "pc_attack", who: kara, line: "I swing at the goblin.", dice: [15, 4], args: (enemy) => ({ characterId: kara.id, targetEnemyId: enemy.id, weapon: "Longsword" }) },
  { tool: "take_action", who: kara, line: "I take the Dodge action.", args: () => ({ characterId: kara.id, action: "dodge" }) },
  { tool: "end_turn", who: kara, line: "That's my turn.", args: () => ({ characterId: kara.id }) },
  {
    tool: "use_item", who: kara, line: "I drink a potion.", dice: [2, 2],
    setup: () => world.patch(kara.id, { currentHp: 20 }),
    args: () => ({ characterId: kara.id, item: "Potion of Healing" }),
  },
  { tool: "use_resource", who: kara, line: "Second Wind!", dice: [5], setup: () => world.patch(kara.id, { currentHp: 20 }), args: () => ({ characterId: kara.id, resource: "Second Wind" }) },
  {
    tool: "stabilize", who: kara, line: "I patch Brom up with my kit.",
    setup: () => {
      world.patch(brom.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false }, conditions: ["unconscious", "prone"] });
      kit.place(brom.id, 4, 5);
    },
    args: () => ({ characterId: brom.id, healerId: kara.id, method: "kit" }),
  },
  { tool: "cast_at_enemy", who: mage, line: "Magic Missile at the goblin.", dice: [1, 1, 1], args: (enemy) => ({ characterId: mage.id, targetEnemyId: enemy.id, spell: "Magic Missile", level: 1 }) },
  {
    tool: "aoe_damage", who: mage, line: "Burning Hands on the goblin.", dice: [10, 1, 1, 1],
    args: (enemy) => ({ casterId: mage.id, spell: "Burning Hands", level: 1, enemyIds: [enemy.id], saveAbility: "dex", damage: "3d6", type: "fire", halfOnSave: true }),
  },
  { tool: "teleport_token", who: mage, line: "I Misty Step away.", args: () => ({ tokenName: mage.id, x: 9, y: 5, spell: "Misty Step", casterId: mage.id }) },
  { tool: "cast_buff", who: sage, line: "I bless Kara.", setup: () => kit.place(kara.id, 4, 5), args: () => ({ characterId: sage.id, spell: "Bless", level: 1, targetCharacterIds: [kara.id] }) },
  {
    tool: "heal", who: sage, line: "Cure Wounds on Kara.", dice: [4],
    setup: () => {
      world.patch(kara.id, { currentHp: 20 });
      kit.place(kara.id, 4, 5);
    },
    args: () => ({ characterId: kara.id, casterId: sage.id, spell: "Cure Wounds", level: 1 }),
  },
  { tool: "use_spell_slot", who: sage, line: "I cast Detect Magic.", args: () => ({ characterId: sage.id, spell: "Detect Magic", level: 1 }) },
  {
    tool: "pet_attack", who: rhea, line: "My wolf bites the goblin.", dice: [15, 3, 3],
    setup: async () => {
      world.patch(rhea.id, { pets: [] });
      const summoned = await world.invoke("summon_pet", { characterId: rhea.id, kind: "beast_companion", form: "wolf" });
      assert.equal(summoned.ok, true, summoned.error);
    },
    args: (enemy) => ({ characterId: rhea.id, petName: "Wolf", targetEnemyId: enemy.id }),
  },
];

for (const family of FAMILIES) {
  await test(`${family.tool}: refused for a silent player on their own turn, spending nothing; resolved once the player asks.`, async () => {
    const enemy = await stage(family.who);
    await family.setup?.();
    const before = spendable();
    const silent = await ai.invoke(family.tool, family.args(enemy));
    assert.equal(silent.ok, false, `${family.tool} resolved for a silent player`);
    assert.equal(silent.error, REFUSAL(family.who.name));
    assert.equal(spendable(), before, `${family.tool} spent something on its refusal`);
    world.say("player", family.line, family.who);
    world.clearDice();
    world.dice(...(family.dice ?? []));
    const asked = await ai.invoke(family.tool, family.args(enemy));
    world.clearDice();
    assert.equal(asked.ok, true, asked.error);
  });
}

// ---- what counts as the player's word ----

await test("Table talk is not the player's word, and neither is a line the DM has already answered.", async () => {
  const enemy = await stage(kara);
  const swing = () => ai.invoke("pc_attack", { characterId: kara.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  world.say("player", "(ooc) brb, getting coffee", kara);
  assert.equal((await swing()).error, REFUSAL("Kara"));
  world.say("player", "I swing at the goblin.", kara);
  world.say("dm", "The goblin ducks behind its shield. Kara?");
  assert.equal((await swing()).error, REFUSAL("Kara"));
});

await test("Another player's line is not this player's word.", async () => {
  const enemy = await stage(kara);
  world.say("player", "Kara, hit it!", brom);
  const out = await ai.invoke("pc_attack", { characterId: kara.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  assert.equal(out.error, REFUSAL("Kara"));
});

// ---- what stays as it was ----

await test("A character who cannot act has no turn to play: the AI passes a stunned Kara's turn with no word from her, and a spend for her is refused for the stun.", async () => {
  const enemy = await stage(kara);
  assert.equal(characterAwaitingPlayer(world.campaignId)?.id, kara.id);
  world.patch(kara.id, { conditions: ["stunned"] });
  assert.equal(characterAwaitingPlayer(world.campaignId), null);
  const swing = await ai.invoke("pc_attack", { characterId: kara.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  assert.equal(swing.ok, false);
  assert.match(swing.error, /stunned/);
  const passed = await ai.invoke("end_turn", { characterId: kara.id });
  assert.equal(passed.ok, true, passed.error);
  assert.equal(kit.current().characterId, brom.id);
  world.patch(kara.id, { conditions: [] });
});

await test("A companion is the AI's to play: it attacks on its own turn with nobody speaking.", async () => {
  const enemy = await stage(pip);
  assert.equal(characterAwaitingPlayer(world.campaignId), null);
  world.dice(15, 4);
  const out = await ai.invoke("pc_attack", { characterId: pip.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
});

await test("The DM at the console keeps a free hand: an attack for a silent player resolves.", async () => {
  const enemy = await stage(kara);
  world.dice(15, 4);
  const out = await world.invoke("pc_attack", { characterId: kara.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
});

await test("Nothing off the character's own turn is asked: on Kara's turn, a call for silent Brom is not this refusal.", async () => {
  const enemy = await stage(kara);
  const out = await ai.invoke("pc_attack", { characterId: brom.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  assert.notEqual(out.error, REFUSAL("Brom"));
});

// ---- the turn loop ----

const model = await fakeModel();
model.pointAt(world);

await test("Kara presses End Turn and the DM turn that opens Brom's turn attacks for him: the model is handed the refusal and Brom has spent nothing.", async () => {
  const enemy = await stage(kara);
  kit.endTurn(kara.userId);
  assert.equal(kit.current().characterId, brom.id);
  // The End Turn route wakes the DM with no line of Brom's in the input.
  world.say("system", "Kara ends her turn.");
  const before = spendable();
  const swing = call("pc_attack", { characterId: brom.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  model.script([reply({ calls: [swing] }), reply({ text: "Brom grips his sword and waits." })]);
  world.dice(15, 4, 15, 4);
  await startDmTurn(world.campaignId);
  world.clearDice();
  assert.ok(systemPrompt(model.requests[0]).includes(WAITING("Brom")), "GAME STATE did not say the turn waits on Brom's player");
  const answered = model.results(model.requests[1]).find((entry) => entry.id === swing.id);
  assert.equal(answered.result.error, REFUSAL("Brom"));
  assert.equal(spendable().replace(/"rolls":\d+/, ""), before.replace(/"rolls":\d+/, ""));
});

// ---- the doors a person or an agent program comes through ----

// A route called as a signed-in user, as the browser or a connected agent
// program (src/lib/agents/workbench.ts) calls it; `agent` adds the header
// every agent request carries.
async function post(table, userId, routeName, body, agent = false) {
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

await test("A line through the actions route (the chat box, or an agent piloting the character) is the player's word: the DM turn it wakes attacks for Brom; table talk through it is not.", async () => {
  const enemy = await stage(brom);
  const swing = call("pc_attack", { characterId: brom.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  model.script([reply({ calls: [swing] }), reply({ text: "Brom's blade bites." })]);
  world.dice(15, 4, 15, 4);
  const posted = await post(world, brom.userId, "campaigns/[campaignId]/actions", { content: "I swing at the goblin.", kind: "do" });
  assert.equal(posted.status, 202, JSON.stringify(posted.json));
  await globalThis.__odmDmQueues.get(world.campaignId);
  world.clearDice();
  assert.ok(!systemPrompt(model.requests[0]).includes("Waiting on Brom's player"), "GAME STATE still waits on a player who spoke");
  const answered = model.results(model.requests[1]).find((entry) => entry.id === swing.id);
  assert.equal(answered.result.ok, true, answered.result.error);
  await stage(brom);
  const ooc = await post(world, brom.userId, "campaigns/[campaignId]/actions", { content: "brb, getting coffee", kind: "ooc" });
  assert.equal(ooc.status, 202, JSON.stringify(ooc.json));
  const out = await ai.invoke("pc_attack", { characterId: brom.id, targetEnemyId: world.enemies()[0].id, weapon: "Longsword" });
  assert.equal(out.error, REFUSAL("Brom"));
});

await test("A player's own End Turn needs no line first: the button, and odm_end_turn, are the player's word.", async () => {
  await stage(kara);
  model.script([reply({ text: "The fight turns to Brom." })]);
  const out = await post(world, kara.userId, "campaigns/[campaignId]/encounter/end-turn", {});
  await globalThis.__odmDmQueues.get(world.campaignId);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(kit.current().characterId, brom.id);
});

await test("An agent program in the DM seat gets the refusal through the console's route; the person in the seat does not.", async () => {
  const table = await openWorld({ gameSettings: { ttsEnabled: false } });
  const { setDmMode } = await import("../src/lib/db/campaigns.ts");
  setDmMode(table.campaignId, "human", table.owner.id);
  const tamsin = table.addHero({ name: "Tamsin", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED, maxHp: 60, equipment: [{ name: "Longsword", qty: 1 }], user: table.addUser("tamsin") });
  const tableKit = await combatKit(table);
  await tableKit.fight(1, { heroFaces: { [tamsin.id]: 20 } });
  const [enemy] = table.enemies();
  tableKit.setEnemy(enemy.id, { maxHp: 400 });
  tableKit.place(tamsin.id, 5, 5);
  tableKit.place(enemy.id, 5, 6);
  assert.equal(tableKit.current().characterId, tamsin.id);
  table.say("dm", "The goblin lunges. Tamsin, your turn.");
  const args = { characterId: tamsin.id, targetEnemyId: enemy.id, weapon: "Longsword" };
  const agent = await post(table, table.owner.id, "campaigns/[campaignId]/dm/invoke", { name: "pc_attack", args }, true);
  assert.equal(agent.status, 409, JSON.stringify(agent.json));
  assert.equal(agent.json.error, REFUSAL("Tamsin"));
  table.dice(15, 4);
  const person = await post(table, table.owner.id, "campaigns/[campaignId]/dm/invoke", { name: "pc_attack", args });
  table.clearDice();
  assert.equal(person.status, 200, JSON.stringify(person.json));
  const agentPass = await post(table, table.owner.id, "campaigns/[campaignId]/dm/invoke", { name: "end_turn", args: { characterId: tamsin.id } }, true);
  assert.equal(agentPass.status, 409, JSON.stringify(agentPass.json));
  assert.equal(agentPass.json.error, REFUSAL("Tamsin"));
  const personPass = await post(table, table.owner.id, "campaigns/[campaignId]/dm/invoke", { name: "end_turn", args: { characterId: tamsin.id } });
  assert.equal(personPass.status, 200, JSON.stringify(personPass.json));
});

await test("A turn parked for the player's own dice resumes on the input it parked with: Brom's second attack still resolves.", async () => {
  const enemy = await stage(brom);
  setMemberRealDice(world.campaignId, brom.userId, true);
  const swing = () => call("pc_attack", { characterId: brom.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  model.script([reply({ calls: [swing()] }), reply({ calls: [swing()] }), reply({ text: "Brom presses on." })]);
  await model.turn(world, "I attack the goblin twice.", brom.id, brom.userId);
  const answer = async (faces) => {
    const pending = listOpenPendingRolls(world.campaignId).find((entry) => entry.characterId === brom.id);
    assert.ok(pending, "no roll was parked for Brom");
    world.signIn({ id: brom.userId });
    const out = await callRoute(submitRoute, "POST", { dice: faces }, { campaignId: world.campaignId, pendingRollId: pending.id });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    return pending;
  };
  const first = await answer([18]);
  await answer([5]);
  await globalThis.__odmDmQueues.get(world.campaignId);
  // The second attack parked in its turn: it was let through, not refused.
  const second = listOpenPendingRolls(world.campaignId).find((entry) => entry.characterId === brom.id && entry.kind === "attack");
  assert.ok(second, "Brom's second attack did not reach the dice");
  assert.equal(second.turnId, first.turnId);
  assert.equal(getDmTurn(first.turnId).status, "awaiting_rolls");
  setMemberRealDice(world.campaignId, brom.userId, false);
});

model.close();
finish();
