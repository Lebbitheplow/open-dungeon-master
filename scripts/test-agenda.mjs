// A lasting companion's hidden agenda (issue 503 Phase 8), the pure half
// (src/lib/dm/agenda-logic.ts): the agenda a DM or the story arc gives, the
// goal its order comes on, what moves the conscience, the storyteller's
// line, and the record.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const logic = await import("../src/lib/dm/agenda-logic.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const axes = (overrides = {}) => ({ drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0, ...overrides });
const key = (text) => text.trim().toLowerCase();

test("an agenda needs an employer or an aim; a driven companion's order comes sooner", () => {
  assert.equal(logic.newAgenda({}, null), null);
  assert.equal(logic.newAgenda({ employer: "  " }, null), null);
  const agenda = logic.newAgenda({ employer: "the Ashen Hand", aim: "steal the map" }, axes());
  assert.deepEqual(agenda, { employer: "the Ashen Hand", aim: "steal the map", progress: 0, target: 3, ordered: false, eventId: "" });
  assert.equal(logic.newAgenda({ aim: "x" }, axes({ drive: 2 })).target, 2);
});

test("the order's cause names the employer, or a master of their own", () => {
  assert.equal(logic.orderCause({ employer: "the Ashen Hand" }), "an order from the Ashen Hand");
  assert.equal(logic.orderCause({ employer: "" }), "an order from a master of their own");
  assert.deepEqual(logic.agendaGoal({ employer: "the Ashen Hand", aim: "", progress: 1, target: 3 }), { text: "serve the Ashen Hand", progress: 1, target: 3 });
});

test("a cast member with a pending betrayal brings it: its want, else the event's detail", () => {
  const arc = {
    cast: [
      { id: "np1", name: "Seren", role: "guide", agenda: "deliver the party to the Hand", status: "active" },
      { id: "np2", name: "Orrin", role: "smith", agenda: "", status: "active" },
    ],
    events: [
      { id: "ev1", kind: "betrayal", name: "The guide's knife", detail: "Seren leads them into the ambush", trigger: "", actHint: null, castId: "np1", status: "pending" },
      { id: "ev2", kind: "betrayal", name: "The smith's lie", detail: "Orrin sells their route", trigger: "", actHint: null, castId: "np2", status: "pending" },
      { id: "ev3", kind: "twist", name: "x", detail: "y", trigger: "", actHint: null, castId: "np1", status: "pending" },
    ],
  };
  assert.deepEqual(logic.arcBetrayalFor(arc, " seren ", key), { aim: "deliver the party to the Hand", eventId: "ev1" });
  assert.deepEqual(logic.arcBetrayalFor(arc, "Orrin", key), { aim: "Orrin sells their route", eventId: "ev2" });
  assert.equal(logic.arcBetrayalFor(arc, "Mira", key), null);
  assert.equal(logic.arcBetrayalFor({ ...arc, events: arc.events.map((event) => ({ ...event, status: "fired" })) }, "Seren", key), null, "a betrayal already delivered brings nothing");
  assert.equal(logic.arcBetrayalFor(null, "Seren", key), null);
});

test("the storyteller's line foreshadows before the order and never asks it said; after, it says the server has acted", () => {
  const agenda = logic.newAgenda({ employer: "the Ashen Hand", aim: "steal the map" }, null);
  const before = logic.agendaLine("Seren", agenda);
  assert.match(before, /^- Seren secretly answers to the Ashen Hand: steal the map\. Foreshadow it/);
  assert.match(before, /never say it/);
  const after = logic.agendaLine("Seren", { ...agenda, ordered: true });
  assert.match(after, /The order has come and broken their trust in the party/);
  assert.equal(logic.agendaWords(agenda), "answers to the Ashen Hand: steal the map");
  assert.equal(logic.agendaWords({ ...agenda, employer: "", ordered: true }), "has a secret purpose: steal the map (the order has come)");
});

test("the record round-trips; a broken or empty one is none", () => {
  const agenda = { employer: "the Ashen Hand", aim: "steal the map", progress: 2, target: 3, ordered: true, eventId: "ev1" };
  assert.deepEqual(logic.parseAgenda(JSON.stringify(agenda)), agenda);
  assert.equal(logic.parseAgenda(""), null);
  assert.equal(logic.parseAgenda("{"), null);
  assert.equal(logic.parseAgenda(JSON.stringify({ progress: 1 })), null);
});

console.log(`test-agenda: ${passed} passed`);
