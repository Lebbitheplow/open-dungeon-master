// A reply that is the model's plan rather than narration. Grok Build, run as
// the storyteller on 0.26.4, ended its opening and every later turn on a
// note to itself ("I will set the landing and the hour before anyone in
// Marrow's Crossing speaks."), and the note reached the table as the story.
// The claims reader quotes such sentences as asides, in any language
// (src/lib/dm/claims-logic.ts); the turn cuts only those sentences from the
// narration, asks once for the narration when nothing else is left, and
// keeps no plan from the final call or the rescue (src/lib/dm/turn.ts).
//
// The reader is answered from a script (model.claims), so every case below
// says what a reader would quote and checks what the turn does with it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-plan-note");

const world = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: false } });
const kara = world.addHero({ name: "Kara", class: "fighter", level: 1 });
const model = await fakeModel();
model.pointAt(world);

const aside = (quote) => ({ kind: "aside", quote });
const record = () => call("record_event", { characterId: kara.id, kind: "story", summary: "Kara took the council's job." });
// The last user message a request carried: a correction, when one was sent.
const lastUser = (request) => request.messages.filter((entry) => entry.role === "user").at(-1)?.content ?? "";
const asked = (index) => model.readerRequests[index]?.messages.at(-1)?.content ?? "";

await test("A turn that answers with a plan is asked once for the narration, and only the narration reaches the table.", async () => {
  const landing = "The quay is already the landing and the hour is evening.";
  const look = "I'll see who is actually standing there before Kara's question gets an answer.";
  const story = "A ferryman coils wet rope on the quay and will not meet your eye. \"The bell,\" he mutters. \"Ask the council.\" What do you do?";
  model.script([reply({ text: `${landing} ${look}` }), reply({ text: story })]);
  model.claims([[aside(landing), aside(look)], []]);
  const message = await model.turn(world, "I ask the nearest villager why everyone looks so worried.", kara.id);
  assert.equal(model.served(), 2, "the plan was not sent back for narration");
  const correction = lastUser(model.requests[1]);
  assert.match(correction, /a note about what you plan to do, not narration/);
  assert.match(correction, /call the tools the scene needs/, "the next call may still use tools");
  assert.doesNotMatch(correction, /will not see|cannot see/, "the plan was streamed, so the correction does not claim it was unseen");
  assert.doesNotMatch(correction, /second person/, "the table's tone is the system prompt's to set");
  assert.match(JSON.stringify(model.requests[1].messages), /I'll see who is actually standing there/, "the model keeps its own reply");
  assert.match(asked(0), /^Ask: .*\baside\b/m, "the reader was asked for asides");
  assert.equal(message?.content.trim(), story);
});

await test("The correction is spent once a turn: a model that plans again is not asked a third time, and its plan is not kept.", async () => {
  const plan = "I will set the scene before anyone speaks.";
  model.script([reply({ text: plan }), reply({ text: plan })]);
  model.claims([[aside(plan)], [aside(plan)]]);
  const message = await model.turn(world, "I wait by the water.", kara.id);
  assert.equal(model.served(), 2);
  assert.doesNotMatch(message?.content ?? "", /I will set the scene/, "the second plan reached the table");
});

await test("A plan told in Italian is cut by the same reader claim: the correction goes out and the narration arrives.", async () => {
  const map = "Il molo non è ancora sulla mappa.";
  const plan = "Prima imposterò l'approdo e l'ora.";
  const story = "La nebbia del fiume avvolge il molo. Un traghettatore arrotola una cima bagnata e non ti guarda. Cosa fai?";
  model.script([reply({ text: `${map} ${plan}` }), reply({ text: story })]);
  model.claims([[aside(map), aside(plan)], []]);
  const message = await model.turn(world, "Chiedo al traghettatore della campana.", kara.id);
  assert.equal(model.served(), 2, "the Italian plan was not sent back for narration");
  assert.match(lastUser(model.requests[1]), /a note about what you plan to do/);
  assert.equal(message?.content.trim(), story);
});

await test("One aside beside a bookkeeping call is cut, and the narration around it reaches the table.", async () => {
  const story =
    "Mother Hesk presses a cold iron key into your palm. “The bell tower. Three nights now.” Behind her the river fog swallows the quay.";
  const note = "I'll record that Kara took the job.";
  model.script([reply({ text: `${story} ${note}`, calls: [record()] }), reply({ text: "What do you ask her next?" })]);
  model.claims([[aside(note)]]);
  const message = await model.turn(world, "I take the key.", kara.id);
  assert.match(message?.content ?? "", /the river fog swallows the quay\./, "the narration was dropped with the aside");
  assert.match(message?.content ?? "", /Mother Hesk presses a cold iron key/);
  assert.doesNotMatch(message?.content ?? "", /I'll record/, "the aside reached the table");
});

// After a roll the turn already holds the line written before it, so a
// dropped reply was never followed up: the arrival was lost (review M1).
await test("After a roll, an arrival beside move_party keeps its narration and loses only its aside.", async () => {
  const climb = "You find a handhold and start up the gorge wall.";
  const arrival = "You haul yourself onto the ledge outside the cave mouth, breathing hard. Cold air spills from the dark within.";
  const note = "I'll move the party to the cave mouth now.";
  model.script([
    reply({ text: climb, calls: [call("request_roll", { characterId: kara.id, kind: "skill_check", skill: "athletics", dc: 12, reason: "the gorge wall" })] }),
    reply({ text: `${arrival} ${note}`, calls: [call("move_party", { name: "Cave Mouth", layoutDescription: "A narrow ledge before a dark cave." })] }),
  ]);
  model.claims([[aside(note)]]);
  const message = await model.turn(world, "I climb the gorge wall.", kara.id);
  assert.doesNotMatch(message?.content ?? "", /You find a handhold/, "the text beside the roll, written before the dice, reached the table");
  assert.match(message?.content ?? "", /Cold air spills from the dark within\./, "the arrival was lost");
  assert.doesNotMatch(message?.content ?? "", /I'll move the party/);
});

await test("After a roll, a reply beside move_party that is only a plan is followed up, and the arrival it owed reaches the table.", async () => {
  const climb = "You find a handhold and start up the gorge wall.";
  const plan = "I'll move the party to the cave mouth before narrating the climb.";
  const arrival = "You haul yourself onto the ledge outside the cave mouth. Cold air spills from the dark within. Who follows you up?";
  model.script([
    reply({ text: climb, calls: [call("request_roll", { characterId: kara.id, kind: "skill_check", skill: "athletics", dc: 12, reason: "the gorge wall" })] }),
    reply({ text: plan, calls: [call("move_party", { name: "Cave Ledge", layoutDescription: "A narrow ledge before a dark cave." })] }),
    reply({ text: arrival }),
  ]);
  model.claims([[aside(plan)], []]);
  const message = await model.turn(world, "I climb the gorge wall again.", kara.id);
  assert.equal(model.served(), 3, "the plan beside move_party was not followed up");
  assert.match(message?.content ?? "", /Cold air spills from the dark within\./);
  assert.doesNotMatch(message?.content ?? "", /before narrating the climb/);
});

// What only reads like an aside to a word list: the reader quotes none of
// it, and the turn leaves it whole and makes no extra call.
for (const [label, text] of [
  ["single-quote dialogue", "The ferryman spits into the river. 'Not tonight. I will not cross with the bell still silent.' He turns back to his rope."],
  ["a letter", "The note is pinned to the door:\n\nI will come for the bell at midnight. Let me have it, or the river takes the town.\n\nThe wax seal is a black heron."],
  ["an offer to the players", "The hold is dark and smells of tar. Let me know if Kara searches the boat first, or heads straight for the council."],
  ["an out-of-character answer", "The guard stumbles back against the rail. (OOC: I'll allow the shove as a bonus action this once.) What do you do?"],
]) {
  await test(`Narration holding ${label} is left whole, with no extra call.`, async () => {
    model.script([reply({ text })]);
    model.claims([[]]);
    const message = await model.turn(world, "I look around.", kara.id);
    assert.equal(model.served(), 1, "the narration was sent back as a plan");
    assert.equal(message?.content.trim(), text);
  });
}

// Grok's second shape, seen live: the plan written beside the tool calls,
// then an empty reply once their results are in.
await test("A plan written beside tool calls never reaches the table: the calls run, and the turn is asked for the narration it owes.", async () => {
  const plan = "I'll check how the table records that exchange before she answers.";
  const story = "Mother Hesk nods once. \"Three nights ago, after the last bell. No enemies I know of.\" What do you ask next?";
  model.script([reply({ text: plan, calls: [record()] }), reply({ text: "" }), reply({ text: "" }), reply({ text: story })]);
  model.claims([[aside(plan)], []]);
  const message = await model.turn(world, "I take the job and ask about the sexton.", kara.id);
  assert.doesNotMatch(message?.content ?? "", /I'll check how the table/, "the plan reached the table");
  assert.match(message?.content ?? "", /Three nights ago/);
});

await test("A plan returned by the rescue never reaches the table: the turn keeps no narration rather than the plan, and makes no second rescue.", async () => {
  const plan = "I'll check how the table records that exchange before she answers.";
  const again = "I will narrate the exchange once the record is in.";
  model.script([reply({ text: plan, calls: [record()] }), reply({ text: "" }), reply({ text: "" }), reply({ text: again })]);
  model.claims([[aside(plan)], [aside(again)]]);
  const message = await model.turn(world, "I take the job.", kara.id);
  assert.equal(model.served(), 4, "a second rescue was made");
  assert.doesNotMatch(message?.content ?? "", /I will narrate the exchange|I'll check how the table/, "a plan reached the table");
  assert.match(asked(1), /^Ask: aside$/m, "the rescue's reply was read for asides");
});

await test("A plan on the forced final call never reaches the table.", async () => {
  const plan = "I will set the landing and the hour before anyone speaks.";
  model.script([reply({ calls: [record()] }), reply({ calls: [record()] }), reply({ calls: [record()] }), reply({ text: plan })]);
  model.claims([[aside(plan)]]);
  const message = await model.turn(world, "I step off the ferry.", kara.id);
  assert.equal(model.served(), 4);
  assert.doesNotMatch(message?.content ?? "", /I will set the landing/, "the plan reached the table");
  assert.match(asked(0), /^Ask: aside$/m, "the final call's reply was read for asides");
});

await test("A plan sent back right before the final call is not told to call tools that will be closed.", async () => {
  const plan = "I will set the landing and the hour before anyone speaks.";
  const story = "The ferry bumps the quay and the fog thins around you. What do you do?";
  model.script([reply({ calls: [record()] }), reply({ calls: [record()] }), reply({ text: plan }), reply({ text: story })]);
  model.claims([[aside(plan)], []]);
  const message = await model.turn(world, "I step off the ferry again.", kara.id);
  assert.equal(model.served(), 4);
  const correction = lastUser(model.requests[3]);
  assert.doesNotMatch(correction, /call the tools/);
  assert.match(correction, /Tools are closed/);
  assert.match(correction, /a note about what you plan to do/);
  assert.equal(message?.content.trim(), story);
});

model.close();
world.close();
finish();
