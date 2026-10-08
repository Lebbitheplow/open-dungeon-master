// The narration guard (src/lib/dm/engine-boundary.ts), fed with what the
// engine really returned rather than with payloads written by hand: a fight
// is staged, the tools are called with forced dice, and what the prose claims
// is ruled on against those results exactly as a DM turn's conversation
// would carry them. The prose is read by a model in the table's language
// (src/lib/dm/claims.ts); here each narration comes with the claims a reader
// returns for it, so the ruling is pinned without one.
//
// The guard verifies and never enforces: it changes no state, and it is
// biased toward missing a contradiction over firing on flavor. What is pinned
// here is that the four contradictions it promises to catch are caught when
// the ground truth comes from the live engine (docs/rules-coverage.md): a hit
// written on a miss, a death the hit points deny, a damage figure no die
// rolled, a spell nothing paid for.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-narration-guard");
const world = await openWorld();
const kit = await combatKit(world);
const { guardOutcomes, normalizeCreatureName, ruleClaims } = await import("../src/lib/dm/engine-boundary.ts");

const kara = world.addHero({
  name: "Kara", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});
const mira = world.addHero({
  name: "Mira", class: "wizard", level: 5, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: {
    ability: "int", slots: { 1: { max: 4, used: 0 }, 3: { max: 2, used: 0 } },
    prepared: ["Magic Missile", "Fireball"], known: [], cantrips: ["Fire Bolt"],
  },
});

// One assistant message carrying the calls, then one tool result each, the
// shape src/lib/dm/turn.ts gives a turn's conversation.
function conversationOf(exchanges) {
  return [
    { role: "system", content: "system prompt" },
    { role: "user", content: "[Kara | attempt] I swing at the goblin." },
    {
      role: "assistant",
      content: "",
      tool_calls: exchanges.map((entry, index) => ({
        id: `call-${index}`,
        type: "function",
        function: { name: entry.name, arguments: JSON.stringify(entry.args) },
      })),
    },
    ...exchanges.map((entry, index) => ({
      role: "tool",
      tool_call_id: `call-${index}`,
      content: JSON.stringify(entry.result),
    })),
  ];
}

const kinds = (claims, exchanges) =>
  ruleClaims(claims, guardOutcomes(conversationOf(exchanges), null))
    .map((entry) => entry.kind)
    .sort();

// The claims a reader returns for a narration about the fight's goblin.
const goblin = normalizeCreatureName("Goblin 1");
const on = (kind, quote) => ({ kind, target: goblin, quote });

// A resolved player attack, as an exchange.
async function attack(faces) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [mira.id]: 5 } });
  const [enemy] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const args = { characterId: kara.id, targetEnemyId: enemy.id, weapon: "Longsword" };
  const swing = await kit.swing(kara.id, enemy.id, faces, args);
  assert.equal(swing.ok, true, swing.error);
  return { enemy: kit.enemy(enemy.id), exchange: { name: "pc_attack", args, result: swing.result } };
}

await test("a hit written on a miss is caught", async () => {
  const { enemy, exchange } = await attack([2]);
  assert.equal(exchange.result.hit, false);
  assert.equal(enemy.currentHp, enemy.maxHp);
  assert.deepEqual(kinds([on("hit", "Kara's blade bites into the goblin")], [exchange]), ["hit"]);
  assert.deepEqual(kinds([on("miss", "Kara's blade whistles past the goblin.")], [exchange]), []);
});

await test("a miss written on a hit is caught", async () => {
  const { exchange } = await attack([15, 4]);
  assert.equal(exchange.result.hit, true);
  assert.deepEqual(kinds([on("miss", "Kara's swing misses the goblin entirely.")], [exchange]), ["miss"]);
  assert.deepEqual(kinds([on("hit", "Kara's blade bites into the goblin.")], [exchange]), []);
});

await test("a death the hit points deny is caught", async () => {
  const { enemy, exchange } = await attack([15, 4]);
  assert.equal(enemy.status, "alive");
  assert.equal(enemy.currentHp, 40 - 7);
  assert.deepEqual(kinds([on("dies", "The goblin crumples, dead")], [exchange]), ["death"]);
});

await test("a death the engine reported is not a contradiction", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [mira.id]: 5 } });
  const [enemy] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.setEnemy(enemy.id, { currentHp: 3 });
  const args = { characterId: kara.id, targetEnemyId: enemy.id, weapon: "Longsword" };
  const swing = await kit.swing(kara.id, enemy.id, [15, 4], args);
  assert.equal(swing.result.dead, true);
  assert.deepEqual(kinds([on("dies", "The goblin crumples, dead")], [{ name: "pc_attack", args, result: swing.result }]), []);
});

await test("a damage figure no die rolled is caught", async () => {
  const { exchange } = await attack([15, 4]);
  assert.equal(exchange.result.damage, 7);
  const amount = (value) => ({ kind: "amount", value, of: "damage", quote: `The blow lands for ${value} damage.` });
  assert.deepEqual(kinds([amount(12)], [exchange]), ["number"]);
  assert.deepEqual(kinds([amount(7)], [exchange]), []);
});

await test("a spell nothing paid for is caught, and a paid one is not", async () => {
  await kit.endFight();
  const before = world.sheet(mira.id).spellcasting.slots[3].used;
  const fireball = { kind: "cast", caster: "Mira", spell: "fireball", quote: "Mira casts Fireball" };
  assert.deepEqual(kinds([fireball], []), ["spell"]);
  assert.equal(world.sheet(mira.id).spellcasting.slots[3].used, before);
  const args = { characterId: mira.id, level: 3, spell: "Fireball" };
  const spent = await world.invoke("use_spell_slot", args);
  assert.equal(spent.ok, true, spent.error);
  assert.equal(world.sheet(mira.id).spellcasting.slots[3].used, before + 1);
  assert.deepEqual(kinds([fireball], [{ name: "use_spell_slot", args, result: spent.result }]), []);
});

await test("the guard changes no state", async () => {
  const { enemy, exchange } = await attack([2]);
  const sheets = JSON.stringify(world.sheets());
  const encounter = JSON.stringify(world.encounter());
  ruleClaims(
    [on("hit", "Kara's blade bites deep"), on("dies", "the goblin dies"), { kind: "amount", value: 99, of: "damage", quote: "99 damage" }],
    guardOutcomes(conversationOf([exchange]), null),
  );
  assert.equal(JSON.stringify(world.sheets()), sheets);
  assert.equal(JSON.stringify(world.encounter()), encounter);
  assert.equal(kit.enemy(enemy.id).currentHp, enemy.currentHp);
});

await kit.endFight();
world.close();
finish();
