// A spell the story cast with no tool behind it gets cast, instead of the
// guard writing it out of the story (issue 570). The guard used to send
// every such cast back for a rewrite with no tool, so a spell the player had
// asked for quietly vanished. Now one its caster's player asked for is cast:
// the turn sends the model back to the spell's tool once, and a cast still
// unpaid at the end of the turn is cast by the server itself when the
// player's words fix the call (src/lib/dm/slotless-cast-logic.ts,
// src/lib/dm/turn.ts castSlotlessFor). One the player never asked for is
// still written out: the model never acts for a player.
//
// Pure checks of the logic, then whole DM turns against the scripted fake
// model (scripts/lib/enforce-narrator.mjs), the claims reader answering what
// a reader would read in the prose.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED, combatKit } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-slotless-cast");
const logic = await import("../src/lib/dm/slotless-cast-logic.ts");

// ---- the logic ----

await test("A spell counts as asked for when the player's words or card name it, and the one creature their words name is its target.", () => {
  const lines = [{ content: "I cast Bless on Kara and keep my shield up." }];
  assert.equal(logic.castDeclared("Bless", lines), true);
  assert.equal(logic.castDeclared("Shield of Faith", lines), false);
  assert.equal(logic.castDeclared("Hold Person", [{ content: "Go!", intent: { card: "spell", spell: "Hold Person" } }]), true);
  assert.equal(logic.castCarded("Hold Person", [{ content: "Go!", intent: { card: "spell", spell: "Hold Person" } }]), true);
  const kara = { id: "k", name: "Kara", kind: "ally" };
  const rook = { id: "r", name: "Rook", kind: "ally" };
  assert.deepEqual(logic.namedCreature(lines, [kara, rook]), kara);
  assert.equal(logic.namedCreature([{ content: "I cast Bless on Kara and Rook." }], [kara, rook]), null, "two named: the server does not guess which");
});

await test("The call casts what the words fix: a utility spell spends its slot, a buff on its caster casts, a spell at a creature needs that creature, an area is the model's.", () => {
  const goblin = { id: "g1", name: "Goblin", kind: "enemy" };
  assert.deepEqual(logic.slotlessCastCall({ resolution: "utility" }, "s1", "Detect Magic", null, false), { name: "use_spell_slot", args: { characterId: "s1", spell: "Detect Magic" } });
  assert.deepEqual(logic.slotlessCastCall({ resolution: "buff", buff: { condition: "shielded", target: "self", rounds: 1 } }, "s1", "Shield", null, false).name, "cast_buff");
  assert.equal(logic.slotlessCastCall({ resolution: "save" }, "s1", "Hold Person", null, false), null, "no creature named");
  assert.deepEqual(logic.slotlessCastCall({ resolution: "save" }, "s1", "Hold Person", goblin, false), { name: "cast_at_enemy", args: { characterId: "s1", targetEnemyId: "g1", spell: "Hold Person" } });
  assert.equal(logic.slotlessCastCall({ resolution: "save", area: true }, "s1", "Fireball", goblin, true), null);
  assert.match(logic.unpaidCastPrompt({ caster: "Sefa", casterId: "s1", spell: "Bless", quote: "a blessing settles" }, "cast_buff"), /Sefa's player asked for it: cast it now with cast_buff for characterId=s1/);
});

// ---- whole turns ----

const world = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: true } });
const model = await fakeModel();
model.pointAt(world);
const kara = world.addHero({ name: "Kara", class: "fighter", level: 3, maxHp: 30, abilities: { str: 16 }, proficiencies: TRAINED });
const sefa = world.addHero({
  name: "Sefa",
  class: "cleric",
  level: 3,
  maxHp: 24,
  abilities: { wis: 16 },
  equipment: [{ name: "Mace", qty: 1, equipped: true }],
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: [], prepared: ["Cure Wounds", "Bless", "Hold Person"], cantrips: ["Sacred Flame"] },
});

const LONG = " The lantern light steadies over the ford, and the rushes stop their whispering as if the river itself listened.";
// Each turn tells it in its own words: a narration that repeats the last
// one word for word is sent back for that alone.
const prose = (n) => `Sefa lifts her holy symbol${" and".repeat(n)} a blessing settles over Kara like warm light.${LONG}`;
const QUOTE = "a blessing settles over Kara like warm light";
const castClaim = { kind: "cast", caster: sefa.id, spell: "Bless", quote: QUOTE };
const asked = () => model.requests.flatMap((request) => request.messages).filter((message) => message.role === "user").map((message) => String(message.content));
const slots = () => world.sheet(sefa.id).spellcasting.slots[1].used;
const fresh = () => world.patch(sefa.id, { spellcasting: { ...world.sheet(sefa.id).spellcasting, slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } } }, conditions: [], conditionMeta: {} });

await test("A spell the player asked for, narrated with nothing behind it, sends the model back once to the spell's tool, and the cast spends its slot.", async () => {
  fresh();
  model.script([
    reply({ text: prose(1) }),
    reply({ calls: [call("cast_buff", { characterId: sefa.id, spell: "Bless", targetCharacterIds: [kara.id] })] }),
    reply({ text: prose(2) }),
  ]);
  model.claims([[castClaim]]);
  await model.turn(world, "I cast Bless on Kara.", sefa.id, sefa.userId);
  assert.ok(asked().some((text) => /no tool cast it this turn/.test(text) && /cast_buff/.test(text)), asked().join("\n---\n").slice(0, 600));
  assert.equal(slots(), 1, "Bless was cast and its slot spent");
});

await test("A cast still unpaid when the turn ends is cast by the server from the player's words, and the story stands with no rewrite.", async () => {
  fresh();
  model.script([reply({ text: prose(3) }), reply({ text: prose(4) }), reply({ text: "unused rewrite" })]);
  model.claims([[castClaim], [castClaim], [castClaim], [castClaim]]);
  const message = await model.turn(world, "I cast Bless on Kara.", sefa.id, sefa.userId);
  assert.equal(slots(), 1, "the server cast Bless and spent the slot");
  assert.ok(!asked().some((text) => /contradicts what the dice and tools actually resolved/.test(text)), "no rewrite: the cast rolled nothing");
  assert.match(message?.content ?? "", /blessing settles over Kara/);
});

await test("A spell the player never asked for is still written out of the story: the model does not act for a player.", async () => {
  fresh();
  model.script([reply({ text: prose(5) }), reply({ text: "Sefa watches the river, her symbol quiet in her hand." + LONG })]);
  model.claims([[castClaim], [castClaim]]);
  await model.turn(world, "I keep watch by the ford.", sefa.id, sefa.userId);
  assert.equal(slots(), 0, "nothing was cast");
  assert.ok(!asked().some((text) => /no tool cast it this turn/.test(text)), "no call back to a tool");
  assert.ok(asked().some((text) => /no spell slot or resource was spent/.test(text)), "the guard wrote it out");
});

await test("A save spell still unpaid at the end is cast at the creature the player named, and the rewrite tells the save the dice rolled.", async () => {
  fresh();
  const kit = await combatKit(world);
  await kit.fight(1);
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 200, currentHp: 200 });
  kit.place(sefa.id, 2, 2);
  kit.place(kara.id, 2, 3);
  kit.place(goblin.id, 5, 2);
  kit.giveTurn(sefa.id);
  const held = `Sefa speaks a word of binding and ${goblin.displayName} locks rigid mid-stride.${LONG}`;
  const quote = `${goblin.displayName} locks rigid mid-stride`;
  const claim = { kind: "cast", caster: sefa.id, spell: "Hold Person", quote };
  model.script([reply({ text: held }), reply({ text: held.replace("binding", "holding") }), reply({ text: `Sefa's word rings out against ${goblin.displayName}, and the dice decide how it holds.${LONG}` })]);
  model.claims([[claim], [claim], [claim], [claim]]);
  await model.turn(world, `I cast Hold Person on ${goblin.displayName}.`, sefa.id, sefa.userId);
  assert.equal(world.sheet(sefa.id).spellcasting.slots[2].used, 1, "Hold Person was cast from a 2nd-level slot");
  assert.ok(asked().some((text) => /has now been cast by the server, as their player asked/.test(text)), "the rewrite was told to narrate the real save");
  await kit.endFight();
});

model.close();
await finish();
