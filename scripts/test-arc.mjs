// Story-arc parsing, clamped delta merges, and player-safe projections.
import assert from "node:assert/strict";
import {
  activeBeatNumber,
  activeQuestLines,
  applyArcDelta,
  applyArcEnrichment,
  applyArcExtension,
  arcExhausted,
  completeBeat,
  needsEnrichment,
  normalizeStoryArc,
  parseArcDeltaJson,
  parseArcEnrichmentJson,
  parseArcExtensionJson,
  parseArcJson,
  renderArcForPrompt,
} from "../src/lib/dm/arc-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const validArcJson = JSON.stringify({
  premise: "A dead god's heart is waking beneath the city.",
  stakes: "If it beats again, the city drowns in divine fire.",
  antagonist: "Vicar Osseth, who wants the god reborn.",
  beats: [
    "The party notices the tremors and the missing clergy",
    "They trace the disappearances to the undercroft",
    "Osseth is revealed as the abductor",
    "The heart's first beat shatters the temple district",
    "Final descent to still the heart forever",
  ],
  finale: "Still or wake the heart in the sunken sanctum.",
  subArcs: [
    {
      name: "The Missing Sexton",
      goal: "Find sexton Marl before the next tremor",
      hook: "Marl saw Osseth's face and lives, hidden",
      beats: ["Search the parish", "Follow the tunnel scratches"],
    },
    {
      name: "The Broken Seal",
      goal: "Recover the seal fragments from the reliquary",
      hook: "The seal is the only way to still the heart",
      beats: ["Reliquary heist", "Decode the fragments"],
    },
  ],
});

test("clean arc JSON parses; first beat active, sub-arcs open active", () => {
  const arc = parseArcJson(validArcJson);
  assert.ok(arc);
  assert.equal(arc.beats.length, 5);
  assert.equal(arc.beats[0].status, "active");
  assert.equal(arc.beats[1].status, "pending");
  assert.deepEqual(
    arc.subArcs.map((subArc) => subArc.id),
    ["sa1", "sa2"],
  );
  assert.ok(arc.subArcs.every((subArc) => subArc.status === "active"));
});

test("code-fenced JSON with reasoning chatter still parses", () => {
  const arc = parseArcJson(
    `<think>plotting...</think>Here you go:\n\`\`\`json\n${validArcJson}\n\`\`\``,
  );
  assert.ok(arc);
  assert.equal(arc.subArcs.length, 2);
});

test("garbage yields null, not a broken arc", () => {
  assert.equal(parseArcJson("the model rambled with no json at all"), null);
  assert.equal(parseArcJson('{"premise": "x"}'), null);
  assert.equal(normalizeStoryArc(null), null);
  assert.equal(normalizeStoryArc("nope"), null);
});

test("stored arc round-trips through normalizeStoryArc with statuses intact", () => {
  const arc = parseArcJson(validArcJson);
  arc.beats[0].status = "done";
  arc.beats[1].status = "active";
  arc.subArcs[0].status = "resolved";
  arc.subArcs[0].resolution = "Marl found alive";
  const restored = normalizeStoryArc(JSON.parse(JSON.stringify(arc)));
  assert.equal(restored.beats[0].status, "done");
  assert.equal(restored.beats[1].status, "active");
  assert.equal(restored.subArcs[0].status, "resolved");
  assert.equal(restored.subArcs[0].resolution, "Marl found alive");
});

test("delta marks beats done and advances the active marker", () => {
  const arc = parseArcJson(validArcJson);
  const delta = parseArcDeltaJson(
    '{"beatsDone": [1, 2], "activeBeat": 3, "subArcUpdates": [{"id": "sa1", "status": "resolved", "resolution": "Marl rescued"}], "newSubArcs": []}',
  );
  const next = applyArcDelta(arc, delta);
  assert.equal(next.beats[0].status, "done");
  assert.equal(next.beats[1].status, "done");
  assert.equal(next.beats[2].status, "active");
  assert.equal(next.subArcs[0].status, "resolved");
  assert.equal(next.subArcs[0].resolution, "Marl rescued");
  // Original untouched.
  assert.equal(arc.beats[0].status, "active");
});

test("delta clamps invalid indices, unknown ids, and done-beat activation", () => {
  const arc = parseArcJson(validArcJson);
  const delta = parseArcDeltaJson(
    '{"beatsDone": [1, 99, -2, 0], "activeBeat": 1, "subArcUpdates": [{"id": "sa9", "status": "resolved"}], "newSubArcs": []}',
  );
  const next = applyArcDelta(arc, delta);
  assert.equal(next.beats[0].status, "done");
  // activeBeat pointed at a done beat, so the first pending beat is chosen.
  assert.equal(next.beats[1].status, "active");
  assert.ok(next.subArcs.every((subArc) => subArc.status === "active"));
});

test("empty delta is a clean no-op on statuses", () => {
  const arc = parseArcJson(validArcJson);
  const delta = parseArcDeltaJson('{"beatsDone": [], "activeBeat": null, "subArcUpdates": [], "newSubArcs": []}');
  const next = applyArcDelta(arc, delta);
  assert.deepEqual(
    next.beats.map((beat) => beat.status),
    arc.beats.map((beat) => beat.status),
  );
});

test("new sub-arcs cap at 2 and get fresh sequential ids", () => {
  const arc = parseArcJson(validArcJson);
  const delta = parseArcDeltaJson(
    JSON.stringify({
      beatsDone: [],
      activeBeat: null,
      subArcUpdates: [],
      newSubArcs: [
        { name: "A", goal: "a", hook: "", beats: [] },
        { name: "B", goal: "b", hook: "", beats: [] },
        { name: "C", goal: "c", hook: "", beats: [] },
      ],
    }),
  );
  const next = applyArcDelta(arc, delta);
  assert.equal(next.subArcs.length, 4);
  assert.equal(next.subArcs[2].id, "sa3");
  assert.equal(next.subArcs[3].id, "sa4");
  assert.equal(next.subArcs[3].status, "active");
});

test("unparseable delta yields null", () => {
  assert.equal(parseArcDeltaJson("no json here"), null);
});

test("prompt render is bounded and marks the NOW beat", () => {
  const arc = parseArcJson(validArcJson);
  arc.beats[0].status = "done";
  arc.beats[1].status = "active";
  arc.subArcs[1].status = "resolved";
  arc.subArcs[1].resolution = "Seal restored";
  const rendered = renderArcForPrompt(arc);
  assert.ok(rendered.includes("[NOW] They trace the disappearances"));
  assert.ok(rendered.includes("[done]"));
  assert.ok(rendered.includes("Settled: The Broken Seal (Seal restored)"));
  assert.ok(rendered.length < 4000);
});

test("quest lines are player-safe: no hooks or expected beats leak", () => {
  const arc = parseArcJson(validArcJson);
  const lines = activeQuestLines(arc);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("The Missing Sexton:"));
  const joined = lines.join("\n");
  assert.ok(!joined.includes("Osseth's face"));
  assert.ok(!joined.includes("Reliquary heist"));
});

test("resolved sub-arcs drop out of the quest log", () => {
  const arc = parseArcJson(validArcJson);
  arc.subArcs[0].status = "resolved";
  const lines = activeQuestLines(arc);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith("The Broken Seal:"));
});

// --- v2: acts, cast, planned events, player-driven enrichment ---

const v2ArcJson = JSON.stringify({
  premise: "A dead god's heart is waking beneath the city.",
  stakes: "If it beats again, the city drowns in divine fire.",
  antagonist: "Vicar Osseth, who wants the god reborn.",
  acts: [
    { beats: ["Tremors and missing clergy", "The undercroft is found", "Osseth is named"] },
    { beats: ["The first beat shatters the temple", "The Concord closes the gates"] },
    { beats: ["Descent to the sunken sanctum", "The heart is stilled or woken"] },
  ],
  finale: "Still or wake the heart in the sunken sanctum.",
  cast: [
    { name: "Sexton Marl", role: "the only witness", agenda: "survive and be believed" },
    { name: "Captain Ivry", role: "gate captain", agenda: "keep the district sealed" },
  ],
  events: [
    {
      kind: "ally",
      name: "Marl offers to guide them",
      detail: "He knows the tunnel the abductors use",
      trigger: "the first time the party enters the parish at night",
      actHint: 1,
    },
    {
      kind: "betrayal",
      name: "Ivry seals them in",
      detail: "The gate captain takes Osseth's coin",
      trigger: "when the party tries to leave the temple district",
      actHint: 2,
    },
  ],
  subArcs: [
    {
      name: "The Missing Sexton",
      goal: "Find sexton Marl before the next tremor",
      hook: "Marl saw Osseth's face and lives, hidden",
      beats: ["Search the parish", "Follow the tunnel scratches"],
    },
  ],
});

test("acts flatten into indexed beats tagged with their act", () => {
  const arc = parseArcJson(v2ArcJson);
  assert.ok(arc);
  assert.equal(arc.beats.length, 7);
  assert.equal(arc.acts, 3);
  assert.deepEqual(
    arc.beats.map((beat) => beat.act),
    [1, 1, 1, 2, 2, 3, 3],
  );
  assert.equal(arc.beats[0].status, "active");
  assert.deepEqual(
    arc.cast.map((npc) => npc.id),
    ["np1", "np2"],
  );
  assert.deepEqual(
    arc.events.map((event) => event.id),
    ["ev1", "ev2"],
  );
  assert.ok(arc.events.every((event) => event.status === "pending"));
});

test("v1 arc rows migrate: beats get act 1, layers default empty", () => {
  const legacy = {
    version: 1,
    premise: "An old campaign already in progress.",
    beats: [
      { text: "First", status: "done" },
      { text: "Second", status: "active" },
      { text: "Third", status: "pending" },
    ],
    subArcs: [{ id: "sa1", name: "A thread", goal: "do a thing", hook: "secret", status: "active" }],
  };
  const arc = normalizeStoryArc(legacy);
  assert.equal(arc.version, 2);
  assert.equal(arc.acts, 1);
  assert.ok(arc.beats.every((beat) => beat.act === 1));
  assert.equal(arc.beats[0].status, "done");
  assert.equal(arc.beats[1].status, "active");
  assert.deepEqual(arc.cast, []);
  assert.deepEqual(arc.events, []);
  assert.ok(needsEnrichment(arc));
});

test("enrichment adds layers and acts without touching beat text or status", () => {
  const arc = normalizeStoryArc({
    premise: "An old campaign already in progress.",
    beats: [
      { text: "First", status: "done" },
      { text: "Second", status: "active" },
      { text: "Third", status: "pending" },
      { text: "Fourth", status: "pending" },
    ],
  });
  const enrichment = parseArcEnrichmentJson(
    JSON.stringify({
      cast: [{ name: "Ivry", role: "captain", agenda: "seal the gates" }],
      events: [
        { kind: "twist", name: "The seal is a fake", detail: "It never worked", trigger: "on inspection", actHint: 2 },
      ],
      beatActs: [
        { beat: 1, act: 1 },
        { beat: 2, act: 1 },
        { beat: 3, act: 2 },
        { beat: 4, act: 2 },
      ],
    }),
  );
  const next = applyArcEnrichment(arc, enrichment);
  assert.equal(next.acts, 2);
  assert.deepEqual(
    next.beats.map((beat) => beat.act),
    [1, 1, 2, 2],
  );
  assert.deepEqual(
    next.beats.map((beat) => beat.text),
    ["First", "Second", "Third", "Fourth"],
  );
  assert.equal(next.beats[0].status, "done");
  assert.equal(next.beats[1].status, "active");
  assert.equal(next.cast[0].id, "np1");
  assert.equal(next.events[0].id, "ev1");
  assert.ok(!needsEnrichment(next));
  // Original untouched.
  assert.equal(arc.cast.length, 0);
});

test("enrichment with nothing usable yields null", () => {
  assert.equal(parseArcEnrichmentJson('{"cast": [], "events": [], "beatActs": []}'), null);
  assert.equal(parseArcEnrichmentJson("no json"), null);
});

test("annotations attach table detail without changing beat text", () => {
  const arc = parseArcJson(v2ArcJson);
  const original = arc.beats.map((beat) => beat.text);
  const delta = parseArcDeltaJson(
    JSON.stringify({
      beatsDone: [1],
      beatAnnotations: [
        { beat: 1, detail: "They let Marl go free and he owes them" },
        { beat: 2, detail: "The Concord already knows their faces" },
      ],
      activeBeat: 2,
    }),
  );
  const next = applyArcDelta(arc, delta);
  assert.deepEqual(
    next.beats.map((beat) => beat.text),
    original,
  );
  assert.equal(next.beats[0].detail, "They let Marl go free and he owes them");
  assert.equal(next.beats[1].detail, "The Concord already knows their faces");
  assert.ok(renderArcForPrompt(next).includes("table: The Concord already knows their faces"));
});

test("annotations cap at 3 and ignore invalid beat numbers", () => {
  const arc = parseArcJson(v2ArcJson);
  const delta = parseArcDeltaJson(
    JSON.stringify({
      beatAnnotations: [
        { beat: 1, detail: "one" },
        { beat: 2, detail: "two" },
        { beat: 3, detail: "three" },
        { beat: 4, detail: "four" },
        { beat: 99, detail: "nope" },
        { beat: 0, detail: "nope" },
      ],
    }),
  );
  assert.equal(delta.beatAnnotations.length, 3);
  const next = applyArcDelta(arc, delta);
  assert.equal(next.beats[3].detail, undefined);
});

test("skipped beats advance the NOW marker and never reopen a done beat", () => {
  const arc = parseArcJson(v2ArcJson);
  const delta = parseArcDeltaJson(
    '{"beatsDone": [1], "beatsSkipped": [1, 2, 3], "activeBeat": null}',
  );
  const next = applyArcDelta(arc, delta);
  // Beat 1 was already done, so the skip is ignored for it.
  assert.equal(next.beats[0].status, "done");
  assert.equal(next.beats[1].status, "skipped");
  assert.equal(next.beats[2].status, "skipped");
  assert.equal(next.beats[3].status, "active");
  assert.ok(renderArcForPrompt(next).includes("[skipped]"));
});

test("events fire, drop, and add with clamping", () => {
  const arc = parseArcJson(v2ArcJson);
  const delta = parseArcDeltaJson(
    JSON.stringify({
      eventsFired: ["ev1"],
      eventsDropped: ["ev2", "ev99"],
      newEvents: [
        { kind: "deadline", name: "The tide clock", detail: "Water rises nightly", trigger: "each dusk", actHint: 2 },
        { kind: "discovery", name: "The old map", detail: "Shows a second sanctum", trigger: "in the reliquary", actHint: 2 },
        { kind: "setpiece", name: "Too many", detail: "Should be dropped", trigger: "never", actHint: 3 },
      ],
    }),
  );
  const next = applyArcDelta(arc, delta);
  assert.equal(next.events.find((event) => event.id === "ev1").status, "fired");
  assert.equal(next.events.find((event) => event.id === "ev2").status, "dropped");
  assert.equal(next.events.length, 4);
  assert.deepEqual(
    next.events.slice(2).map((event) => event.id),
    ["ev3", "ev4"],
  );
  assert.ok(next.events.slice(2).every((event) => event.status === "pending"));
  // Bad kinds fall back rather than corrupting the arc.
  const fallback = parseArcDeltaJson(
    '{"newEvents": [{"kind": "explosion", "name": "X", "detail": "d", "trigger": "t"}]}',
  );
  assert.equal(fallback.newEvents[0].kind, "setpiece");
});

test("cast updates accrete notes, mark departures, and cap new arrivals", () => {
  const arc = parseArcJson(v2ArcJson);
  const delta = parseArcDeltaJson(
    JSON.stringify({
      castUpdates: [
        { id: "np1", notes: "Owes the party a life debt" },
        { id: "np2", status: "gone" },
        { id: "np9", notes: "unknown npc" },
      ],
      newCast: [
        { name: "Wren", role: "fence", agenda: "buy the seal fragments" },
        { name: "Halt", role: "smith", agenda: "reforge the seal" },
        { name: "Third", role: "extra", agenda: "should be dropped" },
      ],
    }),
  );
  const next = applyArcDelta(arc, delta);
  assert.equal(next.cast[0].notes, "Owes the party a life debt");
  assert.equal(next.cast[1].status, "gone");
  assert.equal(next.cast.length, 4);
  assert.deepEqual(
    next.cast.slice(2).map((npc) => npc.id),
    ["np3", "np4"],
  );
  // A departed NPC leaves the prompt render.
  assert.ok(!renderArcForPrompt(next).includes("Captain Ivry"));
});

test("exhausted arc extends with a whole new act, leaving old beats intact", () => {
  const arc = parseArcJson(v2ArcJson);
  assert.equal(arcExhausted(arc), false);
  for (const beat of arc.beats) {
    beat.status = "done";
  }
  arc.beats[6].status = "skipped";
  assert.equal(arcExhausted(arc), true);

  const extension = parseArcExtensionJson(
    JSON.stringify({
      beats: ["The god's ashes are stolen", "The Concord crowns a new vicar", "The ashes are burned"],
      finale: "Burn the ashes before the crowning.",
      antagonist: "Captain Ivry, wearing Osseth's mitre.",
      newEvents: [
        { kind: "npc_encounter", name: "Marl returns", detail: "Older and armed", trigger: "at the ash road", actHint: 4 },
      ],
    }),
  );
  const next = applyArcExtension(arc, extension);
  assert.equal(next.acts, 4);
  assert.equal(next.beats.length, 10);
  assert.equal(next.beats[7].act, 4);
  assert.equal(next.beats[7].status, "active");
  assert.equal(next.beats[0].status, "done");
  assert.equal(next.beats[0].text, "Tremors and missing clergy");
  assert.equal(next.antagonist, "Captain Ivry, wearing Osseth's mitre.");
  assert.equal(next.events.length, 3);
  assert.equal(arcExhausted(next), false);
});

test("extension without enough beats yields null", () => {
  assert.equal(parseArcExtensionJson('{"beats": ["only one"], "finale": "x"}'), null);
  assert.equal(parseArcExtensionJson("no json"), null);
});

test("finished acts collapse in the render and it stays bounded", () => {
  const arc = parseArcJson(v2ArcJson);
  for (let index = 0; index < 3; index += 1) {
    arc.beats[index].status = "done";
  }
  arc.beats[3].status = "active";
  const rendered = renderArcForPrompt(arc);
  assert.ok(rendered.includes("Act 1 (finished):"));
  assert.ok(rendered.includes("Act 2:"));
  assert.ok(rendered.includes("[NOW] The first beat shatters the temple"));
  assert.ok(rendered.includes("Recurring cast"));
  assert.ok(rendered.includes("Planned events"));
  assert.ok(rendered.length < 4000);
});

test("quest log never leaks cast agendas or planned events", () => {
  const arc = parseArcJson(v2ArcJson);
  const joined = activeQuestLines(arc).join("\n");
  assert.ok(joined.includes("The Missing Sexton"));
  assert.ok(!joined.includes("Ivry"));
  assert.ok(!joined.includes("takes Osseth's coin"));
  assert.ok(!joined.includes("keep the district sealed"));
});

// --- beat-driven chapter pacing ---

test("completeBeat marks the beat done and advances [NOW]", () => {
  const arc = parseArcJson(v2ArcJson);
  assert.equal(activeBeatNumber(arc), 1);
  const advanced = completeBeat(arc, 1);
  assert.ok(advanced);
  assert.equal(advanced.arc.beats[0].status, "done");
  assert.equal(advanced.arc.beats[1].status, "active");
  assert.equal(activeBeatNumber(advanced.arc), 2);
  // Original untouched, and no beat text moved.
  assert.equal(arc.beats[0].status, "active");
  assert.deepEqual(
    advanced.arc.beats.map((beat) => beat.text),
    arc.beats.map((beat) => beat.text),
  );
});

test("completeBeat refuses settled and out-of-range beats", () => {
  const arc = parseArcJson(v2ArcJson);
  const once = completeBeat(arc, 1);
  assert.equal(completeBeat(once.arc, 1), null, "a done beat cannot re-complete");
  assert.equal(completeBeat(arc, 0), null);
  assert.equal(completeBeat(arc, 99), null);
  arc.beats[3].status = "skipped";
  assert.equal(completeBeat(arc, 4), null, "a skipped beat cannot complete");
});

test("completing out of order is allowed and reseats [NOW] to the first open beat", () => {
  const arc = parseArcJson(v2ArcJson);
  const advanced = completeBeat(arc, 3);
  assert.equal(advanced.arc.beats[2].status, "done");
  assert.equal(activeBeatNumber(advanced.arc), 1);
});

test("completing the last open beat exhausts the arc", () => {
  let arc = parseArcJson(v2ArcJson);
  for (let number = 1; number <= arc.beats.length; number += 1) {
    const advanced = completeBeat(arc, number);
    assert.ok(advanced, `beat ${number} should complete`);
    arc = advanced.arc;
  }
  assert.equal(activeBeatNumber(arc), null);
  assert.equal(arcExhausted(arc), true);
});

test("re-proposed events and cast are not duplicated", () => {
  const arc = parseArcJson(v2ArcJson);
  // The model routinely echoes back threads it was just shown; an extension
  // or refresh must not silt the arc up with copies of them.
  const delta = parseArcDeltaJson(
    JSON.stringify({
      newEvents: [
        { kind: "ally", name: "Marl offers to guide them", detail: "same thread again", trigger: "t" },
        { kind: "twist", name: "Genuinely new", detail: "d", trigger: "t" },
      ],
      newCast: [
        { name: "Sexton Marl", role: "dupe", agenda: "dupe" },
        { name: "Wren", role: "fence", agenda: "buy the fragments" },
      ],
    }),
  );
  const next = applyArcDelta(arc, delta);
  assert.equal(next.events.length, 3, "only the genuinely new event is added");
  assert.equal(next.events.filter((e) => e.name === "Marl offers to guide them").length, 1);
  assert.equal(next.cast.length, 3, "only the genuinely new NPC is added");
  assert.equal(next.cast.filter((c) => c.name === "Sexton Marl").length, 1);

  // Same guard on the extension path, which is where it was first observed.
  const extension = parseArcExtensionJson(
    JSON.stringify({
      beats: ["New act beat one", "New act beat two", "New act beat three"],
      finale: "A new ending.",
      newEvents: [
        { kind: "betrayal", name: "Ivry seals them in", detail: "echoed back", trigger: "t" },
      ],
    }),
  );
  for (const beat of arc.beats) {
    beat.status = "done";
  }
  const extended = applyArcExtension(arc, extension);
  assert.equal(extended.events.filter((e) => e.name === "Ivry seals them in").length, 1);
});

console.log(`${passed} arc tests passed`);
