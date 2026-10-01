// What the player's screens are given by the server, and what the server
// accepts from them (workstream ui-play, /tmp/odm-enf2/fixes/ui-play.md):
//
//   - A reaction card is played on somebody else's turn: the actions route
//     lets it past the initiative floor and asks the engine (canAct for a
//     reaction, the cast guard for a reaction spell) instead. Before this the
//     floor refused every card off the player's turn (U:UA2).
//   - The public encounter carries what the Hand's gates ask the engine with:
//     whose turn it is, surprise, spent reactions, the attacks a reaction may
//     still answer (the last-hit record), a knocked-out enemy, and what a
//     condition's metadata says (U:UA2, UA3, UA9, pc-attack's knockout).
//   - The board projection carries a character's concentration, exhaustion
//     and death track on the token, and the cover and flanking the attack
//     will meet (U:UA8, UA10).
//   - A warlock's pact slots are a counter the sheet can spend (U:UC13), and
//     the sheet can ask whether the short-rest window is open (gear's X:R1).
// Stored state and route answers are read, never narration.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { fakeModel } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-ui-play");
const world = await openWorld({ gameSettings: { ttsEnabled: false, variantRules: { flanking: true } } });
// The actions route wakes a DM turn; it must never reach a real backend.
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);

const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { getFloor } = await import("../src/lib/db/campaigns.ts");
const { openShortRestWindow } = await import("../src/lib/db/clock.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");

const kara = world.addHero({
  name: "Kara", class: "fighter", level: 5, maxHp: 30, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});
const mira = world.addHero({
  name: "Mira", class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Shield"], known: [], cantrips: ["Fire Bolt"] },
});
const vex = world.addHero({
  name: "Vex", class: "warlock", level: 3, maxHp: 24, abilities: { cha: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "cha", slots: {}, prepared: [], known: ["Hex"], cantrips: [], pact: { level: 2, max: 2, used: 0 } },
});

const sly = world.addHero({
  name: "Sly", class: "rogue", level: 5, maxHp: 30, abilities: { dex: 16 }, proficiencies: TRAINED,
  features: [{ name: "Uncanny Dodge", source: "class", level: 5 }],
});

async function post(route, userId, body, method = "POST") {
  const handler = await world.route(route);
  world.signIn({ id: userId });
  const response = await handler[method](
    new Request("http://test/", method === "GET" ? { method } : {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}
const act = (userId, body) => post("campaigns/[campaignId]/actions", userId, body);

// A fight with the pointer on Kara and the dummy parked away from everyone.
async function stage() {
  await kit.endFight();
  await kit.fight(1);
  for (const hero of [kara, mira, vex, sly]) {
    world.patch(hero.id, { ac: 12, acOverride: true, currentHp: world.sheet(hero.id).maxHp, conditions: [], conditionMeta: {} });
  }
  kit.giveTurn(kara.id);
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  return enemy;
}

// ---- U:UA2 a reaction off the character's turn ----

await test("A reaction card is played off the character's turn: the actions route lets it past the initiative floor and posts it for use_reaction.", async () => {
  await stage();
  const floor = getFloor(world.campaignId);
  const offTurn = [kara, mira, vex].find((hero) => floor.mode === "initiative" && !floor.userIds.includes(hero.userId) && hero.id === mira.id);
  assert.ok(offTurn, `the floor should not be Mira's (${JSON.stringify(floor)})`);
  const before = listRecentMessages(world.campaignId, 50).length;
  const out = await act(mira.userId, {
    content: "I cast Shield as a reaction.", kind: "do",
    intent: { card: "reaction", feature: "Shield", spell: "Shield", slotLevel: 1 },
  });
  assert.equal(out.status, 202, JSON.stringify(out.json));
  const stored = listRecentMessages(world.campaignId, 50);
  assert.equal(stored.length, before + 1);
  const message = stored.find((entry) => entry.id === out.json.messageId);
  assert.equal(message?.intent?.card, "reaction");
  assert.equal(message?.intent?.feature, "Shield");
});

await test("Off the character's turn anything but a reaction card is still held by the floor.", async () => {
  await stage();
  const out = await act(mira.userId, {
    content: "I cast Fire Bolt at the goblin.", kind: "do", intent: { card: "spell", spell: "Fire Bolt", slotLevel: null },
  });
  assert.equal(out.status, 409, JSON.stringify(out.json));
  assert.match(out.json.error, /turn in the initiative order/);
});

await test("A reaction card from a character whose reaction is spent is refused up front with the engine's reason.", async () => {
  await stage();
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, reactionsUsed: [...encounter.reactionsUsed, mira.id] });
  const out = await act(mira.userId, {
    content: "I cast Shield as a reaction.", kind: "do",
    intent: { card: "reaction", feature: "Shield", spell: "Shield", slotLevel: 1 },
  });
  assert.equal(out.status, 409, JSON.stringify(out.json));
  assert.match(out.json.error, /already used their reaction/);
});

await test("A reaction feature card from a character whose reaction is spent is refused up front in the spend function's words.", async () => {
  await stage();
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, reactionsUsed: [...encounter.reactionsUsed, sly.id] });
  const out = await act(sly.userId, {
    content: "I use Uncanny Dodge as my reaction.", kind: "do", intent: { card: "reaction", feature: "Uncanny Dodge" },
  });
  assert.equal(out.status, 409, JSON.stringify(out.json));
  assert.match(out.json.error, /Sly has already used their reaction; it comes back at the start of their next turn\. Uncanny Dodge does not happen\./);
});

// ---- the public encounter the Hand asks the engine with ----

await test("The public encounter names whose turn it is, and the spent reactions of characters only.", async () => {
  const enemy = await stage();
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, reactionsUsed: [mira.id, enemy.id] });
  const view = activePublicEncounter(world.campaignId);
  assert.deepEqual(view.acting, { id: kara.id, name: "Kara" });
  assert.deepEqual(view.reactionsUsed, [mira.id]);
  assert.deepEqual(view.surprised, { acting: [], reacting: [] });
});

await test("An enemy's hit on a character is projected as an attack a reaction may answer, and not once the turn has moved.", async () => {
  const enemy = await stage();
  kit.freshRound();
  kit.place(mira.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  world.dice(15, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: mira.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const hit = activePublicEncounter(world.campaignId).lastHits?.find((entry) => entry.characterId === mira.id);
  assert.ok(hit, "no last hit projected");
  assert.equal(hit.hit, true);
  assert.equal(hit.source, "attack");
  assert.equal(hit.attackerId, enemy.id);
  assert.ok(hit.damage > 0);
  kit.giveTurn(vex.id);
  assert.equal(activePublicEncounter(world.campaignId).lastHits?.some((entry) => entry.characterId === mira.id) ?? false, false);
});

await test("A knocked-out enemy is projected as knocked out, and a condition says until whose turn it lasts.", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, {
    currentHp: 0,
    conditions: ["unconscious", "prone", "stunned"],
    conditionMeta: { unconscious: { source: "knocked out" }, stunned: { untilTurnOf: kara.id, source: kara.id } },
  });
  const view = activePublicEncounter(world.campaignId);
  const projected = view.enemies.find((entry) => entry.id === enemy.id);
  assert.equal(projected.knockedOut, true);
  assert.equal(projected.conditionNotes.stunned, "until Kara's turn, from Kara");
  assert.equal(projected.conditionNotes.unconscious, "knocked out");
});

// ---- U:UA8 / UA10 the board ----

await test("A character's token carries concentration, exhaustion and the death track on the board.", async () => {
  await stage();
  world.patch(kara.id, { concentratingOn: "Bless", exhaustion: 2 });
  world.patch(vex.id, { currentHp: 0, deathSaves: { successes: 1, failures: 1 } });
  const view = buildPlayerMapView(world.campaignId, mira.userId);
  const karaToken = view.tokens.find((token) => token.refId === kara.id);
  const vexToken = view.tokens.find((token) => token.refId === vex.id);
  const labels = (token) => (view.tokenConditions[token.id] ?? []).map((row) => row.label);
  assert.ok(labels(karaToken).includes("Concentrating: Bless"), JSON.stringify(labels(karaToken)));
  assert.ok(labels(karaToken).includes("Exhaustion 2"));
  assert.ok(labels(vexToken).includes("Dying 1/1"));
  world.patch(kara.id, { concentratingOn: null, exhaustion: 0 });
  world.patch(vex.id, { currentHp: 24, deathSaves: null });
});

await test("The board tells the player the cover a creature in the line gives, and the flanking an ally across gives, the way pc_attack reads them.", async () => {
  const enemy = await stage();
  // Mira stands between Kara and the goblin: half cover from Kara's side.
  kit.place(kara.id, 2, 2);
  kit.place(mira.id, 4, 2);
  kit.place(enemy.id, 6, 2);
  kit.place(vex.id, 9, 9);
  kit.place(sly.id, 9, 6);
  const covered = buildPlayerMapView(world.campaignId, kara.userId).edges[enemy.id];
  assert.equal(covered.cover, 2);
  assert.equal(covered.adjacent, false);
  // Kara and Vex on opposite sides of it: flanking (the variant is on).
  kit.place(mira.id, 9, 9);
  kit.place(kara.id, 5, 2);
  kit.place(vex.id, 7, 2);
  const flanked = buildPlayerMapView(world.campaignId, kara.userId).edges[enemy.id];
  assert.equal(flanked.adjacent, true);
  assert.equal(flanked.flanking, true);
});

// ---- U:UC13 pact slots; the hit dice window ----

await test("A warlock marks a pact slot spent on the sheet; handing it back is a correction the player cannot make.", async () => {
  await kit.endFight();
  const spent = await post("campaigns/[campaignId]/sheet/usage", vex.userId, { pactUsed: 1 });
  assert.equal(spent.status, 200, JSON.stringify(spent.json));
  assert.equal(world.sheet(vex.id).spellcasting.pact.used, 1);
  const back = await post("campaigns/[campaignId]/sheet/usage", vex.userId, { pactUsed: 0 });
  assert.equal(back.status, 409, JSON.stringify(back.json));
  assert.equal(world.sheet(vex.id).spellcasting.pact.used, 1);
});

await test("The sheet can ask whether its character may spend hit dice now: only inside the short rest's window.", async () => {
  await kit.endFight();
  const closed = await post("campaigns/[campaignId]/sheet/hit-dice", mira.userId, null, "GET");
  assert.equal(closed.json.open, false);
  openShortRestWindow(world.campaignId, [mira.id]);
  const open = await post("campaigns/[campaignId]/sheet/hit-dice", mira.userId, null, "GET");
  assert.equal(open.json.open, true);
  const other = await post("campaigns/[campaignId]/sheet/hit-dice", kara.userId, null, "GET");
  assert.equal(other.json.open, false);
});

model.close();
await kit.endFight();
world.close();
finish();
