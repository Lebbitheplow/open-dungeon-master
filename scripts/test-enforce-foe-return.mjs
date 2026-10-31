// A foe who comes back to a later fight comes back as the last one left
// them (issue #667): a raider knocked unconscious in one fight was listed
// "CR 1/8 Healthy" at full hit points when the next began straight after.
//
// The rules, from SRD 5.1:
//   - Knocking a Creature Out: a melee attacker that drops a creature to 0
//     may knock it out; it falls unconscious and is stable. A stable creature
//     regains 1 hit point after 1d4 hours.
//   - Resting: a long rest is 8 hours, needs 1 hit point at its start, and
//     gives back every hit point.
//   - A dead creature stays dead.
//
// ODM's own rules, pinned here as it documents them (src/lib/dm/foe-return.ts):
//   - A creature from an earlier fight is named by its enemyId there
//     (returning), or, alone, by the name the tracker showed, within a day
//     of world time; a Cast NPC is found by who they are.
//   - A foe who comes back is worth only the XP its last fight left unpaid.
//   - A creature lying knocked out cannot flee, and does not hold a fight
//     open; one that regains a hit point comes to.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call } from "./lib/enforce-campaign.mjs";

const { test, finish } = suite("test-enforce-foe-return");
const world = await openWorld();
const kit = await combatKit(world);
const encounters = await import("../src/lib/db/encounters.ts");
const clock = await import("../src/lib/db/clock.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { isKnockedOut } = await import("../src/lib/dm/knockout.ts");
const { foesAboutBlock } = await import("../src/lib/dm/foe-return.ts");
const { createNpcFromDraft } = await import("../src/lib/db/npcs.ts");
const { normalizeNpcDraft } = await import("../src/lib/npcs/forge.ts");
const { createHomebrewMonster } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { applyEncounterCall } = await import("../src/lib/dm/encounter-tools.ts");
const { applyExtraEncounterCall } = await import("../src/lib/dm/encounter-tools-extra.ts");
const { listSheets } = await import("../src/lib/db/sheets.ts");

const fighter = world.addHero({
  class: "fighter", level: 5, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});

// A fight against `count` dummies (40 hit points, AC 13), the fighter first
// and beside the first of them.
async function stage(count = 1) {
  await kit.endFight();
  await kit.fight(count, { heroFaces: { [fighter.id]: 19 } });
  const enemies = world.enemies();
  kit.place(fighter.id, 5, 5);
  kit.place(enemies[0].id, 5, 6);
  return enemies;
}

// The fighter knocks `enemy` out with a nonlethal longsword blow, the 1d4
// to coming to forced to `hours`.
async function knockOut(enemy, hours = 2) {
  kit.setEnemy(enemy.id, { currentHp: 3 });
  kit.place(enemy.id, 5, 6);
  const swing = await kit.swing(fighter.id, enemy.id, [15, 6, hours], { weapon: "Longsword", nonlethal: true });
  assert.equal(swing.ok, true, swing.error);
  const after = encounters.getEnemy(enemy.id);
  assert.equal(isKnockedOut(after), true);
  return swing;
}

// A fight begun from the DM console (a typed roster), initiative in.
async function begin(enemies) {
  await kit.endFight();
  await world.beginFight(enemies, { heroFaces: { [fighter.id]: 19 } });
  return world.enemies();
}

// A call the AI GM makes, the way the turn loop runs it: its arguments
// reach the tool as sent (the console form reads a roster of names and
// counts, and has no returning field). Shaped like the console's outcome.
async function ai(name, args) {
  const turn = createDmTurn(world.campaignId, [], "ai");
  const sheets = listSheets(world.campaignId);
  const byId = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const raw = JSON.stringify(args);
  const result =
    applyExtraEncounterCall(world.campaign(), turn, name, raw, sheets, byId)?.result ??
    applyEncounterCall(world.campaign(), turn, name, raw, sheets, byId, { realDiceUserIds: new Set(), toolCallId: null }).result;
  return result.error ? { ok: false, ...result } : { ok: true, result };
}

// The AI's start_encounter, initiative in: the enemies' dice, then the
// fighter's 19.
async function aiBegin(enemies) {
  await kit.endFight();
  world.clearDice();
  const count = enemies.reduce((sum, entry) => sum + (entry.count ?? 1), 0);
  world.dice(...new Array(count).fill(1), 19);
  const out = await ai("start_encounter", { enemies });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  if (!world.encounter().order.some((entry) => entry.characterId === fighter.id)) {
    world.dice(19);
    await world.invoke("request_roll", { characterId: fighter.id, kind: "initiative", reason: "initiative" });
    world.clearDice();
  }
  return world.enemies();
}

function later(hours) {
  const out = clock.advanceClock(world.campaignId, hours, "hours");
  assert.equal("error" in out, false, out.error);
}

await test("A foe knocked out in one fight comes into the next still knocked out, at 0 hit points, worth nothing more", async () => {
  const [raider] = await stage(1);
  const swing = await knockOut(raider, 2);
  // The last foe down ends the fight a victory, and the GM is told who lies
  // knocked out and how to bring them back.
  assert.equal(world.encounter(), null);
  assert.match(String(swing.result.spared ?? ""), new RegExp(`\\[enemyId=${raider.id}\\].*about 2 hours.*returning`));
  const [back, fresh] = await aiBegin([{ monster: "goblin", returning: raider.id }, { monster: "goblin" }]);
  assert.equal(back.carriedFrom, raider.id);
  assert.equal(back.currentHp, 0);
  assert.equal(isKnockedOut(back), true);
  assert.equal(back.xp, 0, "the victory already paid for them");
  assert.equal(fresh.carriedFrom, undefined);
  assert.equal(fresh.currentHp, fresh.maxHp);
  const view = activePublicEncounter(world.campaignId).enemies.find((entry) => entry.id === back.id);
  assert.equal(view.knockedOut, true, "the tracker shows them down, not Healthy");
});

await test("A truce leaves a foe lying knocked out where it fell, not fled; the wounded who walked away come back as hurt as they left", async () => {
  const [down, hurt] = await stage(2);
  await knockOut(down, 3);
  kit.setEnemy(hurt.id, { currentHp: 10 });
  const xp = encounters.getEnemy(hurt.id).xp;
  const ended = await world.invoke("end_encounter", { outcome: "truce" });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(encounters.getEnemy(down.id).status, "alive");
  assert.equal(isKnockedOut(encounters.getEnemy(down.id)), true);
  assert.equal(encounters.getEnemy(hurt.id).status, "fled");
  // The after-the-fight card counts the spared, and the fled of a truce.
  const card = encounters.getEncounter(down.encounterId).summaryCard;
  assert.equal(card.spared, 1);
  assert.equal(card.fled, 1);
  const [back] = await aiBegin([{ monster: "goblin", returning: hurt.id }]);
  assert.equal(back.currentHp, 10);
  assert.equal(back.xp, Math.round(xp / 2), "a truce paid half; the rest is still owed");
  assert.equal(activePublicEncounter(world.campaignId).enemies[0].health, "near death");
});

await test("Time passes between fights: a knocked-out foe comes to with 1 hit point after its 1d4 hours, and a long rest makes it whole", async () => {
  const [raider] = await stage(1);
  await knockOut(raider, 2);
  later(2);
  const [woke] = await aiBegin([{ monster: "goblin", returning: raider.id }]);
  assert.equal(woke.currentHp, 1);
  assert.equal(isKnockedOut(woke), false);
  assert.equal(woke.conditions.includes("unconscious"), false);
  await kit.endFight();
  later(8);
  // Any id in the creature's chain finds it as it is now.
  const [rested] = await aiBegin([{ monster: "goblin", returning: raider.id }]);
  assert.equal(rested.carriedFrom, woke.id);
  assert.equal(rested.currentHp, rested.maxHp);
});

await test("A foe who died in an earlier fight is refused, and no fight is made", async () => {
  const [raider] = await stage(1);
  kit.setEnemy(raider.id, { currentHp: 3 });
  const swing = await kit.swing(fighter.id, raider.id, [15, 6], { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(encounters.getEnemy(raider.id).status, "dead");
  const out = await ai("start_encounter", { enemies: [{ monster: "goblin", returning: raider.id }] });
  assert.equal(out.ok, false);
  assert.equal(out.refused, "rules");
  assert.match(out.error, /died in an earlier fight/);
  assert.equal(world.encounter(), null);
  const unknown = await ai("start_encounter", { enemies: [{ monster: "goblin", returning: "no-such-enemy" }] });
  assert.equal(unknown.retry, true);
  assert.match(unknown.error, /Unknown returning/);
});

await test("A survivor named alone as the tracker showed them comes back; the monster's own name, or a count, is a fresh creature", async () => {
  await kit.endFight();
  const [one, two] = await aiBegin([{ monster: "goblin", name: "Raider", count: 2 }]);
  assert.deepEqual([one.displayName, two.displayName], ["Raider 1", "Raider 2"]);
  kit.setEnemy(two.id, { currentHp: 2 });
  await world.invoke("end_encounter", { outcome: "truce" });
  const [back] = await aiBegin([{ monster: "goblin", name: "Raider 2" }]);
  assert.equal(back.carriedFrom, two.id);
  assert.equal(back.displayName, "Raider 2");
  assert.equal(back.currentHp, 2);
  await world.invoke("end_encounter", { outcome: "truce" });
  // The console's typed line names a survivor the same way.
  await world.invoke("end_encounter", { outcome: "truce" });
  const [typed] = await begin([{ monster: "Raider 2" }]);
  assert.equal(typed.carriedFrom, back.id);
  await world.invoke("end_encounter", { outcome: "truce" });
  const [goblin] = await begin([{ monster: "goblin" }]);
  assert.equal(goblin.carriedFrom, undefined);
  // GAME STATE names who is still about, with the id; a day later nobody.
  await kit.endFight();
  assert.match(foesAboutBlock(world.campaign(), false), new RegExp(`Goblin \\[enemyId=${goblin.id}\\]`));
  later(25);
  assert.equal(foesAboutBlock(world.campaign(), false), "");
});

await test("Reinforcements: one back from an earlier fight carries its state, one fled from this fight takes the field on its own row, one standing here is refused", async () => {
  const [earlier] = await stage(1);
  kit.setEnemy(earlier.id, { currentHp: 7 });
  await world.invoke("end_encounter", { outcome: "truce" });
  const [a, b] = await stage(2);
  const fled = await world.invoke("enemy_flees", { enemyId: b.id });
  assert.equal(fled.ok, true, fled.error);
  const rejoin = await ai("add_enemies", { enemies: [{ monster: "goblin", returning: b.id }] });
  assert.equal(rejoin.ok, true, rejoin.error);
  assert.equal(encounters.getEnemy(b.id).status, "alive");
  assert.equal(world.enemies().length, 2, "no second row under the same name");
  const twice = await ai("add_enemies", { enemies: [{ monster: "goblin", returning: a.id }] });
  assert.equal(twice.retry, true);
  assert.match(twice.error, /already in this fight/);
  const back = await ai("add_enemies", { enemies: [{ monster: "goblin", returning: earlier.id }] });
  assert.equal(back.ok, true, back.error);
  const row = world.enemies().find((enemy) => enemy.carriedFrom === earlier.id);
  assert.equal(row.currentHp, 7);
  assert.match(back.result.added[0].returning, /as the last fight left them/);
  // A prepared fight's rename keeps the damage a creature carries.
  assert.equal(encounters.patchEnemyIdentity(row.id, { displayName: "Snik" }).currentHp, 7);
});

await test("A foe lying knocked out cannot flee, and when the last one standing runs the fight ends with the knocked out still lying there", async () => {
  const [down, runner] = await stage(2);
  await knockOut(down);
  const refused = await world.invoke("enemy_flees", { enemyId: down.id });
  assert.equal(refused.refused, "rules");
  const ran = await world.invoke("enemy_flees", { enemyId: runner.id });
  assert.equal(ran.ok, true, ran.error);
  assert.equal(world.encounter(), null, "a knocked-out foe held the fight open");
  assert.equal(encounters.getEnemy(down.id).status, "alive");
  assert.equal(isKnockedOut(encounters.getEnemy(down.id)), true);
});

await test("A fight the lead calls off leaves a knocked-out foe lying there, and stamps when it ended", async () => {
  const [down, standing] = await stage(2);
  await knockOut(down);
  const route = await world.route("campaigns/[campaignId]/encounter");
  world.signIn(world.owner);
  const aborted = await call(route, "DELETE", undefined, { campaignId: world.campaignId });
  assert.equal(aborted.status, 200, JSON.stringify(aborted.json));
  assert.equal(world.encounter(), null);
  assert.equal(encounters.getEnemy(down.id).status, "alive", "the knocked-out foe was marked fled");
  assert.equal(encounters.getEnemy(standing.id).status, "fled");
  assert.equal(encounters.getEncounter(down.encounterId).endedInstant, clock.getClock(world.campaignId).instant);
});

await test("A fight ended with no outcome named, its foes dead or knocked out, is a victory", async () => {
  const [down, dead] = await stage(2);
  await knockOut(down);
  encounters.patchEnemyHp(dead.id, 0, "dead");
  const out = await world.invoke("end_encounter", {});
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.outcome, "victory");
  assert.equal(encounters.getEnemy(down.id).status, "alive", "the beaten foe was marked fled");
});

await test("A knocked-out foe that regains a hit point comes to", async () => {
  const [down] = await stage(2);
  await knockOut(down);
  encounters.patchEnemyHp(down.id, 4, "alive");
  const after = encounters.getEnemy(down.id);
  assert.equal(after.conditions.includes("unconscious"), false);
  assert.equal(after.conditions.includes("prone"), true, "it stays prone until it stands");
});

await test("A legendary foe brought in as a reinforcement has its pools, and keeps the resistances it spent until it rests", async () => {
  const legendary = [
    "Legendary Resistance (3/Day). If it fails a saving throw, it can choose to succeed instead.",
    "The goblin can take 3 legendary actions, choosing from the options below.",
    "Legendary action: Detect. The goblin makes a Wisdom (Perception) check.",
  ];
  const [boss] = await stage(1);
  kit.setEnemy(boss.id, { stats: { traits: legendary } });
  const encounter = world.encounter();
  encounters.saveEncounter({ ...encounter, legendary: { ...encounter.legendary, pools: { [boss.id]: { actions: 3, resistances: 1 } } } });
  await world.invoke("end_encounter", { outcome: "truce" });
  await stage(1);
  const added = await ai("add_enemies", { enemies: [{ monster: "goblin", returning: boss.id }] });
  assert.equal(added.ok, true, added.error);
  const row = world.enemies().find((enemy) => enemy.carriedFrom === boss.id);
  assert.deepEqual(world.encounter().legendary.pools[row.id], { actions: 3, resistances: 1 });
  await kit.endFight();
  later(9);
  const [rested] = await aiBegin([{ monster: "goblin", returning: boss.id }]);
  assert.equal(world.encounter().legendary.pools[rested.id].resistances, 3, "a long rest gives them back");
});

await test("A Cast NPC fights as one person whatever the count, and comes back from their last fight as it left them, or not at all once dead", async () => {
  const brute = createHomebrewMonster(world.owner.id, draftFromCr("Dockside Brute", 0.25), "");
  const draft = normalizeNpcDraft({ name: "Snik", attitude: "hostile", statBlock: `homebrew:${brute.id}` });
  assert.ok("draft" in draft, draft.error);
  const npc = createNpcFromDraft(world.campaignId, draft.draft);
  const first = await begin([{ monster: "Snik", count: 2 }]);
  assert.equal(first.length, 1, "two of one person");
  assert.equal(first[0].npcId, npc.id);
  kit.setEnemy(first[0].id, { currentHp: 2 });
  await world.invoke("end_encounter", { outcome: "truce" });
  later(25);
  // A day on: the name rule is spent, but Snik is still Snik.
  const [again] = await begin([{ monster: "Snik" }]);
  assert.equal(again.carriedFrom, first[0].id);
  assert.equal(again.currentHp, again.maxHp, "a day is a long rest");
  encounters.patchEnemyHp(again.id, 0, "dead");
  await world.invoke("end_encounter", { outcome: "victory" });
  const out = await world.invoke("start_encounter", { enemies: [{ monster: "Snik" }] });
  assert.equal(out.refused, "rules");
  assert.match(out.error, /Snik died/);
});

finish();
