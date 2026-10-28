// Table talk put to the GM ("@GM can I jump that gap?", or the older "@DM") is answered at once,
// out of character, instead of waiting for the next move anyone makes
// (src/lib/dm/ooc-question.ts, answerOutOfCharacter in src/lib/dm/turn.ts).
// Table talk naming neither still wakes nothing, and the answer spends
// nothing a turn would: no tools, no turn row, no pointer moved in a fight.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { failure, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-ooc-at-dm");

const { addressesDm, isNarration, oocQuestionPending, oocAnswer, OOC_ANSWER_INSTRUCTION, OOC_UNANSWERED_PREFIX } = await import(
  "../src/lib/dm/ooc-question.ts"
);
const { getLatestDmMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { setFloor } = await import("../src/lib/db/campaigns.ts");
const { declaredThisTurn } = await import("../src/lib/dm/player-word.ts");
const { getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");
const { dmQueueDepth } = await import("../src/lib/dm/queue.ts");
const { getDmStatus } = await import("../src/lib/dm/status.ts");

await test("@GM is a word anywhere in the line, any case; an email address or a word that only starts with it is not.", () => {
  for (const line of ["@GM can I jump that gap?", "quick one @gm, does the guard look nervous?", "(@GM) is it night yet", "ok @Gm: rules question"]) {
    assert.equal(addressesDm(line), true, line);
  }
  for (const line of ["is anyone hungry", "mail me at kara@gm.example", "@gmail is down again", "the GM said so"]) {
    assert.equal(addressesDm(line), false, line);
  }
});

await test("@DM, the mention players typed before the role was the GM, still asks the same way.", () => {
  for (const line of ["@DM can I jump that gap?", "quick one @dm, does the guard look nervous?", "(@DM) is it night yet", "ok @Dm: rules question"]) {
    assert.equal(addressesDm(line), true, line);
  }
  for (const line of ["mail me at kara@dm.example", "@dmitri you're up", "the DM said so", "@gdm or @md are no one"]) {
    assert.equal(addressesDm(line), false, line);
  }
});

await test("Only table talk since the DM last spoke, one line naming the DM, makes the turn an answer.", () => {
  const dm = { authorType: "dm", content: "The bridge sways." };
  const ask = { authorType: "player", content: "(ooc) @DM could I jump it?" };
  const chat = { authorType: "player", content: "(ooc) brb" };
  const move = { authorType: "player", content: "I jump the gap." };
  const note = { authorType: "system", content: "Kara ends their turn." };
  assert.equal(oocQuestionPending([dm, chat, ask]), true);
  assert.equal(oocQuestionPending([ask]), true, "a question before the DM has ever spoken");
  assert.equal(oocQuestionPending([dm, chat]), false, "table talk not put to the DM");
  assert.equal(oocQuestionPending([dm, ask, move]), false, "a move since makes it a real turn");
  assert.equal(oocQuestionPending([dm, note, ask]), false, "an End Turn's note since makes it a real turn");
  assert.equal(oocQuestionPending([ask, dm]), false, "already answered");
  // A spotlight still waiting on others holds the moves already in, so a
  // question among them is still only a question.
  assert.equal(oocQuestionPending([dm, move, ask], { heldMoves: true }), true, "a held spotlight answer");
  assert.equal(oocQuestionPending([dm, move, note, ask], { heldMoves: true }), false, "an End Turn's note is still a real turn");
  // A question that got no answer leaves a table note; asking again is
  // still only a question.
  const unanswered = { authorType: "system", content: `${OOC_UNANSWERED_PREFIX}. Ask again, or carry on.` };
  assert.equal(oocQuestionPending([dm, ask, unanswered, ask]), true, "asked again after a failure");
  // The same note in the wording an older table stored it with.
  const unansweredBefore = { authorType: "system", content: "The Dungeon Master could not answer that out of character. Ask again, or carry on." };
  assert.equal(oocQuestionPending([dm, ask, unansweredBefore, ask]), true, "asked again after a failure noted in the old wording");
  const askGm = { authorType: "player", content: "(ooc) @GM could I jump it?" };
  assert.equal(oocQuestionPending([dm, chat, askGm]), true, "a question put to the GM by its new name");
  const answer = { authorType: "dm", content: "(ooc) Yes." };
  assert.equal(isNarration(dm), true);
  assert.equal(isNarration(answer), false, "an out-of-character answer is not narration");
  assert.equal(isNarration(ask), false);
  assert.equal(oocAnswer("(ooc) Yes, with a DC 12 Athletics check."), "(ooc) Yes, with a DC 12 Athletics check.");
  assert.equal(oocAnswer("OOC: The bell is out of reach."), "(ooc) The bell is out of reach.", "Codex's own label");
  assert.equal(oocAnswer("(ooc) OOC - not yet."), "(ooc) not yet.");
  assert.equal(oocAnswer("Ooch, that's a long way down."), "(ooc) Ooch, that's a long way down.");
});

async function settle(campaignId) {
  const end = Date.now() + 30_000;
  while (dmQueueDepth(campaignId) > 0) {
    if (Date.now() > end) {
      throw new Error("the DM queue never ran dry");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function act(world, userId, content, kind) {
  const route = await world.route("campaigns/[campaignId]/actions");
  world.signIn({ id: userId });
  const response = await route.POST(
    new Request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, kind }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  await settle(world.campaignId);
  return response.status;
}

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kara = world.addHero({ name: "Kara", class: "fighter", level: 1 });
const userId = world.sheet(kara.id).userId;
const model = await fakeModel();
model.pointAt(world);
// The first message at a table wakes the DM whatever it is (the opening), so
// the story has begun.
world.say("dm", "A rope bridge sways over the gorge, its middle planks gone.");
const said = () => listRecentMessages(world.campaignId, 50).map((message) => [message.authorType, message.content]);

await test("Table talk naming neither @GM nor @DM wakes nothing.", async () => {
  model.script([]);
  assert.equal(await act(world, userId, "is anyone else hungry", "ooc"), 202);
  assert.equal(model.served(), 0, "plain table talk woke the DM");
});

await test("@GM gets an out-of-character answer at once: one call that may call no tool, written as table talk, with no turn row and nothing read aloud.", async () => {
  const turnBefore = getLatestDmTurnId(world.campaignId);
  model.script([reply({ text: "Yes, it's about ten feet. You can try it with a Strength (Athletics) check when you act." })]);
  assert.equal(await act(world, userId, "@GM could I jump the gap to the far ledge?", "ooc"), 202);
  assert.equal(model.served(), 1, "the question did not wake the DM");
  const request = model.requests[0];
  // The turn's tools stay in the prompt so a local narrator's cache holds
  // (src/lib/dm/turn.ts proseOnlyTools); the answer may call none of them.
  assert.ok(request.tools?.length, "the answer's prompt lost the turn's tools");
  assert.equal(request.tool_choice, "none", "the answer could call a tool");
  assert.equal(request.messages.at(-1).content, OOC_ANSWER_INSTRUCTION);
  assert.match(JSON.stringify(request.messages), /could I jump the gap/);
  assert.deepEqual(said().at(-1), ["dm", "(ooc) Yes, it's about ten feet. You can try it with a Strength (Athletics) check when you act."]);
  const stored = listRecentMessages(world.campaignId, 1)[0];
  assert.equal(stored.dmTurnId ?? null, null, "the answer is linked to a turn");
  assert.equal(getLatestDmTurnId(world.campaignId), turnBefore, "the answer made a turn row");
  assert.equal(getDmStatus(world.campaignId), "idle");
  // The passage a reroll or a Continue takes is still the story's last one.
  assert.equal(getLatestDmMessage(world.campaignId)?.content, "A rope bridge sways over the gorge, its middle planks gone.");
});

await test("The next move is a real turn, and the DM has its own answer in front of it.", async () => {
  model.script([reply({ text: "You take a running start and leap. What do you do?" })]);
  assert.equal(await act(world, userId, "I take a run at the gap and jump.", "do"), 202);
  assert.equal(model.served(), 1);
  assert.ok(model.requests[0].tools?.length, "a move ran without the DM's tools");
  assert.match(JSON.stringify(model.requests[0].messages), /about ten feet/);
});

await test("A question while a spotlight waits on another player is answered, and the moves already in wait for the last answer.", async () => {
  const bram = world.addHero({ name: "Bram", class: "rogue", level: 1 });
  const bramUser = world.sheet(bram.id).userId;
  world.say("dm", "The far ledge crumbles. Kara, Bram: what do you do?");
  setFloor(world.campaignId, { mode: "spotlight", userIds: [userId, bramUser], prompt: "What do you do?", respondedUserIds: [] });
  model.script([]);
  assert.equal(await act(world, userId, "I throw my rope to the far post.", "do"), 202);
  assert.equal(model.served(), 0, "the spotlight still waits on Bram");
  model.script([reply({ text: "The post looks solid enough to hold one of you at a time." })]);
  assert.equal(await act(world, bramUser, "@DM would the post hold both of us?", "ooc"), 202);
  assert.equal(model.served(), 1);
  assert.equal(model.requests[0].tool_choice, "none", "the question ran a real turn while the spotlight waited");
  assert.match(said().at(-1)[1], /^\(ooc\) The post looks solid/);
  assert.equal(declaredThisTurn(world.campaignId, kara.id), true, "the answer took Kara's move from the turn");
  model.script([reply({ text: "Kara's rope snaps taut around the post, and Bram goes first." })]);
  assert.equal(await act(world, bramUser, "I cross on the rope first.", "do"), 202);
  assert.equal(model.served(), 1, "the last answer wakes the turn");
  assert.ok(model.requests[0].tools?.length);
  assert.match(JSON.stringify(model.requests[0].messages), /throw my rope/);
});

await test("A question the backend could not answer says so, and asking again is still a question.", async () => {
  model.script([failure(500), failure(500), failure(500), failure(500)]);
  assert.equal(await act(world, userId, "@GM is the rope still there?", "ooc"), 202);
  assert.ok(model.served() >= 1);
  const [author, content] = said().at(-1);
  assert.equal(author, "system");
  assert.ok(content.startsWith(OOC_UNANSWERED_PREFIX), content);
  assert.equal(getDmStatus(world.campaignId), "idle");
  model.script([reply({ text: "It is, tied off on this side." })]);
  assert.equal(await act(world, userId, "@GM is the rope still there?", "ooc"), 202);
  assert.equal(model.served(), 1);
  assert.equal(model.requests[0].tool_choice, "none", "asking again ran a real turn");
  assert.deepEqual(said().at(-1), ["dm", "(ooc) It is, tied off on this side."]);
});

await test("@DM, the older mention, in a fight answers and moves nothing: the turn, the round and the floor stay where they were.", async () => {
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [kara.id]: 19 }, enemyFace: 1 });
  const before = world.encounter();
  model.script([reply({ text: "The goblin is about twenty feet off, well within your reach after a move." })]);
  assert.equal(await act(world, userId, "@DM how far is the goblin from me?", "ooc"), 202);
  assert.equal(model.served(), 1);
  const after = world.encounter();
  assert.equal(after.round, before.round);
  assert.equal(after.turnIndex, before.turnIndex);
  assert.deepEqual(after.legendary.due ?? [], before.legendary.due ?? []);
  assert.equal(world.enemies()[0].currentHp, world.enemies()[0].maxHp);
  assert.match(said().at(-1)[1], /^\(ooc\) The goblin is about twenty feet off/);
});

model.close();
world.close();
finish();
