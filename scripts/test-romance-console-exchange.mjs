// A refused romance step holds for the scene at a table a person runs, as it
// does at an AI table (issue 638). The person's console makes a fresh turn
// for every call, so the one-step-per-exchange guard, keyed on the turn,
// never held there: a refused consent roll could be run again at once until
// the die said yes. The person's exchange ends with their next narration.
// An NPC's first move and an attitude a social check moved stood on the same
// guard, and hold the same way.
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-romance-console-exchange");
const relationships = await import("../src/lib/db/relationships.ts");
const npcs = await import("../src/lib/db/npcs.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { setOpenToAdvances } = await import("../src/lib/db/sheets.ts");
const proposals = await import("../src/lib/db/item-proposals.ts");

// A courting pair a little past the bar for "together", where the answer is
// a real roll: d20 + 0 + warmth 0 against DC 12.
async function courting(name) {
  const world = await openWorld();
  const hero = world.addHero({ name: "Vex", gender: "Female" });
  const set = await world.invoke("set_npc", { name, gender: "Male", location: "Highmoor" });
  assert.equal(set.ok, true, set.error);
  const npc = npcs.getNpcByName(world.campaignId, name);
  npcs.patchNpcAgency(npc.id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 } });
  const row = relationships.ensureRelationship({
    campaignId: world.campaignId,
    characterId: hero.id,
    characterName: hero.name,
    subjectKind: "npc",
    subjectName: name,
  });
  relationships.patchRelationship(row.id, { romance: "courting", approval: 74 });
  const pair = () => relationships.getRelationship(world.campaignId, hero.id, name);
  const ask = { characterId: hero.id, subject: name, to: "together" };
  return { world, hero, pair, ask };
}

await test("at the console a refused ask is held until the GM's next narration, and says so", async () => {
  const { world, pair, ask } = await courting("Ivo");
  world.dice(1);
  const first = await world.invoke("romance_advance", ask);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.result.accepted, false, "the die said no");
  assert.match(first.result.note, /You can ask again after your next narration\./);
  assert.equal(pair().approval, 71);

  // Run the form again straight away: no second roll.
  world.dice(20);
  const again = await world.invoke("romance_advance", ask);
  world.clearDice();
  assert.equal(again.ok, false, "a second ask in the same scene is refused");
  assert.equal(
    again.error,
    "Ivo already answered Vex this scene, so a second ask is refused. Post your next narration to move the scene on; then you can ask again.",
  );
  assert.equal(pair().romance, "courting", "nothing moved");
  assert.equal(pair().approval, 71, "and no second refusal was charged");

  // An out-of-character answer is not narration: the scene has not moved.
  await wait(5);
  world.say("dm", "(ooc) Let's take five.");
  const ooc = await world.invoke("romance_advance", ask);
  assert.equal(ooc.ok, false, "an OOC line does not end the scene");

  // The GM narrates; the next ask is a new exchange and rolls.
  await wait(5);
  world.say("dm", "The evening wears on by the fire.");
  world.dice(20);
  const later = await world.invoke("romance_advance", ask);
  world.clearDice();
  assert.equal(later.ok, true, later.error);
  assert.equal(later.result.accepted, true);
  assert.equal(pair().romance, "together");
});

await test("an AI table keeps its guard on the turn: the same turn is held, the next reply may ask", async () => {
  const { world, pair, ask } = await courting("Hollis");
  const turn = turns.createDmTurn(world.campaignId, [], "ai");
  const asAi = (turnId) => invokeEngine(world.campaign(), { kind: "ai", turnId }, { name: "romance_advance", args: ask });
  world.dice(1);
  const first = await asAi(turn.id);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.result.accepted, false);
  assert.doesNotMatch(first.result.note, /next narration/, "the model reads the note it always read");

  const same = await asAi(turn.id);
  assert.equal(same.ok, false);
  assert.equal(same.error, "Vex and Hollis already took a step this exchange. Let the scene breathe before the next one.");

  const next = turns.createDmTurn(world.campaignId, [], "ai");
  world.dice(20);
  const reply = await asAi(next.id);
  world.clearDice();
  assert.equal(reply.ok, true, reply.error);
  assert.equal(reply.result.accepted, true, "a new AI turn is a new exchange, as before");
  assert.equal(pair().romance, "together");
});

await test("at the console an NPC's first move turned down is not made again until the GM's next narration", async () => {
  const table = await openWorld({ gameSettings: { dmMode: "human" } });
  const player = table.addUser("lio");
  const hero = table.addHero({ user: player, name: "Lio", gender: "Male" });
  const set = await table.invoke("set_npc", { name: "Senna", gender: "Female", drawnTo: ["men"] });
  assert.equal(set.ok, true, set.error);
  const row = relationships.ensureRelationship({ campaignId: table.campaignId, characterId: hero.id, characterName: "Lio", subjectKind: "npc", subjectName: "Senna" });
  relationships.patchRelationship(row.id, { approval: 70 });
  setOpenToAdvances(hero.id, true);
  const move = { characterId: hero.id, subject: "Senna", to: "courting", initiator: "npc", note: "Walk with me?" };
  const offers = () => proposals.listOpenItemProposals(table.campaignId).filter((offer) => offer.toolName === "romance_advance");

  const first = await table.invoke("romance_advance", move);
  assert.equal(first.ok, true, first.error);
  const [offer] = offers();
  assert.ok(offer, "the move waits on Lio's player");
  const answers = await table.route("campaigns/[campaignId]/item-proposals/[proposalId]");
  table.signIn(player);
  const declined = await answers.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ action: "decline" }) }),
    { params: Promise.resolve({ campaignId: table.campaignId, proposalId: offer.id }) },
  );
  assert.equal(declined.status, 200);

  // Run the form again straight away: the moment was spent this scene.
  const again = await table.invoke("romance_advance", move);
  assert.equal(again.ok, false, "a second move in the same scene is refused");
  assert.equal(
    again.error,
    "Lio and Senna already had their moment this scene, so another move is refused. Post your next narration to move the scene on; then Senna can try again.",
  );
  assert.equal(offers().length, 0, "no second offer reached the player");

  // The GM narrates; the scene has moved on and Senna may try again.
  await wait(5);
  table.say("dm", "Days pass in the river town.");
  const later = await table.invoke("romance_advance", move);
  assert.equal(later.ok, true, later.error);
  assert.equal(offers().length, 1);
});

finish();
