// A player's character dominated by the other side (issue 503, Phase 6): an
// enemy's Dominate Person takes it, and until the charm ends the DM plays it
// (src/lib/dm/companion-command.ts dominatedByFoe).
//
//   - the table is told, the floor on its turn is nobody's at the table, the
//     DM is woken to play it and the AI's turn may spend it unasked;
//   - its player's moves and End Turn are refused with the reason;
//   - the charm's end gives it back: its player holds its turn again.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { closeTables, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-combat-sides-dominate");
const { sideOf } = await import("../src/lib/dm/combatant.ts");
const command = await import("../src/lib/dm/companion-command.ts");
const { endTurnRefusal, initiativeFloorFor } = await import("../src/lib/dm/encounter-tools.ts");
const { characterAwaitingPlayer } = await import("../src/lib/dm/player-word.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const encounters = await import("../src/lib/db/encounters.ts");

const DOMINATOR = {
  spells: ["Dominate Person"],
  spellcasting: { dc: 20, ability: "int", casterLevel: 9, spells: [{ name: "Dominate Person", level: 5 }], slots: { 5: 2 } },
};

await test("An enemy's Dominate Person on a player's character: the table is told, the DM plays it, its player is refused with the reason, and the charm's end gives it back", async () => {
  const { world, sheets: [, victim], enemies: [foe] } = await table([FIGHTER, { ...FIGHTER, name: "Brin" }], 1, DOMINATOR);
  // Its WIS save: a 1 against DC 20.
  world.dice(1);
  const cast = await world.invoke("cast_at_player", { characterId: victim.id, casterEnemyId: foe.id, spell: "Dominate Person", saveAbility: "wis", dc: 20 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.equal(sideOf(world.encounter(), "sheet", victim.id), "foe", "it fights for its dominator");
  const told = listRecentMessages(world.campaignId, 10).some((message) => /Brin is dominated: the DM plays Brin until the charm ends/.test(message.content));
  assert.ok(told, "the table, its player among them, is told");

  // Its turn: the floor is nobody's at the table, and the DM plays it.
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => entry.kind === "pc" && entry.characterId === victim.id);
  encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null });
  const entry = world.encounter().order[place];
  assert.equal(command.turnUserId(world.campaign(), entry), command.DOMINATED_TURN);
  assert.equal(command.dmPlaysTurn(world.campaign(), entry), true);
  assert.deepEqual(initiativeFloorFor(world.campaignId).userIds, [command.DOMINATED_TURN]);
  assert.equal(characterAwaitingPlayer(world.campaignId), null, "the AI may play it without its player's word");
  assert.match(endTurnRefusal(world.campaignId, victim.userId), /Brin is dominated/);

  // Its player's move is refused with the reason.
  const route = await world.route("campaigns/[campaignId]/actions");
  world.signIn({ id: victim.userId });
  const refused = await route.POST(
    new Request("http://odm.test/actions", { method: "POST", body: JSON.stringify({ content: "I attack the enchanter.", kind: "do" }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.match(body.error, /Brin is dominated: the DM plays Brin until the charm ends/);
  assert.equal(body.dominated, true);

  // The charm ends: Brin is the player's again.
  const freed = await world.invoke("clear_condition", { characterId: victim.id, condition: "charmed" });
  assert.equal(freed.ok, true, freed.error);
  assert.equal(sideOf(world.encounter(), "sheet", victim.id), "party");
  assert.equal(command.turnUserId(world.campaign(), entry), victim.userId);
  assert.equal(command.dmPlaysTurn(world.campaign(), entry), false);
  assert.equal(command.dominatedRefusal(world.campaignId, world.sheet(victim.id)), null);
});

await test("A companion or a character charmed by something other than a Dominate spell is not taken from its player", async () => {
  const { world, sheets: [, victim], enemies: [foe] } = await table([FIGHTER, { ...FIGHTER, name: "Brin" }], 1);
  world.patch(victim.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: foe.id, spell: "Charm Person" } } });
  assert.equal(command.dominatedByFoe(world.campaignId, world.sheet(victim.id)), false);
  const entry = world.encounter().order.find((item) => item.kind === "pc" && item.characterId === victim.id);
  assert.equal(command.turnUserId(world.campaign(), entry), victim.userId);
});

closeTables();
finish();
