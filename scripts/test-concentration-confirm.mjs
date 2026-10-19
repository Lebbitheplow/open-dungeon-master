// A cast that would end a running concentration spell is asked about before
// anything is posted (issue 252): the Hand's cards and typed actions alike,
// a no spends nothing, and a yes answers only the cast it was given for.
// The spell tiles mark concentration spells.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { settleQueue } from "./lib/enforce-narrator.mjs";
import { confirmsSwap, spellsNamedIn, swapQuestion } from "../src/lib/dm/concentration-confirm-logic.ts";

const { test, finish } = suite("test-concentration-confirm");

await test("A typed action's spells are found by whole name, in the order it names them.", () => {
  const spells = ["Bless", "Spirit Guardians", "Hold Person", "Cure Wounds"];
  assert.deepEqual(spellsNamedIn("I cast Bless on Brann and Tavi", spells), ["Bless"]);
  assert.deepEqual(spellsNamedIn("Blessing the water, I pray", spells), [], "Bless is not inside Blessing");
  assert.deepEqual(spellsNamedIn("hold person on the guard, then bless", spells), ["Hold Person", "Bless"]);
});

await test("A yes answers only the same character, running spell and new spell.", () => {
  const swap = { characterId: "c1", current: "Spirit Guardians", next: "Bless" };
  assert.equal(confirmsSwap(swap, { ...swap }), true);
  assert.equal(confirmsSwap(swap, { ...swap, current: "spirit guardians", next: "BLESS" }), true);
  assert.equal(confirmsSwap(swap, { ...swap, current: "Hold Person" }), false, "the running spell changed");
  assert.equal(confirmsSwap(swap, { ...swap, next: "Hold Person" }), false, "another spell");
  assert.equal(confirmsSwap(swap, { ...swap, characterId: "c2" }), false, "another caster");
  assert.equal(confirmsSwap(swap, null), false);
  assert.match(swapQuestion(swap, "Sister Ama"), /Casting Bless will end Sister Ama's concentration on Spirit Guardians\. Replace Spirit Guardians\?/);
});

const world = await openWorld();
const actions = await world.route("campaigns/[campaignId]/actions");
const cleric = world.addHero({
  name: "Sister Ama",
  class: "cleric",
  level: 5,
  spellcasting: {
    ability: "wis",
    slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
    prepared: ["Bless", "Spirit Guardians", "Hold Person", "Cure Wounds"],
    known: [],
    cantrips: ["Sacred Flame"],
  },
});
const { countMessages } = await import("../src/lib/db/messages.ts");
const { getFloor } = await import("../src/lib/db/campaigns.ts");

async function act(body) {
  world.signIn(world.owner);
  const response = await actions.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "do", characterId: cleric.id, ...body }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}

await test("With nothing held, a concentration cast is posted at once.", async () => {
  const sent = await act({ content: "I cast Bless on the party." });
  assert.equal(sent.status, 202, sent.json.error);
  // The DM turn it queued ends here, so its message is never counted below.
  await settleQueue(world.campaignId);
});

world.patch(cleric.id, { concentratingOn: "Spirit Guardians" });

await test("A typed cast that would end Spirit Guardians is asked about, and nothing is posted.", async () => {
  const before = countMessages(world.campaignId);
  const floor = JSON.stringify(getFloor(world.campaignId));
  const asked = await act({ content: "I cast Bless on Brann and Tavi." });
  assert.equal(asked.status, 409);
  assert.deepEqual(
    { characterId: asked.json.confirmConcentration.characterId, current: asked.json.confirmConcentration.current, next: asked.json.confirmConcentration.next },
    { characterId: cleric.id, current: "Spirit Guardians", next: "Bless" },
  );
  assert.match(asked.json.error, /Replace Spirit Guardians\?/);
  assert.equal(countMessages(world.campaignId), before, "the action was posted before the answer");
  assert.equal(JSON.stringify(getFloor(world.campaignId)), floor, "the floor moved before the answer");
  assert.equal(world.sheet(cleric.id).concentratingOn, "Spirit Guardians", "the running spell ended on a question");
});

await test("A yes for exactly that cast posts it; an old yes for another state does not.", async () => {
  const before = countMessages(world.campaignId);
  const ack = { characterId: cleric.id, current: "Spirit Guardians", next: "Bless" };
  const stale = await act({ content: "I cast Hold Person on the guard.", concentrationAck: ack });
  assert.equal(stale.status, 409, "a yes for Bless authorised Hold Person");
  assert.equal(stale.json.confirmConcentration.next, "Hold Person");
  const posted = await act({ content: "I cast Bless on Brann and Tavi.", concentrationAck: ack });
  assert.equal(posted.status, 202, posted.json.error);
  assert.equal(countMessages(world.campaignId), before + 1);
  world.patch(cleric.id, { concentratingOn: "Hold Person" });
  const changed = await act({ content: "I cast Bless on Brann and Tavi.", concentrationAck: ack });
  assert.equal(changed.status, 409, "the running spell changed since the yes");
  assert.equal(changed.json.confirmConcentration.current, "Hold Person");
  world.patch(cleric.id, { concentratingOn: "Spirit Guardians" });
});

await test("A drop the action already says is asked about too, the same in every language.", async () => {
  for (const content of [
    "I drop Spirit Guardians and cast Bless on the party.",
    "Lascio cadere Spirit Guardians e lancio Bless sul gruppo.",
    "Je laisse tomber Spirit Guardians et lance Bless sur le groupe.",
    "Dejo caer Spirit Guardians y lanzo Bless sobre el grupo.",
    "Ich lasse Spirit Guardians fallen und wirke Bless auf die Gruppe.",
  ]) {
    const asked = await act({ content });
    assert.equal(asked.status, 409, content);
    assert.equal(asked.json.confirmConcentration.next, "Bless", content);
  }
});

await test("A card cast is asked about the same way.", async () => {
  const asked = await act({ content: "Sister Ama casts Bless.", intent: { card: "spell", spell: "Bless", slotLevel: 1 } });
  if (asked.status === 409 && !asked.json.confirmConcentration) {
    // The card's own legality is the engine's (intent-check.ts); this test
    // reads only the concentration question.
    assert.fail(`the card was refused for another reason: ${asked.json.error}`);
  }
  assert.equal(asked.status, 409);
  assert.equal(asked.json.confirmConcentration.next, "Bless");
});

await test("No question for a cast without concentration or the spell already held.", async () => {
  assert.equal((await act({ content: "I cast Cure Wounds on Brann." })).status, 202);
  assert.equal((await act({ content: "I keep my Spirit Guardians spinning around me." })).status, 202);
  assert.equal((await act({ content: "Bless us all, I whisper.", kind: "say" })).status, 202, "speech casts nothing");
});

const { tileConcentrates } = await import("../src/components/sheet/SpellBook.tsx");

await test("The spell tiles mark concentration from the row, a homebrew flag, or the bundled facts.", () => {
  assert.equal(tileConcentrates({ name: "Anything", data: { concentration: "yes" } }), true);
  assert.equal(tileConcentrates({ name: "Anything", data: { concentration: "no" } }), false);
  assert.equal(tileConcentrates({ name: "Ember Ward", data: { concentration: true } }), true, "a homebrew spell's flag");
  assert.equal(tileConcentrates({ name: "Bless" }), true);
  assert.equal(tileConcentrates({ name: "Cure Wounds" }), false);
  assert.equal(tileConcentrates({ name: "Bless", concentration: false }), false, "the tile's own word wins");
});

world.close();
finish();
