// Spells spent and rests taken, in the order a table plays them: the cleric's
// player casts Cure Wounds through the actions route until the 1st-level
// slots run out, the Hand refuses a card the slots can no longer pay for,
// an upcast spends a 2nd-level slot, a short rest gives back hit dice the
// player chooses and no slots, a long rest gives back every slot, a second
// long rest the same day restores nobody, and a rest in a fight is refused.
//
// The rules have their suites (test-enforce-spell-slots.mjs,
// test-enforce-short-rest.mjs, test-enforce-long-rest.mjs and
// test-enforce-rest-choice.mjs drive the tools and routes one at a time).
// None ran them through a player's moves in sequence, so nothing checked
// that a slot the DM's turn spends is the one the next card is judged on,
// or that a rest the DM's turn takes restores what the turns before spent.
//
// The scripted fake model (scripts/lib/enforce-narrator.mjs), every die
// forced.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-spells-and-rests");

const { dmQueueDepth } = await import("../src/lib/dm/queue.ts");
const { subscribe } = await import("../src/lib/events.ts");

async function settle(campaignId) {
  const end = Date.now() + 30_000;
  while (dmQueueDepth(campaignId) > 0) {
    if (Date.now() > end) {
      throw new Error("the DM queue never ran dry");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// The DM answers each post as it lands: Kara's player has the table open,
// and this suite is about slots and rests, not waiting for the table.
const world = await openWorld({ gameSettings: { ttsEnabled: false, waitForTable: false } });
const model = await fakeModel();
model.pointAt(world);
// Ama: a 3rd-level cleric, Wisdom 18 (+4), four 1st-level slots and two
// 2nd. Kara: a fighter whose player is at the table.
const ama = world.addHero({ ...caster("cleric", "wis", ["Cure Wounds"], [], 3), name: "Ama" });
const kara = world.addHero({ name: "Kara", class: "fighter", level: 3, abilities: { str: 16, dex: 10, con: 14, wis: 10 } });
const amaUser = world.sheet(ama.id).userId;
const karaUser = world.sheet(kara.id).userId;
const karaMax = world.sheet(kara.id).maxHp;
world.say("dm", "The ferry lands you on a cold shore, bruised from the crossing.");
// Kara's player has the table open, so the short rest leaves her hit dice
// to her (test-enforce-rest-choice.mjs).
const leave = subscribe(world.campaignId, () => {}, karaUser);

const slots = (level) => world.sheet(ama.id).spellcasting.slots[String(level)];
const hp = () => world.sheet(kara.id).currentHp;

async function act(userId, content, intent) {
  const route = await world.route("campaigns/[campaignId]/actions");
  world.signIn({ id: userId });
  const response = await route.POST(
    new Request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, ...(intent ? { intent } : {}) }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  const json = await response.json().catch(() => ({}));
  await settle(world.campaignId);
  return { status: response.status, json };
}

// Ama's player casts Cure Wounds on Kara, and the DM's turn resolves it.
async function cure(face, level = 1) {
  world.dice(...(level === 2 ? [face, face] : [face]));
  model.script([
    reply({ calls: [call("heal", { characterId: kara.id, spell: "Cure Wounds", casterId: ama.id, level })] }),
    reply({ text: "Warm light closes the cut. What do you do?" }),
  ]);
  const reply_ = await act(amaUser, `I cast Cure Wounds on Kara${level > 1 ? " with a 2nd-level slot" : ""}.`, {
    card: "spell",
    spell: "Cure Wounds",
    slotLevel: level,
    targetId: kara.id,
    targetKind: "ally",
  });
  assert.equal(world.clearDice(), 0, "a forced die went unrolled");
  return reply_;
}

await test("Each Cure Wounds the DM's turn resolves spends one 1st-level slot and heals by the server's die plus Wisdom.", async () => {
  world.patch(kara.id, { currentHp: 4 });
  for (let cast = 1; cast <= 4; cast += 1) {
    const before = hp();
    const result = await cure(1);
    assert.equal(result.status, 202, JSON.stringify(result.json));
    assert.equal(slots(1).used, cast, `cast ${cast} did not spend its slot`);
    assert.equal(hp(), Math.min(karaMax, before + 1 + 4), `cast ${cast}: 1d8 on a 1, plus 4`);
  }
  assert.equal(slots(2).used, 0, "a 1st-level cast spent a 2nd-level slot");
});

await test("With the 1st-level slots gone, the Hand's card is refused before anything is posted, and no turn wakes.", async () => {
  model.script([]);
  const refused = await act(amaUser, "I cast Cure Wounds on Kara.", { card: "spell", spell: "Cure Wounds", slotLevel: 1, targetId: kara.id, targetKind: "ally" });
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.match(refused.json.error ?? "", /slot/i);
  assert.equal(model.served(), 0, "a refused card woke the DM");
});

await test("An upcast spends a 2nd-level slot and rolls the spell's 2d8.", async () => {
  world.patch(kara.id, { currentHp: 4 });
  const result = await cure(3, 2);
  assert.equal(result.status, 202, JSON.stringify(result.json));
  assert.equal(slots(2).used, 1);
  assert.equal(slots(1).used, 4);
  assert.equal(hp(), 4 + 3 + 3 + 4);
});

await test("A short rest the DM's turn takes leaves Kara's hit dice to her player, heals what she spends, and gives back no slot.", async () => {
  world.patch(kara.id, { currentHp: 5, hitDice: { die: "d10", total: 3, spent: 0 } });
  model.script([
    reply({ calls: [call("take_rest", { kind: "short" })] }),
    reply({ text: "An hour by the fire. What do you do?" }),
  ]);
  world.dice(5, 5, 5, 5, 5, 5);
  const rested = await act(karaUser, "We stop for a short rest by the shore.");
  world.clearDice();
  assert.equal(rested.status, 202);
  assert.equal(world.sheet(kara.id).hitDice.spent, 0, "the rest spent Kara's hit dice for her");
  assert.equal(slots(1).used, 4, "a short rest gave a cleric slots back");
  assert.equal(slots(2).used, 1);

  const hitDice = await world.route("campaigns/[campaignId]/sheet/hit-dice");
  world.signIn({ id: karaUser });
  world.dice(7);
  const spent = await hitDice.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ dice: 1 }) }), {
    params: Promise.resolve({ campaignId: world.campaignId }),
  });
  assert.equal(spent.status, 200, JSON.stringify(await spent.clone().json()));
  assert.equal(world.sheet(kara.id).hitDice.spent, 1);
  assert.equal(hp(), 5 + 7 + 2, "1d10 on a 7, plus Constitution 2");
});

await test("A long rest the DM's turn takes gives back every slot, every hit point and hit dice by halves, and the same day's second restores nobody.", async () => {
  model.script([
    reply({ calls: [call("take_rest", { kind: "long" })] }),
    reply({ text: "Dawn comes grey over the water. What do you do?" }),
  ]);
  const rested = await act(karaUser, "We make camp for the night.");
  assert.equal(rested.status, 202);
  assert.equal(slots(1).used, 0, "a long rest left 1st-level slots spent");
  assert.equal(slots(2).used, 0, "a long rest left a 2nd-level slot spent");
  assert.equal(hp(), karaMax);
  assert.equal(world.sheet(kara.id).hitDice.spent, 0, "one spent hit die of three comes back");

  await cure(2);
  assert.equal(slots(1).used, 1);
  model.script([
    reply({ calls: [call("take_rest", { kind: "long" })] }),
    reply({ text: "You try to sleep again, but it is barely noon." }),
  ]);
  await act(karaUser, "Let's sleep again.");
  const answer = model.requests[1]?.messages.filter((message) => message.role === "tool").at(-1);
  assert.ok(answer, "the turn sent no tool result back");
  // The night passes, but nobody gains a second long rest's benefits in 24
  // hours (SRD 5.1); the server says so to the DM, naming each.
  const second = JSON.parse(answer.content);
  assert.deepEqual(second.rested, [], "a second long rest the same day restored someone");
  assert.match(second.unaffected ?? "", /Ama \(finished a long rest less than 24 hours ago\)/);
  assert.equal(slots(1).used, 1, "the second long rest gave the slot back");
});

await test("Nobody rests in a fight: the rest is refused, no time passes and the slots stay spent.", async () => {
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [ama.id]: 19, [kara.id]: 15 }, enemyFace: 1 });
  model.script([
    reply({ calls: [call("take_rest", { kind: "short" })] }),
    reply({ text: "The goblin will not wait for you to catch your breath." }),
  ]);
  await act(amaUser, "I sit down and catch my breath.");
  const answer = model.requests[1]?.messages.filter((message) => message.role === "tool").at(-1);
  assert.ok(JSON.parse(answer.content).error, "a rest in a fight was not refused");
  assert.equal(slots(1).used, 1);
});

leave();
model.close();
world.close();
finish();
