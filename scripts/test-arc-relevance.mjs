// Issue #301: a large storyboard's arc keeps every card, the prompt shows
// the events the scene is about inside a budget, nothing pending is
// evicted, and the render says what it held back.
import assert from "node:assert/strict";
import {
  ARC_LIMITS,
  appendBoardAct,
  applyArcExtension,
  arcRoom,
  normalizeStoryArc,
  renderArcForPrompt,
  renderArcPrompt,
} from "../src/lib/dm/arc-logic.ts";
import { cueTerms, scoreEvent, selectPendingEvents } from "../src/lib/dm/arc-relevance.ts";
import { stopWordsFor } from "../src/lib/language/language.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const event = (n, extra = {}) => ({
  id: `ev${n}`,
  kind: "setpiece",
  name: `Scene ${n}`,
  detail: `What happens in scene ${n}.`,
  trigger: `After card ${n}.`,
  actHint: null,
  status: "pending",
  ...extra,
});

function bigArc({ beats = 60, events = 30 } = {}) {
  return normalizeStoryArc({
    version: 3,
    premise: "A drowned coast and the thing under the mill.",
    beats: Array.from({ length: beats }, (_, i) => ({ text: `Beat ${i + 1}: something happens`, status: "pending", act: 1, cardId: `card-${i + 1}` })),
    acts: 1,
    finale: "",
    saga: null,
    cast: [],
    events: Array.from({ length: events }, (_, i) => event(i + 1, { cardId: `moment-${i + 1}` })),
    subArcs: [],
    worldArcs: [],
    updatedAt: "2026-10-13T00:00:00.000Z",
  });
}

// ---- storage: the whole board survives normalization ----

test("the arc's caps hold a whole 120-card board", () => {
  assert.ok(ARC_LIMITS.beats >= 120, `beats cap ${ARC_LIMITS.beats}`);
  assert.ok(ARC_LIMITS.events >= 120, `events cap ${ARC_LIMITS.events}`);
  const arc = bigArc({ beats: 60, events: 30 });
  assert.equal(arc.beats.length, 60, "beats past 40 were cut");
  assert.equal(arc.events.length, 30, "events past 24 were cut");
});

test("card references survive normalization on beats and events", () => {
  const arc = bigArc({ beats: 3, events: 2 });
  assert.equal(arc.beats[2].cardId, "card-3");
  assert.equal(arc.events[1].cardId, "moment-2");
  const again = normalizeStoryArc(JSON.parse(JSON.stringify(arc)));
  assert.equal(again.beats[2].cardId, "card-3");
  assert.equal(again.events[1].cardId, "moment-2");
});

test("a pending event is never evicted; at the cap the newcomer waits", () => {
  const arc = bigArc({ beats: 4, events: ARC_LIMITS.events });
  assert.equal(arc.events.length, ARC_LIMITS.events);
  const extended = applyArcExtension(arc, { beats: ["Act two opens"], finale: "", newEvents: [event(999, { name: "The newcomer" })] });
  assert.equal(extended.events.length, ARC_LIMITS.events);
  assert.ok(!extended.events.some((entry) => entry.name === "The newcomer"), "the newcomer displaced a pending plan");
  assert.ok(extended.events.every((entry) => entry.status === "pending"));
  // With one settled event, that one makes room.
  arc.events[3].status = "fired";
  const roomy = applyArcExtension(arc, { beats: ["Act two opens"], finale: "", newEvents: [event(999, { name: "The newcomer" })] });
  assert.ok(roomy.events.some((entry) => entry.name === "The newcomer"));
  assert.ok(!roomy.events.some((entry) => entry.status === "fired"));
});

test("arcRoom reports event room as what is not already pending", () => {
  const arc = bigArc({ beats: 4, events: 10 });
  arc.events[0].status = "dropped";
  const room = arcRoom(arc);
  assert.equal(room.eventRoom, ARC_LIMITS.events - 9);
  assert.equal(room.room, ARC_LIMITS.beats - 4);
});

test("a board act joining an arc carries its card ids and counts its events", () => {
  const arc = bigArc({ beats: 4, events: 1 });
  const joined = appendBoardAct(
    arc,
    [
      { text: "The lighthouse keeper's confession", cardId: "card-x" },
      { text: "The wreck in the shallows", cardId: "card-y" },
    ],
    [event(50, { name: "A new moment", cardId: "moment-x" })],
    "Chapter two",
  );
  assert.equal(joined.added, 2);
  assert.equal(joined.eventsAdded, 1);
  assert.equal(joined.arc.beats.at(-1).cardId, "card-y");
  assert.equal(joined.arc.events.at(-1).cardId, "moment-x");
});

// ---- the slice: relevance first, then act order, inside a budget ----

test("cue terms are whole names plus loose words, the table language's stop words out", () => {
  const terms = cueTerms({ stopWords: stopWordsFor("english"), location: "The Drowned Mill", npcs: ["Marla Quist"], recent: "We head for the lighthouse and ask about the keeper" });
  assert.ok(terms.phrases.includes("the drowned mill"));
  assert.ok(terms.phrases.includes("marla quist"));
  assert.ok(terms.words.has("lighthouse"));
  assert.ok(terms.words.has("keeper"));
  assert.ok(!terms.words.has("the"));
  assert.ok(!terms.words.has("about"));
  const lines = {
    italian: ["Andiamo per il faro e chiediamo del guardiano", ["faro", "guardiano"], ["del", "per"]],
    french: ["Nous allons vers le phare et demandons pour le gardien", ["phare", "gardien"], ["nous", "pour"]],
    spanish: ["Vamos para el faro y preguntamos por el guardián", ["faro", "guardián"], ["por", "para"]],
    german: ["Wir gehen zum Leuchtturm und fragen nach dem Wärter", ["leuchtturm", "wärter"], ["und", "nach", "dem"]],
  };
  for (const [language, [recent, kept, dropped]] of Object.entries(lines)) {
    const words = cueTerms({ stopWords: stopWordsFor(language), recent }).words;
    for (const word of kept) assert.ok(words.has(word), `${language}: ${word}`);
    for (const word of dropped) assert.ok(!words.has(word), `${language}: ${word}`);
  }
});

test("a whole name outscores loose words", () => {
  const terms = cueTerms({ stopWords: stopWordsFor("english"), location: "Saltmarsh", npcs: ["Marla Quist"] });
  const byName = scoreEvent(event(1, { trigger: "When the party confronts Marla Quist." }), terms);
  const byWord = scoreEvent(event(2, { trigger: "When the party reaches the marsh road." }), terms);
  assert.ok(byName.score > byWord.score, `${byName.score} vs ${byWord.score}`);
  assert.ok(byName.matched.includes("marla quist"));
});

test("a scene-relevant event twelfth in the list is shown ahead of unrelated earlier ones", () => {
  const arc = bigArc({ beats: 4, events: 14 });
  arc.events[11].trigger = "When the party reaches the Drowned Mill and meets Marla.";
  arc.events[11].name = "The miller's bargain";
  const { text, trace } = renderArcPrompt(arc, { stopWords: stopWordsFor("english"), location: "The Drowned Mill", npcs: ["Marla"] });
  const shown = trace.events.filter((pick) => pick.included).map((pick) => pick.id);
  assert.equal(shown[0], "ev12", `first shown was ${shown[0]}`);
  assert.match(trace.events[0].reason, /matches the scene \(the drowned mill, marla\)/);
  assert.ok(text.includes("[ev12] set piece: The miller's bargain"));
  const held = trace.events.filter((pick) => !pick.included);
  assert.ok(held.length >= 8, `held ${held.length}`);
  assert.match(held[0].reason, /^held back: /);
  assert.ok(text.includes("held back for room: " + held.map((pick) => pick.id).join(", ")));
  assert.ok(text.includes("read_card"));
});

test("without cues the events order by act hint, as before", () => {
  const arc = bigArc({ beats: 4, events: 6 });
  arc.events[4].actHint = 1;
  arc.events[0].actHint = 3;
  const { trace } = renderArcPrompt(arc);
  const shown = trace.events.filter((pick) => pick.included).map((pick) => pick.id);
  assert.equal(shown[0], "ev5");
  assert.equal(shown.at(-1), "ev1");
  assert.match(trace.events.find((pick) => pick.id === "ev1").reason, /hinted at act 3, ahead/);
});

test("the slice stops at the character budget and always shows at least one", () => {
  const long = Array.from({ length: 10 }, (_, i) => event(i + 1, { detail: "x".repeat(290), trigger: "y".repeat(190) }));
  const picked = selectPendingEvents(long, 1, undefined, (entry) => entry.detail.length + entry.trigger.length + 20, 1_200, 6);
  assert.equal(picked.included.length, 2, `budget let through ${picked.included.length}`);
  assert.ok(picked.chars <= 1_200);
  assert.match(picked.picks[2].reason, /over the 1200-character event budget/);
  const huge = selectPendingEvents([event(1, { detail: "x".repeat(2_000) })], 1, undefined, (entry) => entry.detail.length, 1_200, 6);
  assert.equal(huge.included.length, 1, "a lone event over the budget is still shown");
});

test("the trace is empty of events on an arc with none pending", () => {
  const arc = bigArc({ beats: 4, events: 2 });
  arc.events.forEach((entry) => (entry.status = "fired"));
  const { trace } = renderArcPrompt(arc);
  assert.deepEqual(trace.events, []);
});

test("a match never fires an event: the render still calls them opportunities", () => {
  const arc = bigArc({ beats: 4, events: 3 });
  const text = renderArcForPrompt(arc, { stopWords: stopWordsFor("english"), location: "Scene 2" });
  assert.ok(text.includes("opportunities, NOT a schedule"));
});

// ---- the beat window ----

test("a long act renders a window around [NOW] and counts the rest", () => {
  const arc = bigArc({ beats: 60, events: 0 });
  for (let i = 0; i < 20; i += 1) {
    arc.beats[i].status = "done";
  }
  arc.beats[20].status = "active";
  const { text, trace } = renderArcPrompt(arc);
  assert.ok(text.includes("21. [NOW] Beat 21"));
  assert.ok(text.includes("18. [done] Beat 18"), "three beats behind are shown");
  assert.ok(!text.includes("17. [done] Beat 17"), "older beats are counted, not listed");
  assert.ok(text.includes("(17 earlier beats of this act already played)"));
  assert.ok(text.includes("29. [ahead] Beat 29"), "eight beats ahead are shown");
  assert.ok(!text.includes("30. [ahead]"));
  assert.ok(text.includes("(...and 31 more beats in this act, in order)"));
  assert.equal(trace.beats.total, 60);
  assert.equal(trace.beats.shown, 12);
  assert.ok(text.includes("read_card 21"), "the [NOW] beat names its card");
});

test("an ordinary model-sized arc renders whole, as before", () => {
  const arc = bigArc({ beats: 8, events: 0 });
  arc.beats[2].status = "active";
  const { text, trace } = renderArcPrompt(arc);
  assert.equal(trace.beats.shown, 8);
  assert.ok(!text.includes("more beats in this act"));
  assert.ok(!text.includes("earlier beats of this act"));
});

test("an act not yet reached shows its first lines and a count", () => {
  const arc = bigArc({ beats: 4, events: 0 });
  const next = applyArcExtension(arc, { beats: ["A", "B", "C", "D", "E", "F"], finale: "", newEvents: [] });
  const { text } = renderArcPrompt(next);
  assert.ok(text.includes("5. [ahead] A"));
  assert.ok(text.includes("7. [ahead] C"));
  assert.ok(!text.includes("8. [ahead] D"));
  assert.ok(text.includes("(...and 3 more beats in this act, in order)"));
});

console.log(`arc relevance: ${passed} tests passed`);
