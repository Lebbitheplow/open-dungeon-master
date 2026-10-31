// A casting shared out among creatures, asked in the Hand rather than left
// to the model (issue 570): Magic Missile's darts, Scorching Ray's rays and
// Eldritch Blast's beams by how many each creature takes, the creatures a
// Bless takes. The card says how many the casting holds
// (src/lib/battlemap/hand-spells.ts), the aim bar gives them out
// (hand-play.ts shareList, stepShare), and the message carries them as
// `shares`, which the engine turns into one call each
// (src/lib/dm/intent-logic.ts directCardCalls). Pure: no database.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { composeSentence, intentBody, shareList, stepShare } = await import("../src/lib/battlemap/hand-play.ts");
const { parseMessageIntent, describeIntent, directCardCalls, callMismatch } = await import("../src/lib/dm/intent-logic.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
  passed += 1;
}

function sheet(overrides = {}) {
  return {
    id: "s1", campaignId: "c1", userId: "u1", libraryCharacterId: null,
    name: "Mira", race: "human", class: "wizard", subclass: "", background: "", alignment: "", gender: "",
    level: 5, xp: 0,
    abilities: { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 14 },
    maxHp: 30, currentHp: 30, tempHp: 0, ac: 12, acOverride: false, speed: 30,
    hitDice: { die: "d6", total: 5, spent: 0 }, classes: [], hitDicePools: null,
    proficiencies: { saves: ["int", "wis"], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: ["simple"] },
    equipment: [], gold: 0, copper: 0, feats: [], features: [],
    spellcasting: {
      ability: "int",
      slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
      prepared: ["Magic Missile", "Scorching Ray", "Bless", "Hold Person", "Fire Bolt"],
      known: [],
      cantrips: ["Eldritch Blast", "Fire Bolt"],
    },
    conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [], exhaustion: 0,
    deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
    isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
    ...overrides,
  };
}

const card = (name, overrides) => deriveHand(sheet(overrides), FRESH_TURN).find((entry) => entry.name === name);
const goblin = (n) => ({ id: `g${n}`, name: `Goblin ${n}`, kind: "enemy" });
const ally = (id, name) => ({ id, name, kind: "ally" });

test("a casting that holds several darts, rays, beams or creatures says how many, and one that holds one says nothing", () => {
  assert.deepEqual(card("Magic Missile").shares, { count: 3, unit: "dart", stack: true });
  assert.deepEqual(card("Scorching Ray").shares, { count: 3, unit: "ray", stack: true });
  assert.deepEqual(card("Eldritch Blast").shares, { count: 2, unit: "beam", stack: true }, "two beams at fifth level");
  assert.equal(card("Eldritch Blast", { level: 4 }).shares, undefined, "one beam below fifth");
  assert.deepEqual(card("Bless").shares, { count: 3, unit: "creature", stack: false });
  assert.equal(card("Hold Person").shares, undefined, "one creature from its own slot");
  assert.equal(card("Fire Bolt").shares, undefined);
});

test("the creature aimed at takes every dart until others are given some, and keeps at least one", () => {
  const missile = card("Magic Missile");
  assert.deepEqual(shareList(missile, goblin(1)), [{ id: "g1", name: "Goblin 1", count: 3 }]);
  let others = stepShare(missile, goblin(1), [], goblin(2), 1);
  assert.deepEqual(shareList(missile, goblin(1), { shares: others }), [{ id: "g1", name: "Goblin 1", count: 2 }, { id: "g2", name: "Goblin 2", count: 1 }]);
  others = stepShare(missile, goblin(1), others, goblin(2), 1);
  others = stepShare(missile, goblin(1), others, goblin(3), 1);
  assert.deepEqual(shareList(missile, goblin(1), { shares: others }).map((share) => share.count), [1, 2], "a third press finds no dart left to give");
  others = stepShare(missile, goblin(1), others, goblin(2), -1);
  others = stepShare(missile, goblin(1), others, goblin(3), 1);
  assert.deepEqual(shareList(missile, goblin(1), { shares: others }), [{ id: "g1", name: "Goblin 1", count: 1 }, { id: "g2", name: "Goblin 2", count: 1 }, { id: "g3", name: "Goblin 3", count: 1 }]);
  // Aiming at a creature that had a share folds it back into the aim's.
  assert.deepEqual(shareList(missile, goblin(2), { shares: others }).map((share) => [share.id, share.count]), [["g2", 2], ["g3", 1]]);
});

test("a Bless takes the aimed ally and up to two more, each once", () => {
  const bless = card("Bless");
  const me = { id: "s1", name: "Mira", kind: "self" };
  let others = stepShare(bless, me, [], ally("k", "Kara"), 1);
  others = stepShare(bless, me, others, ally("r", "Rook"), 1);
  assert.equal(stepShare(bless, me, others, ally("t", "Tam"), 1).length, 2, "a fourth creature has no place");
  assert.deepEqual(shareList(bless, me, { shares: others }).map((share) => share.id), ["s1", "k", "r"]);
  others = stepShare(bless, me, others, ally("k", "Kara"), -1);
  assert.deepEqual(shareList(bless, me, { shares: others }).map((share) => share.id), ["s1", "r"]);
});

test("the sentence names each creature with its share, and the message carries the shares for the engine", () => {
  const missile = card("Magic Missile");
  const choices = { shares: [{ id: "g2", name: "Goblin 2", count: 1 }] };
  assert.equal(composeSentence(missile, goblin(1), [], choices), "I cast Magic Missile at Goblin 1 (2 darts) and Goblin 2 (1 dart) using a level 1 slot.");
  const intent = parseMessageIntent(intentBody(missile, goblin(1), [], choices));
  assert.deepEqual(intent.shares, [{ id: "g1", name: "Goblin 1", count: 2 }, { id: "g2", name: "Goblin 2", count: 1 }]);
  assert.match(describeIntent(intent, "s1"), /Goblin 1 \(enemyId=g1, 2\) and Goblin 2 \(enemyId=g2, 1\)/);
  // Every ray at one goblin is still sent as a share, so the engine throws
  // all three instead of one.
  assert.deepEqual(parseMessageIntent(intentBody(card("Scorching Ray"), goblin(1))).shares, [{ id: "g1", name: "Goblin 1", count: 3 }]);
  assert.equal(composeSentence(card("Bless"), ally("k", "Kara"), [], { shares: [{ id: "r", name: "Rook", count: 1 }] }), "I cast Bless on Kara and Rook using a level 1 slot.");
});

test("the engine makes one call per share: darts by count, a call per ray, one Bless for every ally, one area for creatures that stand together", () => {
  const base = { card: "spell", slotLevel: 1, targetKind: "enemy", targetId: "g1", targetName: "Goblin 1" };
  const darts = directCardCalls({ ...base, spell: "Magic Missile", shares: [{ id: "g1", count: 2 }, { id: "g2", count: 1 }] }, "s1", { inFight: true, resolution: "auto", shareKind: "darts" });
  assert.deepEqual(darts.map((call) => [call.name, call.args.targetEnemyId, call.args.darts]), [["cast_at_enemy", "g1", 2], ["cast_at_enemy", "g2", 1]]);
  const rays = directCardCalls({ ...base, spell: "Scorching Ray", slotLevel: 2, shares: [{ id: "g1", count: 2 }, { id: "g2", count: 1 }] }, "s1", { inFight: true, resolution: "attack", shareKind: "attacks" });
  assert.deepEqual(rays.map((call) => call.args.targetEnemyId), ["g1", "g1", "g2"]);
  assert.ok(rays.every((call) => call.name === "pc_attack" && call.args.spell === "Scorching Ray" && call.args.level === 2));
  const bless = directCardCalls({ card: "spell", spell: "Bless", slotLevel: 1, targetKind: "ally", targetId: "k", shares: [{ id: "k", count: 1 }, { id: "r", count: 1 }] }, "s1", { inFight: true, resolution: "buff", shareKind: "targets" });
  assert.deepEqual(bless, [{ name: "cast_buff", args: { characterId: "s1", spell: "Bless", targetCharacterIds: ["k", "r"], level: 1 } }]);
  const splash = directCardCalls({ ...base, spell: "Acid Splash", slotLevel: null, shares: [{ id: "g1", count: 1 }, { id: "g2", count: 1 }] }, "s1", { inFight: true, resolution: "save", shareKind: "targets", cluster: true });
  assert.deepEqual(splash, [{ name: "aoe_damage", args: { casterCharacterId: "s1", spell: "Acid Splash", enemyIds: ["g1", "g2"] } }]);
  // A card from an older Hand, with no shares, is one call as before.
  assert.equal(directCardCalls({ ...base, spell: "Magic Missile" }, "s1", { inFight: true, resolution: "auto", shareKind: "darts" }).length, 1);
});

test("a model call at any creature the card shared its casting with answers it", () => {
  const intent = { card: "spell", spell: "Magic Missile", slotLevel: 1, targetKind: "enemy", targetId: "g1", targetName: "Goblin 1", shares: [{ id: "g1", count: 2 }, { id: "g2", name: "Goblin 2", count: 1 }] };
  const played = { intent, characterId: "s1", name: "Mira", resolution: "auto" };
  assert.equal(callMismatch(played, { name: "cast_at_enemy", args: { characterId: "s1", targetEnemyId: "g2", spell: "Magic Missile" }, result: { ok: true } }), null);
  assert.equal(callMismatch(played, { name: "cast_at_enemy", args: { characterId: "s1", targetEnemyId: "g9", spell: "Magic Missile" }, result: { ok: true } }), "target");
});

console.log(`hand-shares: ${passed} tests passed`);
