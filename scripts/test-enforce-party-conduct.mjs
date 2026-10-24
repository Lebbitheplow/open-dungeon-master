// A lasting companion inside the party (issue 503 Phase 4), through the
// engine the way the DM reaches it: a companion wary of a character, or
// worse, spends no spell slot and no potion on them unless they are dying;
// a mercenary wary of the party wants its share as a fight starts and
// neither attacks nor casts until paid; a devoted companion takes a blow
// meant for its friend once a fight; and a companion wary of its commander
// will not walk out of a foe's reach on their word. Each refusal is the
// server's: nothing spent, the reason in the result, a line at the table,
// and the Bonds row says it.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-party-conduct");
const relationships = await import("../src/lib/db/relationships.ts");
const messages = await import("../src/lib/db/messages.ts");
const { conductGate } = await import("../src/lib/dm/party-conduct.ts");

const BODY = { str: 14, dex: 12, con: 14, int: 10, wis: 16, cha: 10 };

async function table({ gameSettings = {}, companion = {} } = {}) {
  const world = await openWorld({ gameSettings: { companions: "full", ...gameSettings } });
  const kit = await combatKit(world);
  const kael = world.addHero({ name: "Kael", level: 3, maxHp: 30, proficiencies: TRAINED });
  const added = await world.invoke("add_companion", {
    name: "Seren", class: "cleric", gender: "Female", personality: "Watchful.", kind: "party", level: 3, spells: ["Cure Wounds", "Bless"], ...companion,
  });
  assert.equal(added.ok, true, added.error);
  const seren = world.sheets().find((entry) => entry.name === "Seren");
  world.patch(seren.id, { abilities: BODY, currentHp: seren.maxHp });
  const standing = (approval, who = kael) => {
    const bond = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: who.id, characterName: who.name, subjectKind: "companion", subjectName: "Seren" });
    relationships.patchRelationship(bond.id, { approval });
  };
  const slots = () => world.sheet(seren.id).spellcasting.slots["1"].used;
  return { world, kit, kael, seren, standing, slots };
}

async function bonds(world) {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/relationships");
  const response = await handler.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
  const body = await response.json();
  return body.relationships.find((entry) => entry.subjectName === "Seren" && entry.conscience)?.conscience ?? null;
}

const lastLines = (world) => messages.listRecentMessages(world.campaignId, 4).map((message) => message.content).join("\n");

await test("a companion wary of a character spends no slot on them: heal and cast_buff are refused with the reason, nothing spent, the table told, the Bonds row says it", async () => {
  const { world, kael, seren, standing, slots } = await table();
  standing(-15);
  world.patch(kael.id, { currentHp: 10 });
  const healed = await world.invoke("heal", { characterId: kael.id, casterId: seren.id, spell: "Cure Wounds", level: 1 });
  assert.equal(healed.ok, false);
  assert.match(healed.error, /^Seren will not spend a spell slot on Kael: Seren is wary of them \(-15\)\. Only if Kael were dying\. Nothing was spent\.$/);
  assert.equal(slots(), 0, "no slot spent");
  assert.equal(world.sheet(kael.id).currentHp, 10);
  const blessed = await world.invoke("cast_buff", { characterId: seren.id, spell: "Bless", targetCharacterIds: [kael.id] });
  assert.equal(blessed.ok, false);
  assert.match(blessed.error, /will not spend a spell slot on Kael/);
  assert.equal(slots(), 0);
  assert.match(lastLines(world), /Seren refuses a spell for Kael\./, "the table is told by the server");
  const row = await bonds(world);
  assert.equal(row.refused, "a spell for Kael");
});

await test("unless that character is dying: the same heal lands", async () => {
  const { world, kael, seren, standing, slots } = await table();
  standing(-40);
  world.patch(kael.id, { currentHp: 0, deathSaves: { successes: 0, failures: 1, stable: false, dead: false } });
  const healed = await world.invoke("heal", { characterId: kael.id, casterId: seren.id, spell: "Cure Wounds", level: 1 });
  assert.equal(healed.ok, true, healed.error);
  assert.ok(world.sheet(kael.id).currentHp > 0);
  assert.equal(slots(), 1);
});

await test("a potion is not spent on a character she is wary of; neutral, she heals as before; an Off table keeps approval social", async () => {
  const { world, kael, seren, standing, slots } = await table();
  world.patch(seren.id, { equipment: [...world.sheet(seren.id).equipment, { name: "Potion of Healing", qty: 1 }] });
  standing(-15);
  world.patch(kael.id, { currentHp: 10 });
  const fed = await world.invoke("use_item", { characterId: seren.id, item: "Potion of Healing", targetCharacterId: kael.id });
  assert.equal(fed.ok, false);
  assert.match(fed.error, /will not spend a potion on Kael/);
  assert.ok(world.sheet(seren.id).equipment.some((item) => item.name === "Potion of Healing"), "the potion is kept");
  standing(0);
  const healed = await world.invoke("heal", { characterId: kael.id, casterId: seren.id, spell: "Cure Wounds", level: 1 });
  assert.equal(healed.ok, true, healed.error);
  assert.equal(slots(), 1);

  const off = await table({ gameSettings: { companionConscience: "off" } });
  off.standing(-80);
  off.world.patch(off.kael.id, { currentHp: 10 });
  const plain = await off.world.invoke("heal", { characterId: off.kael.id, casterId: off.seren.id, spell: "Cure Wounds", level: 1 });
  assert.equal(plain.ok, true, plain.error);
});

await test("a mercenary wary of the party wants its share as the fight starts, neither attacks nor casts until paid, and fights once it is", async () => {
  const { world, kit, seren, standing } = await table({ companion: { class: "fighter", spells: [], values: [{ value: "mercenary", strength: "cares" }] } });
  standing(-20);
  world.patch(seren.id, { gold: 5, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }] });
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  assert.equal(started.ok, true, started.error);
  assert.match(started.result.shares, /Seren demands their share before fighting: 30 gp\. Until a party member pays it \(modify_gold\), they neither attack nor cast\./);
  assert.match(lastLines(world), /Seren wants their share before they fight: 30 gp\./);
  assert.equal((await bonds(world)).demand, "30 gp before they fight");
  const [goblin] = world.enemies();
  const swung = await kit.attack(seren.id, goblin.id);
  assert.equal(swung.ok, false);
  assert.match(swung.error, /^Seren will not fight until paid their share: 30 gp still owed/);
  const paid = await world.invoke("modify_gold", { characterId: seren.id, delta: 30, reason: "her share" });
  assert.equal(paid.ok, true, paid.error);
  assert.equal(conductGate(world.campaign(), "pc_attack", JSON.stringify({ characterId: seren.id })), null, "paid: she fights");
  assert.match(lastLines(world), /Seren takes their share and fights\./);
  assert.equal((await bonds(world)).demand, undefined);
});

await test("a companion who holds no mercenary value, or is not wary, asks no share", async () => {
  const { world, standing } = await table({ companion: { class: "fighter", spells: [] } });
  standing(-20);
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  assert.equal(started.ok, true, started.error);
  assert.equal(started.result.shares, undefined);
});

await test("a devoted companion takes the blow meant for her friend, once a fight; a close one cannot", async () => {
  const { world, kit, kael, seren, standing } = await table();
  standing(70);
  await kit.fight(1, { heroFaces: { [kael.id]: 19, [seren.id]: 3 } });
  const [goblin] = world.enemies();
  world.patch(kael.id, { currentHp: 30, ac: 12, acOverride: true });
  world.patch(seren.id, { currentHp: 20 });
  kit.place(kael.id, 5, 5);
  kit.place(seren.id, 4, 5);
  kit.place(goblin.id, 5, 6);
  const hit = async () => {
    kit.freshRound();
    world.dice(15, 4);
    const out = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: kael.id });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    return out.result;
  };
  await hit();
  const hurt = world.sheet(kael.id).currentHp;
  assert.ok(hurt < 30, "Kael was hit");
  const close = await world.invoke("use_reaction", { characterId: seren.id, feature: "Take the Blow", targetCharacterId: kael.id });
  assert.equal(close.ok, false);
  assert.match(close.error, /Seren is not devoted to Kael \(close, a trusted friend\)/);
  standing(90);
  const taken = await world.invoke("use_reaction", { characterId: seren.id, feature: "Take the Blow", targetCharacterId: kael.id });
  assert.equal(taken.ok, true, taken.error);
  assert.equal(world.sheet(kael.id).currentHp, 30, "the blow comes off Kael");
  assert.equal(world.sheet(seren.id).currentHp, 20 - (30 - hurt), "and lands on Seren");
  assert.equal(taken.result.reaction, "Take the Blow");
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, reactionsUsed: [] });
  await hit();
  const again = await world.invoke("use_reaction", { characterId: seren.id, feature: "Take the Blow", targetCharacterId: kael.id });
  assert.equal(again.ok, false);
  assert.match(again.error, /once a fight/);
});

await test("a companion wary of her commander will not walk out of a foe's reach on their word; a safe walk stands", async () => {
  const { world, kit, kael, seren, standing } = await table({ companion: { class: "fighter", spells: [] } });
  assert.equal(world.sheet(seren.id).commandedBy, world.owner.id, "the solo player commands her");
  standing(-30);
  await kit.fight(1, { heroFaces: { [kael.id]: 3, [seren.id]: 19 } });
  const [goblin] = world.enemies();
  kit.place(kael.id, 12, 12);
  kit.place(seren.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  kit.giveTurn(seren.id);
  world.signIn(world.owner);
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  const move = async (x, y) => {
    const response = await route.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ x, y }) }), { params: Promise.resolve({ campaignId: world.campaignId }) });
    return { status: response.status, body: await response.json() };
  };
  const away = await move(5, 3);
  assert.equal(away.status, 409, JSON.stringify(away.body));
  assert.match(away.body.error, /^Seren will not walk out of Goblin's reach on Kael's word: Seren dislikes them\./);
  assert.equal(kit.token(seren.id).y, 5, "nothing moved");
  const safe = await move(4, 5);
  assert.equal(safe.status, 200, JSON.stringify(safe.body));
  void goblin;
});

finish();
