// What a turn's movement must still mean once every turn brings its own
// (test-enforce-turn-movement.mjs): the AI walking a character's typed move
// walks them as the board's move route does, and nothing spends movement
// outside the turn it belongs to, where the turn's refill would hand it back.
//
// SRD 5.1, Movement and Position ("on your turn"), Being Prone, Grappling
// (Moving a Grappled Creature) and Mounted Combat ("once during your move").
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { aiEngine } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-turn-movement-2");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const { pcMoveBudget } = await import("../src/lib/battlemap/view.ts");
const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { subscribe } = await import("../src/lib/events.ts");
const ai = await aiEngine(world);

const kara = world.addHero({
  name: "Kara", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED, maxHp: 200, speed: 30,
});
const brom = world.addHero({
  name: "Brom", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED, maxHp: 200, speed: 30,
});

const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");
async function walk(sheet, x, y) {
  world.signIn({ id: sheet.userId });
  const response = await moveRoute.POST(
    new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify({ x, y }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return response.status;
}

const lit = (sheet) => pcMoveBudget(world.campaignId, world.encounter(), kit.map(), world.sheet(sheet.id), kit.token(sheet.id)).tiles;
const at = (refId) => [kit.token(refId).x, kit.token(refId).y];
const say = (authorType, content, sheet) =>
  insertCampaignMessage({
    campaignId: world.campaignId,
    seq: allocateSeq(world.campaignId),
    authorType,
    content,
    ...(sheet ? { userId: sheet.userId, characterId: sheet.id } : {}),
  });

// Kara's turn, then the goblin's, then Brom's: the goblin's turn comes when
// Kara's ends. `paint` draws the field (src/lib/battlemap/terrain).
async function stage(paint = []) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 20, [brom.id]: 15 } });
  kit.openField(paint);
  kit.scatter();
  const [goblin] = world.enemies();
  const encounter = world.encounter();
  const pcs = encounter.order.filter((entry) => entry.kind === "pc");
  const goblinEntry = encounter.order.find((entry) => entry.kind === "enemy");
  const first = pcs.find((entry) => entry.characterId === kara.id);
  const order = [first, goblinEntry, ...pcs.filter((entry) => entry !== first)];
  kit.saveEncounter({ ...encounter, order, turnIndex: 0 });
  kit.setEnemy(goblin.id, { stats: { speed: "30 ft." }, maxHp: 400 });
  say("dm", "The goblin bursts from the reeds. Kara, it's your turn.");
  ai.fresh();
  return goblin;
}

// A corridor along row 2, walls everywhere else.
function corridor() {
  const paint = [];
  for (let x = 0; x < 20; x += 1) {
    for (const y of [1, 3]) {
      paint.push([x, y, "#"]);
    }
  }
  return paint;
}

// ---- a typed move walks as the board walks ----

await test("A typed move passes through an ally's square at the price the board charges for it.", async () => {
  await stage(corridor());
  kit.place(kara.id, 2, 2);
  kit.place(brom.id, 4, 2);
  assert.equal(await walk(kara, 6, 2), 200, "the board refused the walk through Brom");
  const board = lit(kara);
  await stage(corridor());
  kit.place(kara.id, 2, 2);
  kit.place(brom.id, 4, 2);
  say("player", "Kara slips past Brom, 20 feet down the passage.", kara);
  const out = await ai.invoke("move_token", { tokenName: kara.id, x: 6, y: 2 });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(at(kara.id), [6, 2]);
  assert.equal(lit(kara), board, "the typed walk charged a different price from the board's");
});

await test("A typed move redraws the board at once, as a walk from the board does.", async () => {
  await stage();
  kit.place(kara.id, 2, 2);
  const seen = [];
  const stop = subscribe(world.campaignId, (chunk) => seen.push(/^event: (.+)$/m.exec(chunk)?.[1] ?? ""));
  say("player", "Kara hurries 20 feet east.", kara);
  const out = await ai.invoke("move_token", { tokenName: kara.id, x: 6, y: 2 });
  stop();
  assert.equal(out.ok, true, out.error);
  assert.ok(seen.includes("battle_map_updated"), "the board was not told the token moved");
});

await test("A typed move away from the goblin the character grapples lets it go; with drag it comes along at half speed and the grapple holds.", async () => {
  const goblin = await stage();
  kit.place(kara.id, 4, 4);
  kit.place(goblin.id, 5, 4);
  kit.setEnemy(goblin.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: kara.id } } });
  say("player", "Kara lets the goblin go and backs off 20 feet.", kara);
  const away = await ai.invoke("move_token", { tokenName: kara.id, x: 0, y: 4 });
  assert.equal(away.ok, true, away.error);
  assert.equal(kit.enemy(goblin.id).conditions.includes("grappled"), false, "the grapple held across 20 feet");

  const held = await stage();
  kit.place(kara.id, 4, 4);
  kit.place(held.id, 5, 4);
  kit.setEnemy(held.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: kara.id } } });
  say("player", "Kara drags the goblin 10 feet west.", kara);
  const dragged = await ai.invoke("move_token", { tokenName: kara.id, x: 2, y: 4, drag: true });
  assert.equal(dragged.ok, true, dragged.error);
  assert.deepEqual(at(kara.id), [2, 4]);
  const [gx, gy] = at(held.id);
  assert.equal(Math.max(Math.abs(gx - 2), Math.abs(gy - 4)), 1, "the goblin was not set down beside Kara");
  assert.equal(kit.enemy(held.id).conditions.includes("grappled"), true, "dragging let go");
  // A Small goblin is one size under Kara: every square costs two.
  assert.equal(lit(kara), 2, "dragging cost what walking costs");
});

// ---- an enemy walks on its own turn ----

await test("The AI walks an enemy only once its turn has come; the console moves it any time, and a legendary creature moves on a legendary action.", async () => {
  const goblin = await stage();
  kit.place(goblin.id, 10, 10);
  const early = await ai.invoke("move_token", { tokenName: goblin.id, x: 12, y: 10 });
  assert.equal(early.ok, false, "the AI walked the goblin before its turn, and its turn would have refilled the walk");
  assert.match(early.error, /turn has not come yet/);
  assert.equal((await world.invoke("move_token", { tokenName: goblin.id, x: 12, y: 10 })).ok, true, "the console lost its free hand");
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, legendary: { ...encounter.legendary, pools: { ...encounter.legendary.pools, [goblin.id]: { actions: 3, resistances: 0 } } } });
  assert.equal((await ai.invoke("move_token", { tokenName: goblin.id, x: 13, y: 10 })).ok, true, "a legendary creature could not move off its turn");
  kit.saveEncounter({ ...world.encounter(), legendary: { ...world.encounter().legendary, pools: {} } });
  kit.endTurn(kara.userId);
  ai.fresh();
  const own = await ai.invoke("move_token", { tokenName: goblin.id, x: 7, y: 10 });
  assert.equal(own.ok, true, own.error);
  assert.equal(kit.token(goblin.id).x, 7, "the goblin's own turn did not bring its speed");
});

await test("The AI standing an enemy up costs half its speed on its turn, and is refused before its turn or without the movement; the console stays free.", async () => {
  const goblin = await stage();
  kit.place(goblin.id, 10, 10);
  kit.setEnemy(goblin.id, { conditions: ["prone"] });
  const early = await ai.invoke("clear_enemy_condition", { enemyId: goblin.id, condition: "prone" });
  assert.equal(early.ok, false, "the goblin stood up before its turn");
  assert.equal(kit.enemy(goblin.id).conditions.includes("prone"), true);
  kit.endTurn(kara.userId);
  ai.fresh();
  kit.place(goblin.id, 10, 10, 4);
  const short = await ai.invoke("clear_enemy_condition", { enemyId: goblin.id, condition: "prone" });
  assert.equal(short.ok, false, "the goblin stood with 10 feet left");
  kit.place(goblin.id, 10, 10, 0);
  const stood = await ai.invoke("clear_enemy_condition", { enemyId: goblin.id, condition: "prone" });
  assert.equal(stood.ok, true, stood.error);
  assert.equal(kit.enemy(goblin.id).conditions.includes("prone"), false);
  assert.equal(kit.token(goblin.id).movedThisRound, 3, "standing up cost the goblin nothing");
  kit.setEnemy(goblin.id, { conditions: ["prone"] });
  kit.place(goblin.id, 10, 10, 6);
  assert.equal((await world.invoke("clear_enemy_condition", { enemyId: goblin.id, condition: "prone" })).ok, true, "the console lost its free hand");
});

await test("An ambusher's Disengage that closes the turn it was owed leaves its own turn its full speed.", async () => {
  await kit.endFight();
  await world.beginFight([{ monster: "goblin", count: 1 }], { surprised: "party", enemyFace: 20 });
  kit.openField();
  kit.scatter();
  const [goblin] = world.enemies();
  // No Nimble Escape: its Disengage is the action that closes the owed turn.
  kit.setEnemy(goblin.id, { stats: { speed: "30 ft.", traits: [] }, maxHp: 400 });
  kit.place(goblin.id, 0, 2);
  kit.place(kara.id, 1, 3);
  const owed = await world.invoke("move_token", { tokenName: goblin.id, x: 6, y: 2, disengage: true });
  assert.equal(owed.ok, true, owed.error);
  assert.equal(kit.token(goblin.id).x, 6);
  const own = await world.invoke("move_token", { tokenName: goblin.id, x: 12, y: 2 });
  assert.equal(own.ok, true, `the own turn kept the owed turn's walk spent: ${own.error}`);
  assert.equal(kit.token(goblin.id).x, 12);
});

// ---- mounting ----

await test("Mounting costs half the rider's speed during their own move; the AI is refused off their turn, the console is not.", async () => {
  await stage();
  const off = await ai.invoke("mount_up", { characterId: brom.id, mount: "Riding horse" });
  assert.equal(off.ok, false, "Brom mounted on Kara's turn, and his turn would have refilled the cost");
  assert.match(off.error, /own move only/);
  const on = await ai.invoke("mount_up", { characterId: kara.id, mount: "Riding horse" });
  assert.equal(on.ok, true, on.error);
  assert.equal(kit.token(kara.id).movedThisRound, 3, "mounting cost no movement");
  assert.equal((await world.invoke("mount_up", { characterId: brom.id, mount: "Riding horse" })).ok, true, "the console lost its free hand");
});

await kit.endFight();
world.close();
finish();
