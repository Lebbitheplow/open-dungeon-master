// The DM's hand: a monster's turn as cards (issue #108). What the DM
// projection says an enemy can do (src/lib/dm/enemy-actions-view.ts), the
// cards derived from it (src/lib/battlemap/monster-hand.ts), and the console
// call a played card makes. Every number comes off the same stat block the
// engine rolls from, so a card never promises what enemy_attack refuses.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { enemyActionsView } = await import("../src/lib/dm/enemy-actions-view.ts");
const { deriveMonsterHand, monsterInvoke, monsterSentence, swingsLine, takesManyTargets } = await import(
  "../src/lib/battlemap/monster-hand.ts"
);
const { previewRows } = await import("../src/lib/battlemap/hand-play.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const bite = { name: "Bite", toHit: 5, damage: "1d6+3", type: "piercing", mode: "melee", reach: 5 };
const claw = { name: "Claw", toHit: 5, damage: "1d4+3", type: "slashing", mode: "melee", reach: 5 };
const spit = { name: "Acid Spit", toHit: 4, damage: "2d6", type: "acid", mode: "ranged", range: { normal: 30, long: 90 } };

function enemy(overrides = {}) {
  return {
    id: "e1",
    encounterId: "enc",
    campaignId: "c1",
    slug: "drake",
    displayName: "Drake",
    maxHp: 30,
    currentHp: 30,
    ac: 14,
    initiative: 12,
    status: "alive",
    cr: 2,
    xp: 450,
    conditions: [],
    conditionMeta: {},
    concentration: null,
    stats: {
      type: "dragon",
      speed: "40 ft.",
      dexMod: 1,
      attacks: [bite, claw, spit],
      traits: ["Keen Smell: advantage on Wisdom (Perception) checks that rely on smell."],
      specials: [
        { name: "Fire Breath", recharge: 5, save: "dex", dc: 12, damage: "4d6", damageType: "fire", halfOnSave: true },
        { name: "Frightful Presence", save: "wis", dc: 12, condition: "frightened", rounds: 10, repeatSave: true },
        { name: "Tail Sweep", legendaryCost: 1, save: "str", dc: 12, condition: "prone" },
      ],
      attacksPerTurn: 3,
      routines: [[{ attack: "Bite", count: 1 }, { attack: "Claw", count: 2 }]],
      resist: "",
      immune: "",
      vulnerable: "",
      conditionImmune: "",
      cr: 2,
      xp: 450,
    },
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function encounter(overrides = {}) {
  return {
    orderReady: true,
    order: [
      { kind: "pc", characterId: "s1", userId: "u1", name: "Kael", initiative: 15 },
      { kind: "enemy", enemyId: "e1", name: "Drake", initiative: 12 },
    ],
    turnIndex: 0,
    round: 1,
    surprisedIds: [],
    kind: "fight",
    status: "active",
    legendary: { pools: {}, lair: false, lairUsedRound: 0 },
    ...overrides,
  };
}

test("the projection lists every attack with the swings one call makes, and the save abilities with their numbers", () => {
  const view = enemyActionsView(encounter(), enemy());
  assert.deepEqual(
    view.attacks.map((attack) => [attack.name, attack.range, attack.melee, attack.swings]),
    [
      ["Bite", "5 ft", true, ["Bite", "Claw", "Claw"]],
      ["Claw", "5 ft", true, ["Bite", "Claw", "Claw"]],
      // Not in the routine: one swing of it.
      ["Acid Spit", "30/90 ft", false, ["Acid Spit"]],
    ],
  );
  assert.deepEqual(
    view.abilities.map((ability) => [ability.name, ability.save, ability.dc, ability.resource, ability.refusal]),
    [
      ["Fire Breath", "dex", 12, "Recharge 5-6", null],
      ["Frightful Presence", "wis", 12, "", null],
    ],
  );
  assert.equal(view.refusal, null);
  assert.equal(view.acted, false);
  assert.equal(view.speed, "40 ft.");
});

test("a spent recharge ability says so, and an enemy that has acted is refused by the engine's own sentence", () => {
  const view = enemyActionsView(
    encounter({ legendary: { pools: {}, lair: false, lairUsedRound: 0, abilities: { e1: { spent: ["fire breath"] } }, acted: { round: 1, ids: ["e1"] } } }),
    enemy(),
  );
  assert.match(view.abilities[0].refusal, /has not recharged/);
  assert.equal(view.abilities[1].refusal, null);
  assert.match(view.refusal, /already taken its action this round/);
  assert.equal(view.acted, true);
});

test("a block with no attack lines gets the synthesized ones, as enemy_attack does", () => {
  const view = enemyActionsView(encounter(), enemy({ stats: { ...enemy().stats, attacks: [], routines: undefined, attacksPerTurn: 1, specials: [] } }));
  assert.ok(view.attacks.length >= 1);
  assert.ok(view.attacks[0].toHit > 0);
  assert.deepEqual(view.abilities, []);
});

test("an incapacitated enemy's cards are held with the reason", () => {
  const view = enemyActionsView(encounter(), enemy({ conditions: ["paralyzed"] }));
  assert.match(view.refusal, /paralyzed/);
});

const drake = { id: "e1", name: "Drake", status: "alive", conditions: [], actions: enemyActionsView(encounter(), enemy()) };

test("the hand holds one card per attack, one per ability, and Flee, with the engine's numbers on them", () => {
  const cards = deriveMonsterHand(drake);
  assert.deepEqual(
    cards.map((card) => card.name),
    ["Bite", "Claw", "Acid Spit", "Fire Breath", "Frightful Presence", "Flee"],
  );
  const biteCard = cards[0];
  assert.equal(biteCard.type, "attack");
  assert.equal(biteCard.dice, "1d6+3 piercing");
  assert.equal(biteCard.roll, "+5 to hit");
  assert.equal(biteCard.toHit, 5);
  assert.equal(biteCard.melee, true);
  assert.match(biteCard.rules, /Multiattack: 1 Bite, 2 Claw/);
  assert.equal(biteCard.disabled, null);
  assert.deepEqual(biteCard.intent, { card: "monster", enemyId: "e1", action: "attack", attackName: "Bite" });
  const breath = cards[3];
  assert.equal(breath.type, "spell");
  assert.equal(breath.dice, "4d6 fire");
  assert.equal(breath.roll, "DEX save DC 12");
  assert.deepEqual(breath.save, { ability: "DEX", dc: 12 });
  assert.equal(breath.resource, "Recharge 5-6");
  assert.ok(takesManyTargets(breath));
  const fear = cards[4];
  assert.equal(fear.type, "control");
  assert.equal(fear.dice, "frightened");
  assert.equal(fear.condition, "frightened");
  assert.match(fear.rules, /Lasts 10 rounds/);
  const flee = cards[5];
  assert.equal(flee.type, "basic");
  assert.equal(flee.target, "none");
  assert.equal(flee.cost, "free");
});

test("a card that cannot be played says why: the ability's reason first, then the turn's", () => {
  const spent = enemyActionsView(
    encounter({ legendary: { pools: {}, lair: false, lairUsedRound: 0, abilities: { e1: { spent: ["fire breath"] } }, acted: { round: 1, ids: ["e1"] } } }),
    enemy(),
  );
  const cards = deriveMonsterHand({ ...drake, actions: spent });
  assert.match(cards[0].disabled, /already taken its action/);
  assert.equal(cards[0].spent, true);
  assert.match(cards[3].disabled, /has not recharged/);
  assert.match(cards[4].disabled, /already taken its action/);
  // Breaking off is never an action the round refuses.
  assert.equal(cards[5].disabled, null);
});

test("an enemy the projection carries no actions for has no cards (a player's view)", () => {
  assert.deepEqual(deriveMonsterHand({ id: "e1", name: "Drake", status: "alive", conditions: [] }), []);
});

test("the preview works a bite against the party's real armour class", () => {
  const [biteCard] = deriveMonsterHand(drake);
  const rows = previewRows(biteCard, { id: "s1", name: "Kael", kind: "enemy", ac: 16, conditions: [] }, []);
  const toHit = rows.find((row) => row.key === "To hit");
  assert.match(toHit.value, /\+5 vs AC 16 · 50%/);
});

test("a played attack is the console's enemy_attack, with the advantage asked for", () => {
  const [biteCard] = deriveMonsterHand(drake);
  assert.deepEqual(monsterInvoke(biteCard, ["s1"]), {
    name: "enemy_attack",
    args: { enemyId: "e1", targetCharacterId: "s1", attack: "Bite" },
  });
  assert.deepEqual(monsterInvoke(biteCard, ["s1"], "advantage").args.advantage, "advantage");
  assert.equal(monsterInvoke(biteCard, []), null);
  assert.equal(monsterSentence("Drake", biteCard, ["Kael"]), "Drake attacks Kael with its Bite.");
});

test("an ability on one target is cast_at_player; on several it is one aoe_damage call", () => {
  const cards = deriveMonsterHand(drake);
  const breath = cards[3];
  assert.deepEqual(monsterInvoke(breath, ["s1"]), {
    name: "cast_at_player",
    args: { characterId: "s1", casterEnemyId: "e1", ability: "Fire Breath", saveAbility: "dex", dc: 12, damage: "4d6", halfOnSave: true, damageType: "fire" },
  });
  assert.deepEqual(monsterInvoke(breath, ["s1", "s2"]), {
    name: "aoe_damage",
    args: { casterEnemyId: "e1", ability: "Fire Breath", characterIds: ["s1", "s2"], saveAbility: "dex", dc: 12, damage: "4d6", halfOnSave: true, type: "fire" },
  });
  const fear = cards[4];
  assert.deepEqual(monsterInvoke(fear, ["s1"]).args, {
    characterId: "s1", casterEnemyId: "e1", ability: "Frightful Presence", saveAbility: "wis", dc: 12, condition: "frightened", rounds: 10,
  });
  assert.equal(monsterSentence("Drake", breath, ["Kael", "Lys", "Bran"]), "Drake uses Fire Breath on Kael, Lys and Bran.");
});

test("Flee is enemy_flees and needs no target", () => {
  const cards = deriveMonsterHand(drake);
  assert.deepEqual(monsterInvoke(cards[5], []), { name: "enemy_flees", args: { enemyId: "e1", reason: "Breaks off and runs." } });
  assert.equal(monsterSentence("Drake", cards[5], []), "Drake breaks off and flees.");
});

test("the multiattack line counts the swings", () => {
  assert.equal(swingsLine(["Bite"]), "");
  assert.equal(swingsLine(["Claw", "Claw", "Bite"]), "Multiattack: 2 Claw, 1 Bite. One card plays the whole routine.");
});

console.log(`\n${passed} monster hand checks passed`);
