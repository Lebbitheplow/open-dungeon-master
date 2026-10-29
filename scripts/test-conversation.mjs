// A conversation in flight (src/lib/dm/conversation-logic.ts): the moments a
// player answers someone who just spoke to them, when the reply belongs to
// that exchange and nothing cuts in. The cases are a table's own: an elder
// asked where the blight came from (and a stag charged in instead), and a
// companion told "I've got to go back" (and the reply arrived in the village).
import assert from "node:assert/strict";
import { conversationInFlight, conversationNote, spokenWords } from "../src/lib/dm/conversation-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const MIRA = "pc-mira";
const BRAM = "pc-bram";
const names = new Map([
  [MIRA, "Mira Vale"],
  [BRAM, "Bram Holt"],
]);
const companionIds = new Set([BRAM]);
const osric = { kind: "npc", id: "npc-osric", name: "Elder Osric" };
const bram = { kind: "pc", id: BRAM, name: "Bram Holt" };

const dm = (content, speakers = []) => ({
  authorType: "dm",
  content,
  speech: speakers.map((speaker) => ({ line: "...", speaker })),
});
const player = (content, characterId = MIRA) => ({ authorType: "player", content, characterId });
const read = (history, inEncounter = false) => conversationInFlight({ history, inEncounter, companionIds, names });

test("a question put to an NPC who just spoke is a conversation with them", () => {
  const history = [
    dm("Elder Osric turns. \"Mira. You came.\"", [osric, osric]),
    player('"Where would we go? Do we have any clues yet as to where this is coming from?"'),
  ];
  assert.deepEqual(read(history), { with: "Elder Osric", answering: ["Mira Vale"] });
});

test("words said to an AI companion who just spoke are a conversation with them", () => {
  const history = [
    dm("Bram Holt leans on the shelf. \"Rough news?\"", [bram]),
    player("“I’ve got to go back, Bram. It’s getting worse.”"),
  ];
  assert.deepEqual(read(history), { with: "Bram Holt", answering: ["Mira Vale"] });
});

test("an action with no words, a reply nobody spoke in, or a fight is no conversation", () => {
  assert.equal(read([dm("Osric speaks.", [osric]), player("I approach Elder Osric and clear my throat.")]), null);
  assert.equal(read([dm("The village is quiet."), player('"Hello?"')]), null);
  assert.equal(read([dm("Osric speaks.", [osric]), player('"What now?"')], true), null);
  assert.equal(read([player('"Is anyone there?"')]), null, "nothing has been said to the party yet");
});

test("a player character's own quoted words make nobody the other side of the talk", () => {
  const hero = { kind: "pc", id: MIRA, name: "Mira Vale" };
  assert.equal(read([dm("You call out.", [hero]), player('"Anyone?"')]), null);
});

test("the last voice of the reply is who the party is talking with, and every answering player is named", () => {
  const history = [
    dm("Bram grunts, and Osric answers him.", [bram, osric]),
    player('"Is it the old mill?"'),
    player('"Tell us."', BRAM),
  ];
  assert.deepEqual(read(history), { with: "Elder Osric", answering: ["Mira Vale", "Bram Holt"] });
});

test("words are quotes of any script or a question", () => {
  for (const text of ['"Go."', "“Go.”", "„Geh.“", "«Va.»", "「行け」", "Where is it?", "¿Dónde?", "どこ？"]) {
    assert.ok(spokenWords(text), text);
  }
  assert.ok(!spokenWords("I search the shelves."));
});

test("the note asks for that person's answer and holds the fight, the arrival and the checklist", () => {
  const note = conversationNote({ with: "Elder Osric", answering: ["Mira Vale"] });
  assert.ok(note.startsWith("IN CONVERSATION: Mira Vale is talking with Elder Osric"));
  assert.ok(note.includes("This reply is Elder Osric's answer"));
  assert.ok(note.includes("is not a check: roll only for a player's own attempt"), "what an NPC knows is the GM's to tell");
  assert.ok(note.includes("No fight starts"));
  assert.ok(note.includes("if they set out, end on the way there"));
  assert.ok(note.includes("open waypoints wait for a pause"));
  assert.ok(conversationNote({ with: "Mira", answering: ["A", "B"] }).startsWith("IN CONVERSATION: A and B are talking"));
  assert.ok(conversationNote({ with: "Mira", answering: [] }).startsWith("IN CONVERSATION: A player is talking"));
});

console.log(`conversation: ${passed} tests passed`);
