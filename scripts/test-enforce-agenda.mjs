// A lasting companion's hidden agenda (issue 503 Phase 8), through the
// engine: a hidden employer given at add_companion is a storyteller secret
// (the AI's own section has it to foreshadow; the lead of an AI table reads
// it nowhere; a person running a table reads it on the Bonds tab); the
// employer's order comes on the agency dice and breaks the party's trust, so
// the conscience decides what the companion does; a cast member of the arc
// whose betrayal is pending brings it when it joins, and the order marks it
// delivered.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-agenda");
const npcs = await import("../src/lib/db/npcs.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const factions = await import("../src/lib/db/factions.ts");
const { companionAgenda } = await import("../src/lib/db/companion-agenda.ts");
const departuresDb = await import("../src/lib/db/companion-departures.ts");
const { getParty } = await import("../src/lib/db/party.ts");
const { agendaLinesForPrompt } = await import("../src/lib/dm/companion-agenda.ts");
const { advanceNpcAgency } = await import("../src/lib/dm/npc-agency.ts");
const { buildDmMessages } = await import("../src/lib/dm/prompt.ts");
const { storytellerLinesForPrompt } = await import("../src/lib/dm/scheme-tools.ts");
const { conscienceViews } = await import("../src/lib/dm/conscience.ts");
const { normalizeStoryArc } = await import("../src/lib/dm/arc-logic.ts");

const SECRET = /Ashen Hand|steal the map/i;
const AGENDA = { employer: "the Ashen Hand", aim: "steal the map" };

async function table({ gameSettings = {}, axes = {}, heroes = 2, companion = {} } = {}) {
  const world = await openWorld({ gameSettings: { companions: "full", ...gameSettings } });
  for (let index = 0; index < heroes; index += 1) {
    world.addHero({ name: index ? `Hero ${index + 1}` : "Kael" });
  }
  const added = await world.invoke("add_companion", { name: "Seren", class: "rogue", gender: "Female", personality: "Quiet.", kind: "party", ...companion });
  assert.equal(added.ok, true, added.error);
  const row = () => npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
  npcs.patchNpcAgency(row().id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0, ...axes } });
  const still = () => world.sheets().some((sheet) => sheet.name === "Seren");
  // The order comes: every round of the agency dice a success.
  const order = () => {
    const target = companionAgenda(row().id).target;
    world.dice(new Array(target).fill(20));
    advanceNpcAgency(world.campaignId, "", { rounds: target, tickPressureCounters: false });
    world.clearDice();
  };
  return { world, added, row, still, order };
}

async function get(world, user, route, query = "") {
  world.signIn(user);
  const handler = await world.route(route);
  const response = await handler.GET(new Request(`http://test/${query}`), { params: Promise.resolve({ campaignId: world.campaignId }) });
  const body = await response.json();
  return { status: response.status, body, text: JSON.stringify(body) };
}

await test("a hidden employer is the storyteller's: the AI has it to foreshadow, and the lead of an AI table reads it nowhere", async () => {
  const { world, added, row } = await table({ companion: { agenda: AGENDA } });
  assert.doesNotMatch(JSON.stringify(added.result), SECRET, "the call's result names nothing");
  assert.deepEqual({ ...companionAgenda(row().id) }, { employer: "the Ashen Hand", aim: "steal the map", progress: 0, target: 3, ordered: false, eventId: "" });
  const lines = agendaLinesForPrompt(world.sheets());
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Seren secretly answers to the Ashen Hand: steal the map\. Foreshadow it/);
  const bonds = await get(world, world.owner, "campaigns/[campaignId]/relationships");
  assert.equal(bonds.status, 200);
  assert.doesNotMatch(bonds.text, SECRET);
  const secrets = await get(world, world.owner, "campaigns/[campaignId]/facts", "?secrets=1");
  assert.doesNotMatch(secrets.text, SECRET);
  const campaign = world.campaign();
  const sheets = world.sheets();
  const state = {
    campaign,
    members: campaigns.listMembers(world.campaignId),
    sheets,
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    storytellerLines: [...storytellerLinesForPrompt(campaign, sheets, []), ...lines],
  };
  const conversation = buildDmMessages(state, []);
  assert.match(conversation.map((message) => message.content).join("\n"), /secretly answers to the Ashen Hand/, "the AI has it");
  const turn = turns.createDmTurn(world.campaignId, conversation);
  turn.contextTrace = state.contextTrace;
  turns.saveDmTurn(turn);
  const trace = await get(world, world.owner, "campaigns/[campaignId]/context-trace");
  assert.equal(trace.status, 200);
  assert.doesNotMatch(trace.text, SECRET, "not on the lead's Context tab");
});

await test("at a table a person runs, that person reads the secret on the Bonds tab", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "human", companions: "full" } });
  const lead = world.addUser("lead");
  const pc = world.addHero({ user: lead, name: "Kael" });
  const added = await world.invoke("add_companion", { name: "Seren", class: "rogue", gender: "Female", personality: "Quiet.", kind: "party", agenda: AGENDA });
  assert.equal(added.ok, true, added.error);
  const relationships = await import("../src/lib/db/relationships.ts");
  relationships.ensureRelationship({ campaignId: world.campaignId, characterId: pc.id, characterName: pc.name, subjectKind: "companion", subjectName: "Seren" });
  const bonds = await get(world, world.owner, "campaigns/[campaignId]/relationships");
  const row = bonds.body.relationships.find((entry) => entry.subjectName === "Seren" && entry.conscience);
  assert.equal(row?.conscience?.agenda, "answers to the Ashen Hand: steal the map");
});

await test("the employer's order comes on the agency dice and breaks the party's trust: a timid companion walks out", async () => {
  const { world, row, still, order } = await table({ companion: { agenda: AGENDA }, axes: { boldness: -2 } });
  order();
  assert.equal(companionAgenda(row().id).ordered, true);
  assert.equal(still(), false, "she is gone");
  const gone = departuresDb.companionDeparture(row().id).gone;
  assert.equal(gone.response, "walk_out");
  assert.match(agendaLinesForPrompt(world.sheets()).join(" "), /^$/, "no line for one who has gone");
});

await test("a dutiful companion reports to the employer the table tracks, and the party's standing there falls", async () => {
  const { world, row, order } = await table({ companion: { agenda: AGENDA }, axes: { diligence: 3 } });
  const hand = factions.insertFaction(world.campaignId, { name: "the Ashen Hand", power: 2 });
  order();
  const gone = departuresDb.companionDeparture(row().id).gone;
  assert.equal(gone.response, "report");
  assert.equal(gone.reportedTo, "the Ashen Hand");
  assert.equal(getParty(world.campaignId).reputation[hand.id], -2);
});

await test("at a Talk table the order sets her at her breaking point and she stays; the line tells the AI the order has come", async () => {
  const { world, row, still, order } = await table({ gameSettings: { companionConscience: "talk" }, companion: { agenda: AGENDA }, axes: { boldness: -2 } });
  order();
  assert.ok(still());
  assert.equal(conscienceViews(world.campaign()).get("seren").rung, "breaking");
  assert.match(agendaLinesForPrompt(world.sheets())[0], /The order has come and broken their trust/);
  void row;
});

await test("a cast member whose arc betrayal is pending brings it when she joins, and the order marks it delivered", async () => {
  const world = await openWorld({ gameSettings: { companions: "full", companionConscience: "talk" } });
  world.addHero({ name: "Kael" });
  campaigns.setStoryArc(world.campaignId, normalizeStoryArc({
    version: 3,
    premise: "A coast of smugglers.",
    beats: [{ text: "Meet the guide", status: "pending", act: 1 }, { text: "Cross the marsh", status: "pending", act: 1 }],
    acts: 1,
    finale: "",
    saga: null,
    cast: [{ id: "np1", name: "Seren", role: "guide", agenda: "deliver the party to the smugglers", status: "active" }],
    events: [{ id: "ev1", kind: "betrayal", name: "The guide's knife", detail: "Seren leads them into the ambush", trigger: "", actHint: null, castId: "np1", status: "pending" }],
    subArcs: [],
    worldArcs: [],
    updatedAt: "2026-10-23T00:00:00.000Z",
  }));
  const added = await world.invoke("add_companion", { name: "Seren", class: "rogue", gender: "Female", personality: "Quiet.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  const row = npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
  const agenda = companionAgenda(row.id);
  assert.equal(agenda.aim, "deliver the party to the smugglers");
  assert.equal(agenda.eventId, "ev1");
  world.dice(new Array(agenda.target).fill(20));
  advanceNpcAgency(world.campaignId, "", { rounds: agenda.target, tickPressureCounters: false });
  world.clearDice();
  assert.equal(world.campaign().storyArc.events.find((event) => event.id === "ev1").status, "fired", "the arc's betrayal is delivered");
});

finish();
