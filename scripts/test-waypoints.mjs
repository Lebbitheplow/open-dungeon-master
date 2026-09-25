// Waypoints (issue #31): the checklist under a beat that gates its
// completion. Pure: matching tool calls to steps, ticking, the judge's
// reply, the planners' beat shapes, the prompt render and the fill pass.
import assert from "node:assert/strict";
import {
  applyActDetail,
  applyWaypointFill,
  needsWaypoints,
  normalizeStoryArc,
  parseActDetailJson,
  parseArcExtensionJson,
  parseSagaJson,
  parseWaypointFillJson,
  renderArcForPrompt,
} from "../src/lib/dm/arc-logic.ts";
import {
  activeBeat,
  beatGated,
  describeWaypoints,
  lexicalMatch,
  matchSignal,
  openWaypoints,
  parseWaypointJudge,
  setWaypointDone,
  signalFromToolCall,
  stems,
  tickWaypoints,
} from "../src/lib/dm/waypoint-logic.ts";
import { applyBeatEdit } from "../src/lib/dm/arc-edit-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const gatedArc = () =>
  normalizeStoryArc({
    premise: "The heart wakes beneath the drowned cathedral.",
    beats: [
      { text: "Leave Halvord's Reach.", status: "done", act: 1 },
      {
        text: "Cross the glass plain to the drowned cathedral.",
        status: "active",
        act: 1,
        waypoints: [
          { kind: "npc", text: "Speak with Brisca Hale about the safe path" },
          { kind: "place", text: "Reach the Drowned Cathedral of Vael" },
          { kind: "item", text: "Recover the glass fragment" },
          { kind: "narrative", text: "Witness the petrified pilgrims" },
        ],
      },
      { text: "Confront the vicar.", status: "pending", act: 1 },
    ],
  });

test("stems drop the words every waypoint shares and agree across plurals", () => {
  assert.deepEqual(stems("Reach the Drowned Cathedral of Vael"), ["drown", "cathe", "vael"]);
  assert.deepEqual(stems("the cathedrals"), ["cathe"]);
});

test("a name matches a waypoint when its distinctive stems all appear, or most stems are shared", () => {
  assert.equal(lexicalMatch("Reach the Drowned Cathedral of Vael", "the drowned cathedral"), true);
  assert.equal(lexicalMatch("Reach the Drowned Cathedral of Vael", "Drowned Cathedral of Vael"), true);
  assert.equal(lexicalMatch("Speak with Brisca Hale about the safe path", "Brisca"), true);
  assert.equal(lexicalMatch("Speak with Brisca Hale about the safe path", "Brisca Hale"), true);
  assert.equal(lexicalMatch("Reach the Drowned Cathedral of Vael", "the ferry landing"), false);
  assert.equal(lexicalMatch("Recover the glass fragment", "Salt-Glass Husk"), false);
  assert.equal(lexicalMatch("Speak with Brisca Hale", "Father Kaelen"), false);
});

test("tool calls become typed signals with the name the DM used", () => {
  assert.deepEqual(signalFromToolCall("move_party", '{"name":"The Drowned Cathedral"}'), { kind: "place", names: ["The Drowned Cathedral"] });
  assert.deepEqual(signalFromToolCall("update_location", '{"name":"Glass Plain"}'), { kind: "place", names: ["Glass Plain"] });
  assert.deepEqual(signalFromToolCall("set_npc", '{"name":"Brisca Hale"}'), { kind: "npc", names: ["Brisca Hale"] });
  assert.deepEqual(signalFromToolCall("social_check", '{"npc":"Brisca","approach":"persuade"}'), { kind: "npc", names: ["Brisca"] });
  assert.deepEqual(signalFromToolCall("grant_item", '{"name":"glass fragment"}'), { kind: "item", names: ["glass fragment"] });
  assert.deepEqual(signalFromToolCall("buy_item", '{"item":"rope"}'), { kind: "item", names: ["rope"] });
  assert.deepEqual(signalFromToolCall("tick_objective", "{}", { objectiveText: "Find the fragment" }), { kind: "objective", names: ["Find the fragment"] });
  assert.deepEqual(signalFromToolCall("end_encounter", "{}", { enemyNames: ["Salt-Glass Husk"] }), { kind: "fight", names: ["Salt-Glass Husk"] });
  assert.equal(signalFromToolCall("end_encounter", "{}"), null);
  assert.equal(signalFromToolCall("travel", '{"hours":4}'), null);
  assert.equal(signalFromToolCall("move_party", "not json"), null);
});

test("a signal ticks only open waypoints of its own kind, never a narrative one", () => {
  const { beat } = activeBeat(gatedArc());
  assert.deepEqual(matchSignal(beat, { kind: "place", names: ["the drowned cathedral"] }), [1]);
  assert.deepEqual(matchSignal(beat, { kind: "npc", names: ["Brisca"] }), [0]);
  assert.deepEqual(matchSignal(beat, { kind: "item", names: ["the glass fragment"] }), [2]);
  assert.deepEqual(matchSignal(beat, { kind: "narrative", names: ["the petrified pilgrims"] }), []);
  assert.deepEqual(matchSignal(beat, { kind: "place", names: ["Brisca"] }), []);
});

test("ticks record on the beat and the gate lifts only when every step is done", () => {
  let arc = gatedArc();
  assert.equal(beatGated(activeBeat(arc).beat), true);
  arc = tickWaypoints(arc, 2, [0, 1]);
  assert.equal(openWaypoints(activeBeat(arc).beat).length, 2);
  assert.equal(describeWaypoints(activeBeat(arc).beat), "[x] Speak with Brisca Hale about the safe path; [x] Reach the Drowned Cathedral of Vael; [ ] Recover the glass fragment; [ ] Witness the petrified pilgrims");
  // A stale or repeated tick changes nothing.
  assert.equal(tickWaypoints(arc, 2, [0, 9]), arc);
  arc = tickWaypoints(arc, 2, [2, 3]);
  assert.equal(beatGated(activeBeat(arc).beat), false);
  // The lead can clear a tick the server credited wrongly.
  arc = setWaypointDone(arc, 2, 3, false);
  assert.equal(beatGated(activeBeat(arc).beat), true);
});

test("a beat without waypoints gates nothing", () => {
  const arc = gatedArc();
  assert.equal(beatGated(arc.beats[2]), false);
  assert.equal(beatGated(null), false);
});

test("the judge's reply reads as JSON, bare numbers, or none", () => {
  assert.deepEqual(parseWaypointJudge("[2]", 3), [1]);
  assert.deepEqual(parseWaypointJudge("```json\n[1, 3]\n```", 3), [0, 2]);
  assert.deepEqual(parseWaypointJudge("Steps 2 and 3 happened.", 3), [1, 2]);
  assert.deepEqual(parseWaypointJudge("[]", 3), []);
  assert.deepEqual(parseWaypointJudge("none", 3), []);
  assert.deepEqual(parseWaypointJudge("[7, 0, 2, 2]", 3), [1]);
});

test("the planners' beats parse with or without waypoints, and land on the new act", () => {
  const detail = parseActDetailJson(
    JSON.stringify({
      beats: [
        { text: "Find the vicar's tomb.", waypoints: [{ kind: "place", text: "Reach the reliquary" }, { kind: "fight", text: "Defeat the tomb warden" }] },
        "Learn the hymn's true words.",
        { text: "Break the seal.", waypoints: [{ kind: "sorcery", text: "Speak the words at the seal" }, "Bring the fragment"] },
      ],
      title: "Beneath the Reliquary",
      finale: "f",
      bossEvent: null,
      newEvents: [],
      newCast: [],
    }),
  );
  assert.deepEqual(detail.beats, ["Find the vicar's tomb.", "Learn the hymn's true words.", "Break the seal."]);
  assert.equal(detail.beatWaypoints[0].length, 2);
  assert.deepEqual(detail.beatWaypoints[1], []);
  // An unknown kind reads as narrative; a bare string is a narrative step.
  assert.deepEqual(detail.beatWaypoints[2].map((w) => w.kind), ["narrative", "narrative"]);
  const before = normalizeStoryArc({
    premise: "p",
    beats: [
      { text: "a", status: "done", act: 1 },
      { text: "b", status: "done", act: 1 },
    ],
    saga: {
      title: "S",
      plannedActs: 2,
      sketches: [
        { act: 1, milestone: "m", status: "detailed" },
        { act: 2, milestone: "m2", status: "sketch" },
      ],
      finaleBoss: null,
      sagaIndex: 1,
      priorSagas: [],
    },
  });
  const after = applyActDetail(before, detail);
  assert.equal(after.beats[2].waypoints.length, 2);
  assert.equal(after.beats[2].waypoints[0].done, false);
  assert.equal(after.beats[3].waypoints, undefined);
  assert.equal(after.beats[2].status, "active");
  // The stored form round-trips.
  assert.equal(normalizeStoryArc(after).beats[2].waypoints.length, 2);

  const extension = parseArcExtensionJson('{"beats":[{"text":"x","waypoints":[{"kind":"npc","text":"Meet the smith"}]},{"text":"y"}],"finale":"f","newEvents":[]}');
  assert.equal(extension.beatWaypoints[0][0].kind, "npc");
  const saga = parseSagaJson(
    JSON.stringify({
      title: "T",
      premise: "The heart wakes.",
      actPlan: [{ milestone: "m1" }, { milestone: "m2" }],
      act1Beats: [{ text: "one", waypoints: [{ kind: "place", text: "Reach the plain" }] }, { text: "two" }],
    }),
    { minActs: 2, maxActs: 3, actsText: "2", subArcsText: "2" },
  );
  assert.equal(saga.beats[0].waypoints[0].text, "Reach the plain");
  assert.equal(saga.beats[1].waypoints, undefined);
});

test("only the beat in play shows its checklist to the DM", () => {
  const arc = tickWaypoints(gatedArc(), 2, [1]);
  const rendered = renderArcForPrompt(arc);
  assert.ok(rendered.includes("waypoints: [ ] Speak with Brisca Hale about the safe path (npc) | [x] Reach the Drowned Cathedral of Vael (place)"));
  assert.equal((rendered.match(/waypoints:/g) ?? []).length, 1);
  assert.ok(rendered.includes("cannot complete until every one is ticked"));
});

test("a legacy arc needs the fill pass until its act in play has a checklist", () => {
  const legacy = normalizeStoryArc({
    premise: "p",
    beats: [
      { text: "a", status: "done", act: 1 },
      { text: "b", status: "active", act: 1 },
      { text: "c", status: "pending", act: 1 },
    ],
  });
  assert.equal(needsWaypoints(legacy), true);
  assert.equal(needsWaypoints(gatedArc()), false);
  const fills = parseWaypointFillJson('{"beats":[{"beat":1,"waypoints":[{"kind":"place","text":"too late"}]},{"beat":2,"waypoints":[{"kind":"npc","text":"Meet Brisca"},{"kind":"place","text":"Reach the plain"}]},{"beat":9,"waypoints":[{"kind":"place","text":"nowhere"}]}]}');
  assert.equal(fills.length, 3);
  const filled = applyWaypointFill(legacy, fills);
  // Settled beats keep their record; unknown beats are ignored.
  assert.equal(filled.beats[0].waypoints, undefined);
  assert.equal(filled.beats[1].waypoints.length, 2);
  assert.equal(needsWaypoints(filled), false);
  assert.equal(applyWaypointFill(filled, fills), filled);
});

test("the lead ticks and clears waypoints by hand, never on a settled beat", () => {
  const arc = gatedArc();
  const ticked = applyBeatEdit(arc, { op: "waypoint", beat: 2, index: 0, done: true });
  assert.equal(ticked.arc.beats[1].waypoints[0].done, true);
  assert.equal(arc.beats[1].waypoints[0].done, false);
  const cleared = applyBeatEdit(ticked.arc, { op: "waypoint", beat: 2, index: 0, done: false });
  assert.equal(cleared.arc.beats[1].waypoints[0].done, false);
  assert.ok("error" in applyBeatEdit(arc, { op: "waypoint", beat: 1, index: 0, done: true }));
  assert.ok("error" in applyBeatEdit(arc, { op: "waypoint", beat: 2, index: 7, done: true }));
  assert.ok("error" in applyBeatEdit(arc, { op: "waypoint", beat: 3, index: 0, done: true }));
});

console.log(`test-waypoints: ${passed} tests passed`);
