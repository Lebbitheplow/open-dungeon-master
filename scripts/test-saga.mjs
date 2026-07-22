// Saga tier: length profiles, saga parsing/normalization, lazy act
// detailing, the v2 -> v3 upgrade, sequel chaining, and the clamped
// beat-rewrite/sketch-update delta extensions.
import assert from "node:assert/strict";
import {
  applyActDetail,
  applyArcDelta,
  applyArcUpgrade,
  applySagaChain,
  arcExhausted,
  completeBeat,
  extractPreviousResolution,
  lengthProfile,
  needsSagaUpgrade,
  nextSketchAct,
  normalizeStoryArc,
  parseActDetailJson,
  parseArcDeltaJson,
  parseSagaJson,
  parseSagaUpgradeJson,
  renderArcForPrompt,
  sagaComplete,
} from "../src/lib/dm/arc-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const standard = lengthProfile("standard");

const validSagaJson = JSON.stringify({
  title: "The Drowned Crown",
  premise: "A dead god's heart is waking beneath the city.",
  stakes: "If it beats again, the city drowns in divine fire.",
  antagonist: "Vicar Osseth, who wants the god reborn.",
  actPlan: [
    {
      milestone: "The party uncovers the abductions and names Osseth",
      boss: { name: "The Undercroft Warden", detail: "A flesh-bound gate guardian" },
      allies: ["Sexton Marl offers to guide them"],
      hooks: ["Runa's drake senses the god's heartbeat"],
    },
    {
      milestone: "The first heartbeat shatters the temple district",
      boss: { name: "Captain Ivry", detail: "Turned, holding the sealed gates" },
      allies: [],
      hooks: [],
    },
    {
      milestone: "The seal fragments are reforged",
      boss: { name: "The Reliquary Echo", detail: "A memory of the god given teeth" },
      allies: ["Smith Halt joins for the descent"],
      hooks: ["Tam's familiar can hear the seal's true name"],
    },
    {
      milestone: "Descent to the sunken sanctum to still the heart",
      boss: { name: "Vicar Osseth Ascendant", detail: "Half-merged with the waking god" },
      allies: [],
      hooks: [],
    },
  ],
  act1Beats: [
    "The party notices the tremors and the missing clergy",
    "They trace the disappearances to the undercroft",
    "Osseth is revealed as the abductor",
  ],
  finale: "Still or wake the heart in the sunken sanctum.",
  finaleBoss: { name: "Vicar Osseth Ascendant", detail: "Half-merged with the waking god" },
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

test("length profiles scale acts and side quests", () => {
  assert.deepEqual(lengthProfile("short"), {
    minActs: 3,
    maxActs: 3,
    actsText: "exactly 3",
    subArcsText: "2 to 3",
  });
  assert.equal(lengthProfile("standard").maxActs, 5);
  assert.equal(lengthProfile("epic").minActs, 6);
  assert.equal(lengthProfile("epic").maxActs, 8);
});

test("a clean saga parses: act-1 beats only, later acts stay sketches", () => {
  const arc = parseSagaJson(validSagaJson, standard);
  assert.ok(arc);
  assert.equal(arc.version, 3);
  assert.equal(arc.beats.length, 3);
  assert.ok(arc.beats.every((beat) => beat.act === 1));
  assert.equal(arc.beats[0].status, "active");
  assert.equal(arc.acts, 1);
  assert.ok(arc.saga);
  assert.equal(arc.saga.title, "The Drowned Crown");
  assert.equal(arc.saga.plannedActs, 4);
  assert.equal(arc.saga.sagaIndex, 1);
  assert.deepEqual(
    arc.saga.sketches.map((sketch) => sketch.status),
    ["detailed", "sketch", "sketch", "sketch"],
  );
  assert.equal(arc.saga.sketches[1].boss.name, "Captain Ivry");
  assert.equal(arc.saga.finaleBoss.name, "Vicar Osseth Ascendant");
  assert.equal(needsSagaUpgrade(arc), false);
  assert.equal(sagaComplete(arc), false);
  assert.equal(nextSketchAct(arc).act, 2);
});

test("garbage actPlan degrades to a saga-less arc instead of failing", () => {
  const record = JSON.parse(validSagaJson);
  record.actPlan = "not an array";
  const arc = parseSagaJson(JSON.stringify(record), standard);
  assert.ok(arc, "the core arc must survive a broken saga layer");
  assert.equal(arc.saga, null);
  assert.ok(needsSagaUpgrade(arc));
  assert.equal(nextSketchAct(arc), null);
  assert.equal(sagaComplete(arc), false, "a saga-less arc never reports saga completion");
});

test("code fences and reasoning chatter still parse", () => {
  const arc = parseSagaJson(
    `<think>plotting...</think>\n\`\`\`json\n${validSagaJson}\n\`\`\``,
    standard,
  );
  assert.ok(arc);
  assert.ok(arc.saga);
});

test("stored v3 arcs round-trip; a corrupt saga degrades without killing the arc", () => {
  const arc = parseSagaJson(validSagaJson, standard);
  const restored = normalizeStoryArc(JSON.parse(JSON.stringify(arc)));
  assert.ok(restored.saga);
  assert.equal(restored.saga.plannedActs, 4);
  assert.deepEqual(
    restored.saga.sketches.map((sketch) => sketch.act),
    [1, 2, 3, 4],
  );

  const corrupted = JSON.parse(JSON.stringify(arc));
  corrupted.saga = { title: 42, sketches: "gone" };
  const degraded = normalizeStoryArc(corrupted);
  assert.ok(degraded, "the arc itself survives");
  assert.equal(degraded.saga, null);
});

function playedThroughAct(arc) {
  let current = arc;
  for (let number = 1; number <= current.beats.length; number += 1) {
    if (current.beats[number - 1].status === "done") {
      continue;
    }
    const advanced = completeBeat(current, number);
    assert.ok(advanced);
    current = advanced.arc;
  }
  return current;
}

test("act detail turns the next sketch into real beats with the boss as an event", () => {
  const finished = playedThroughAct(parseSagaJson(validSagaJson, standard));
  assert.ok(arcExhausted(finished));
  assert.equal(sagaComplete(finished), false, "sketches remain, so the saga is not done");

  const detail = parseActDetailJson(
    JSON.stringify({
      beats: [
        "The heartbeat cracks the temple square",
        "Ivry seals the district gates",
        "The party breaks the blockade",
      ],
      milestone: "The first heartbeat shatters the temple district",
      finale: "Reach the reliquary before the second beat.",
      bossEvent: {
        kind: "setpiece",
        name: "Captain Ivry at the sealed gate",
        detail: "Ivry holds the only way out, bought and armored",
        trigger: "when the party tries to leave the temple district",
        actHint: null,
      },
      newEvents: [],
      newCast: [],
    }),
  );
  assert.ok(detail);
  const next = applyActDetail(finished, detail);
  assert.equal(next.acts, 2);
  assert.equal(next.beats.length, 6);
  assert.equal(next.beats[3].act, 2);
  assert.equal(next.beats[3].status, "active", "[NOW] reseats onto the new act");
  assert.equal(next.beats[0].status, "done", "old beats untouched");
  assert.equal(next.saga.sketches[0].status, "done");
  assert.equal(next.saga.sketches[1].status, "detailed");
  const boss = next.events.find((event) => event.name === "Captain Ivry at the sealed gate");
  assert.ok(boss);
  assert.equal(boss.actHint, 2, "the boss event lands in the new act");
  assert.equal(arcExhausted(next), false);
  // Original untouched.
  assert.equal(finished.acts, 1);
});

test("act detail refuses to fire without a waiting sketch", () => {
  const arc = parseSagaJson(validSagaJson, standard);
  arc.saga.sketches.forEach((sketch) => {
    if (sketch.status === "sketch") {
      sketch.status = "done";
    }
  });
  const detail = parseActDetailJson(
    '{"beats": ["One thing", "Another thing"], "finale": "x", "bossEvent": null}',
  );
  assert.equal(applyActDetail(arc, detail), arc, "returns the arc unchanged");
});

test("act detail with too few beats yields null", () => {
  assert.equal(parseActDetailJson('{"beats": ["only one"], "finale": "x"}'), null);
  assert.equal(parseActDetailJson("no json"), null);
});

test("saga completes only when beats are settled AND no sketch remains", () => {
  let arc = parseSagaJson(validSagaJson, standard);
  arc.saga.sketches.forEach((sketch) => {
    if (sketch.status === "sketch") {
      sketch.status = "done";
    }
  });
  assert.equal(sagaComplete(arc), false, "open beats keep the saga alive");
  arc = playedThroughAct(arc);
  assert.equal(sagaComplete(arc), true);
});

test("v2 arcs upgrade in place: past acts synthesized, future acts appended", () => {
  const v2 = normalizeStoryArc({
    premise: "An old campaign already in progress.",
    beats: [
      { text: "First act opener", status: "done", act: 1 },
      { text: "First act closer", status: "done", act: 1 },
      { text: "Second act opener", status: "active", act: 2 },
      { text: "Second act closer", status: "pending", act: 2 },
    ],
    cast: [{ id: "np1", name: "Ivry", role: "captain", agenda: "seal the gates", status: "active" }],
    events: [],
  });
  assert.ok(needsSagaUpgrade(v2));
  const upgrade = parseSagaUpgradeJson(
    JSON.stringify({
      title: "The Long Siege",
      plannedActs: 4,
      sketches: [
        {
          milestone: "The gates fall and the siege turns inward",
          boss: { name: "The Siege-Saint", detail: "Ivry's patron revealed" },
          allies: ["A deserter opens a postern"],
          hooks: [],
        },
        {
          milestone: "The Siege-Saint's reliquary is burned",
          boss: { name: "The Siege-Saint Unbound", detail: "Free of the reliquary" },
          allies: [],
          hooks: [],
        },
      ],
      finaleBoss: { name: "The Siege-Saint Unbound", detail: "Free of the reliquary" },
    }),
  );
  assert.ok(upgrade);
  const next = applyArcUpgrade(v2, upgrade);
  assert.ok(next.saga);
  assert.equal(next.saga.title, "The Long Siege");
  assert.equal(next.saga.plannedActs, 4);
  assert.deepEqual(
    next.saga.sketches.map((sketch) => [sketch.act, sketch.status]),
    [
      [1, "done"],
      [2, "detailed"],
      [3, "sketch"],
      [4, "sketch"],
    ],
  );
  assert.equal(next.saga.sketches[0].milestone, "First act opener");
  assert.deepEqual(
    next.beats.map((beat) => beat.text),
    v2.beats.map((beat) => beat.text),
    "beat text untouched",
  );
  assert.equal(next.beats[2].status, "active", "beat statuses untouched");
  assert.equal(applyArcUpgrade(next, upgrade), next, "an arc with a saga never re-upgrades");
});

test("a concluded saga chains into a sequel carrying threads, cast, and history", () => {
  let first = parseSagaJson(validSagaJson, standard);
  first.saga.sketches.forEach((sketch) => {
    if (sketch.status === "sketch") {
      sketch.status = "done";
    }
  });
  first = playedThroughAct(first);
  assert.ok(sagaComplete(first));

  const sequelJson = JSON.parse(validSagaJson);
  sequelJson.title = "The Ash Concordat";
  sequelJson.premise = "The stilled god's ashes are being gathered by a new church.";
  sequelJson.previousResolution = "The heart was stilled and Osseth fell into the sanctum.";
  sequelJson.subArcs = [
    {
      name: "The Missing Sexton",
      goal: "Find sexton Marl before the next tremor",
      hook: "echoed back by the model",
      beats: [],
    },
  ];
  const raw = JSON.stringify(sequelJson);
  const sequel = parseSagaJson(raw, standard);
  assert.ok(sequel);
  const chained = applySagaChain(first, sequel, extractPreviousResolution(raw));
  assert.equal(chained.saga.sagaIndex, 2);
  assert.equal(chained.saga.priorSagas.length, 1);
  assert.equal(chained.saga.priorSagas[0].title, "The Drowned Crown");
  assert.equal(
    chained.saga.priorSagas[0].resolution,
    "The heart was stilled and Osseth fell into the sanctum.",
  );
  assert.equal(chained.premise, sequelJson.premise);
  assert.ok(
    chained.beats.every((beat) => beat.status !== "done"),
    "the sequel starts with fresh beats",
  );
  // The still-open thread from the old saga is not duplicated (the sequel
  // already lists it), and the old cast carried over without duplicates.
  assert.equal(
    chained.subArcs.filter((subArc) => subArc.name === "The Missing Sexton").length,
    1,
  );
  assert.equal(chained.cast.filter((npc) => npc.name === "Sexton Marl").length, 1);
  const render = renderArcForPrompt(chained);
  assert.ok(render.includes("Saga 2 (sequel)"));
  assert.ok(render.includes('Previously concluded: "The Drowned Crown"'));
});

test("prior sagas cap at 3 across repeated chains", () => {
  let arc = parseSagaJson(validSagaJson, standard);
  for (let round = 0; round < 4; round += 1) {
    arc.saga.sketches.forEach((sketch) => {
      if (sketch.status === "sketch") {
        sketch.status = "done";
      }
    });
    arc = playedThroughAct(arc);
    const sequel = parseSagaJson(validSagaJson, standard);
    arc = applySagaChain(arc, sequel, `Ending ${round + 1}`);
  }
  assert.equal(arc.saga.sagaIndex, 5);
  assert.equal(arc.saga.priorSagas.length, 3);
  assert.equal(arc.saga.priorSagas[2].resolution, "Ending 4");
});

test("beat rewrites land only on unplayed beats of the current act", () => {
  const arc = parseSagaJson(validSagaJson, standard);
  const advanced = completeBeat(arc, 1).arc;
  const delta = parseArcDeltaJson(
    JSON.stringify({
      beatRewrites: [
        { beat: 1, text: "Rewriting a done beat is refused" },
        { beat: 3, text: "The abductor is revealed as Osseth's double" },
      ],
    }),
  );
  const next = applyArcDelta(advanced, delta);
  assert.equal(next.beats[0].text, "The party notices the tremors and the missing clergy");
  assert.equal(next.beats[2].text, "The abductor is revealed as Osseth's double");
});

test("beat rewrites cap at 2 and never touch other acts", () => {
  const detailInput = parseActDetailJson(
    '{"beats": ["Act two first", "Act two second"], "finale": "x", "bossEvent": null}',
  );
  const twoActs = applyActDetail(playedThroughAct(parseSagaJson(validSagaJson, standard)), detailInput);
  const delta = parseArcDeltaJson(
    JSON.stringify({
      beatRewrites: [
        { beat: 1, text: "past-act rewrite refused" },
        { beat: 4, text: "Act two first, rewritten" },
        { beat: 5, text: "capped out" },
      ],
    }),
  );
  assert.equal(delta.beatRewrites.length, 2, "parser caps at 2");
  const next = applyArcDelta(twoActs, delta);
  assert.equal(next.beats[0].text, "The party notices the tremors and the missing clergy");
  assert.equal(next.beats[3].text, "Act two first, rewritten");
});

test("sketch updates revise only future sketches; boss null clears it", () => {
  const arc = parseSagaJson(validSagaJson, standard);
  const delta = parseArcDeltaJson(
    JSON.stringify({
      sketchUpdates: [
        { act: 1, milestone: "detailed acts are refused" },
        { act: 2, boss: null, milestone: "Ivry already fell; the gates hold themselves" },
      ],
    }),
  );
  const next = applyArcDelta(arc, delta);
  assert.equal(next.saga.sketches[0].milestone, arc.saga.sketches[0].milestone);
  assert.equal(next.saga.sketches[1].boss, null);
  assert.equal(next.saga.sketches[1].milestone, "Ivry already fell; the gates hold themselves");
  assert.equal(next.saga.sketches[2].boss.name, "The Reliquary Echo", "untouched sketches keep bosses");
});

test("the render shows the saga header, future sketches capped, and stays bounded", () => {
  const epicJson = JSON.parse(validSagaJson);
  epicJson.actPlan = Array.from({ length: 8 }, (_, index) => ({
    milestone: `Milestone for act ${index + 1}`,
    boss: { name: `Boss ${index + 1}`, detail: "A terror" },
    allies: ["An ally arrives"],
    hooks: ["A pet moment"],
  }));
  const arc = parseSagaJson(JSON.stringify(epicJson), lengthProfile("epic"));
  const render = renderArcForPrompt(arc);
  assert.ok(render.includes('Saga: "The Drowned Crown", act 1 of 8 planned.'));
  assert.ok(render.includes("Act 2 (ahead, sketch only): Milestone for act 2 | planned boss: Boss 2"));
  assert.ok(render.includes("planned allies: An ally arrives"), "next sketch renders in full");
  assert.ok(!render.includes("Act 5 (ahead"), "future sketches cap at 3");
  assert.ok(render.includes("(...and 4 more sketched acts before the finale)"));
  assert.ok(render.includes("final boss: Vicar Osseth Ascendant"));
  assert.ok(render.length < 4600);
});

test("an exhausted act renders the breather line; a finished saga the aftermath line", () => {
  const exhausted = playedThroughAct(parseSagaJson(validSagaJson, standard));
  const betweenActs = renderArcForPrompt(exhausted);
  assert.ok(betweenActs.includes("the next act will be planned at the chapter break"));

  exhausted.saga.sketches.forEach((sketch) => {
    if (sketch.status === "sketch") {
      sketch.status = "done";
    }
  });
  const finished = renderArcForPrompt(exhausted);
  assert.ok(finished.includes("a sequel saga will be planned at the chapter break"));
});

test("finished acts collapse to their sketch milestone in the render", () => {
  const detailInput = parseActDetailJson(
    '{"beats": ["Act two first", "Act two second"], "finale": "x", "bossEvent": null}',
  );
  const twoActs = applyActDetail(playedThroughAct(parseSagaJson(validSagaJson, standard)), detailInput);
  const render = renderArcForPrompt(twoActs);
  assert.ok(
    render.includes("Act 1 (finished): The party uncovers the abductions and names Osseth"),
  );
  assert.ok(!render.includes("1. [done]"), "finished act beats are not itemized");
});

console.log(`${passed} saga tests passed`);
