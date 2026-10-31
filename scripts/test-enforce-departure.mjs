// A companion leaving the party and coming back (issue 503 Phases 2 and 3),
// through the engine the way the DM reaches it, with the dice under the
// test's control.
//
// At a Leave table a companion at its breaking point does what the server
// decides from who it is and the odds: a timid one walks out at once, a
// composed one holds a plan and goes at its opening (the night watch of a
// long rest, its own turn in a fight, whoever commanded it), a dutiful one
// reports the party and its standing falls. Turn lets one confront the
// party or bide until the party is weak, and then it turns where it stands:
// its own sheet on the foes' side, of the fight running or of one the server
// starts; after the fight it leaves, fell, or lies at the party's mercy. Talk and Off never depart anyone. A departure keeps the sheet; one
// who left hating the party gathers help on the agency dice, leaving
// rumours, kept pace with the party's experience, and comes back in a
// prepared fight budgeted under the table's ceiling, fighting as its own
// sheet on the foes' side, or to parley once its standing has climbed back. A held plan is the storyteller's alone: the
// lead of an AI table reads it nowhere, a person running a table does.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-departure");
const npcs = await import("../src/lib/db/npcs.ts");
const relationships = await import("../src/lib/db/relationships.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const messages = await import("../src/lib/db/messages.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const conscienceDb = await import("../src/lib/db/companion-conscience.ts");
const departuresDb = await import("../src/lib/db/companion-departures.ts");
const factions = await import("../src/lib/db/factions.ts");
const { getParty } = await import("../src/lib/db/party.ts");
const { listCalendarEvents } = await import("../src/lib/db/calendar-events.ts");
const { listActiveFacts } = await import("../src/lib/db/facts.ts");
const { listEncounterTemplates } = await import("../src/lib/db/encounter-templates.ts");
const { departureOpenings, intentLinesForPrompt, settleDepartures } = await import("../src/lib/dm/departure.ts");
const { returnDirectorNotes } = await import("../src/lib/dm/companion-revenge.ts");
const { returningCombatant } = await import("../src/lib/dm/companion-return.ts");
const { sideOf } = await import("../src/lib/dm/combatant.ts");
const { applyWear, slotPools } = await import("../src/lib/dm/companion-statblock.ts");
const { advanceNpcAgency } = await import("../src/lib/dm/npc-agency.ts");
const { deployTemplate, templateDifficulty } = await import("../src/lib/dm/encounter-templates.ts");
const { conscienceBlockForPrompt, conscienceSecretLines, conscienceViews, STORYTELLER_VIEW } = await import("../src/lib/dm/conscience.ts");
const { buildDmMessages } = await import("../src/lib/dm/prompt.ts");
const { storytellerLinesForPrompt } = await import("../src/lib/dm/scheme-tools.ts");

// A table with a lasting paladin who holds the innocent as a red line, her
// nature set so the response is the one a test means.
async function table({ gameSettings = {}, axes = {}, heroes = 1, level = 1, companion = {} } = {}) {
  // Lasting companions at any size of table, as a lead may set it.
  const world = await openWorld({ gameSettings: { companions: "full", ...gameSettings } });
  const party = [world.addHero({ name: "Kael", gender: "Male", level })];
  for (let index = 1; index < heroes; index += 1) {
    party.push(world.addHero({ name: `Hero ${index + 1}`, level }));
  }
  const added = await world.invoke("add_companion", {
    name: "Seren",
    class: "paladin",
    gender: "Female",
    alignment: "LG",
    personality: "Stern and devout.",
    kind: "party",
    ...companion,
  });
  assert.equal(added.ok, true, added.error);
  const sheet = world.sheets().find((entry) => entry.name === "Seren");
  const row = () => npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
  npcs.patchNpcAgency(row().id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0, ...axes } });
  const pc = party[0];
  const atrocity = () => world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "murder_helpless", severity: "atrocity", note: "Kael cut the bound prisoner's throat." });
  const departure = () => departuresDb.companionDeparture(row().id);
  return { world, pc, party, sheet, row, atrocity, departure, still: () => Boolean(world.sheet(sheet.id)) };
}

async function get(world, user, route, query = "") {
  world.signIn(user);
  const handler = await world.route(route);
  const response = await handler.GET(new Request(`http://test/${query}`), { params: Promise.resolve({ campaignId: world.campaignId }) });
  const body = await response.json();
  return { status: response.status, body, text: JSON.stringify(body) };
}

const lastLine = (world) => messages.listRecentMessages(world.campaignId, 4).map((message) => message.content).join("\n");

await test("a red-line atrocity walks a timid companion out at once at a Leave table, and her sheet is kept", async () => {
  const { world, row, atrocity, departure, still, sheet } = await table({ axes: { boldness: -2 } });
  const done = await atrocity();
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.departed, "Walked out on the party");
  assert.match(done.result.note, /Seren walked out on the party: the server has taken them out of the party \(their sheet is kept\)/);
  assert.match(done.result.note, /never call dismiss_companion/);
  assert.equal(still(), false, "out of the party");
  assert.ok(conscienceDb.departedSheet(row().id), "the row keeps her sheet");
  assert.equal(departure().gone.response, "walk_out");
  assert.equal(departure().gone.avenging, true, "she left hating them: she gathers help");
  assert.match(lastLine(world), /Seren walked out on the party\./, "the table is told by the server");
  const gone = await get(world, world.owner, "campaigns/[campaignId]/companions/gone");
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.body.gone.map((entry) => [entry.name, entry.how]), [["Seren", "Walked out on the party"]]);
  // The sheet she had in the party: the story log keeps her lines hers.
  assert.equal(gone.body.gone[0].sheetId, sheet.id);
});

// The line a companion leaves on is spoken by the row behind them, not the
// sheet that has just gone, and the story log finds that row's face in the
// cast. The row was made with no portrait, so the line showed a letter
// (issue 660): it takes the sheet's face as she goes, and the table's cast is
// sent again so the line finds it without a reload.
await test("a companion who walks out gives her face to the row that speaks her parting line, and the cast is sent with it", async () => {
  const { world, row, atrocity, sheet } = await table({ axes: { boldness: -2 } });
  const { patchSheet } = await import("../src/lib/db/sheets.ts");
  const { publicCast } = await import("../src/lib/dm/cast.ts");
  const { subscribe } = await import("../src/lib/events.ts");
  patchSheet(sheet.id, { portrait: { url: "/uploads/seren-face.png" } });
  assert.equal(row().portraitUrl, "", "the row behind her has no face of its own");
  const sent = [];
  const stop = subscribe(world.campaignId, (chunk) => sent.push(chunk));
  try {
    const done = await atrocity();
    assert.equal(done.result.departed, "Walked out on the party");
  } finally {
    stop();
  }
  assert.equal(row().portraitUrl, "/uploads/seren-face.png");
  const member = publicCast(world.campaignId).find((entry) => entry.name === "Seren");
  assert.equal(member?.portraitUrl, "/uploads/seren-face.png", "the cast carries her face");
  const castSent = sent.filter((chunk) => /^event: cast_updated$/m.test(chunk));
  assert.ok(castSent.some((chunk) => chunk.includes("/uploads/seren-face.png")), "the table is sent the cast with her face");
});

// A face the row already had, one the GM gave the person before she joined,
// is kept.
await test("a companion row that already has a face keeps it when she leaves", async () => {
  const { row, atrocity, sheet } = await table({ axes: { boldness: -2 } });
  const { patchSheet } = await import("../src/lib/db/sheets.ts");
  patchSheet(sheet.id, { portrait: { url: "/uploads/seren-face.png" } });
  npcs.setNpcPortrait(row().id, "/uploads/seren-before.png");
  await atrocity();
  assert.equal(row().portraitUrl, "/uploads/seren-before.png");
});

// One with no portrait showed the painted plate for her class and ancestry
// on every line while she travelled with the party, and a letter on the one
// she left on (issue 660). The cast carries that plate for the row, worked
// out from her kept sheet and never written onto the row, so a portrait
// painted for her later still comes first.
await test("a companion with no portrait leaves on her class and ancestry's plate, and a portrait painted later comes first", async () => {
  const { world, row, atrocity, sheet } = await table({ axes: { boldness: -2 } });
  const { publicCast } = await import("../src/lib/dm/cast.ts");
  const { castFaces, speakerFaces } = await import("../src/lib/speaker-faces.ts");
  assert.equal(world.sheet(sheet.id).portrait ?? null, null, "she has no portrait");
  const earlier = speakerFaces({ kind: "pc", id: sheet.id, name: "Seren" }, new Map([[sheet.id, world.sheet(sheet.id)]]));
  assert.equal(earlier.length, 1, "her lines in the party showed her plate");
  await atrocity();
  assert.equal(row().portraitUrl, "", "nothing is written onto the row");
  const member = publicCast(world.campaignId).find((entry) => entry.name === "Seren");
  assert.deepEqual(castFaces(member), earlier, "her parting line shows the plate her earlier lines did");
  npcs.setNpcPortrait(row().id, "/uploads/seren-painted.png");
  const painted = publicCast(world.campaignId).find((entry) => entry.name === "Seren");
  assert.deepEqual(castFaces(painted), ["/uploads/seren-painted.png", earlier[0]]);
  // The story log, the theatre inserts and the speaker picker all draw an
  // NPC's face through it.
  const fs = await import("node:fs");
  for (const file of ["SpeechLine.tsx", "TheatreInserts.tsx", "SpeakerPicker.tsx"]) {
    assert.match(fs.readFileSync(new URL(`../src/app/campaigns/[campaignId]/${file}`, import.meta.url), "utf8"), /castFaces\(cast\.find\(/, file);
  }
});

// A companion who comes back is a new sheet (finalizeNewCompanion), and the
// chronicle's lines from before they left name the sheet they had then: the
// card the player played for her, her speech, the GM's own history.
await test("a companion who leaves and comes back keeps the lines from before she left: her card, her speech and the GM's history find her live sheet", async () => {
  const { world, pc, sheet, atrocity } = await table({ axes: { boldness: -2 } });
  const { transcriptSheets } = await import("../src/app/campaigns/[campaignId]/departing.ts");
  const { speakerFaces } = await import("../src/lib/speaker-faces.ts");
  const card = messages.insertCampaignMessage({
    campaignId: world.campaignId,
    seq: campaigns.allocateSeq(world.campaignId),
    authorType: "player",
    content: "I loose an arrow at the captain with my Longbow.",
    userId: pc.userId,
    characterId: sheet.id,
  });
  const done = await atrocity();
  assert.equal(done.result.departed, "Walked out on the party");
  assert.equal(world.sheet(sheet.id), null, "her sheet left the party");
  const back = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Home.", kind: "party" });
  assert.equal(back.ok, true, back.error);
  assert.equal(back.result.returned, true);
  const live = world.sheets().find((entry) => entry.name === "Seren");
  assert.notEqual(live.id, sheet.id, "a return builds a new sheet");
  assert.deepEqual(live.formerSheetIds, [sheet.id], "and records the one she had");
  // The story log: the card and her speech find the live sheet.
  const byId = transcriptSheets(world.sheets(), [], []);
  assert.equal(byId.get(sheet.id)?.id, live.id);
  assert.equal(byId.get(sheet.id)?.name, "Seren");
  assert.deepEqual(speakerFaces({ kind: "pc", id: sheet.id, name: "Seren" }, byId), speakerFaces({ kind: "pc", id: live.id, name: "Seren" }, byId));
  // The GM's history named the old line "Unknown".
  const history = buildDmMessages({ campaign: world.campaign(), members: campaigns.listMembers(world.campaignId), sheets: world.sheets(), recentRolls: [], storySummary: "", contextLimitTokens: 32_000 }, [card]);
  const line = history.map((entry) => entry.content).find((content) => content.includes("Longbow")) ?? "";
  assert.match(line, /Seren/, line);
  assert.doesNotMatch(line, /Unknown/, line);
  // Server-only: no sheet edit writes it, and no input schema carries it.
  const { patchSheet } = await import("../src/lib/db/sheets.ts");
  const { createSheetSchema, patchSheetSchema, fullPatchSheetSchema } = await import("../src/lib/schemas/sheet.ts");
  patchSheet(live.id, { formerSheetIds: [], notes: "edited" });
  assert.deepEqual(world.sheet(live.id).formerSheetIds, [sheet.id], "an edit leaves it");
  assert.ok(!("formerSheetIds" in (createSheetSchema.safeParse({ ...live }).data ?? {})), "a stored copy drops it");
  for (const schema of [patchSheetSchema, fullPatchSheetSchema]) {
    assert.ok(!("formerSheetIds" in (schema.safeParse({ formerSheetIds: ["x"] }).data ?? {})), "a sheet edit drops it");
  }
  // Leaving again: the Gone row names both sheets she held.
  await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "murder_helpless", severity: "atrocity", note: "Again." });
  const gone = await get(world, world.owner, "campaigns/[campaignId]/companions/gone");
  const row = gone.body.gone.find((entry) => entry.name === "Seren");
  assert.ok(row, JSON.stringify(gone.body));
  assert.equal(row.sheetId, live.id);
  assert.deepEqual(row.formerSheetIds, [sheet.id]);
  assert.equal(transcriptSheets([], [], gone.body.gone).get(sheet.id)?.name, "Seren", "the first stint's lines too");
});

await test("a composed companion holds a plan, says nothing of it, and slips away at the night watch", async () => {
  const { world, atrocity, departure, still } = await table({ axes: { composure: 2 } });
  const done = await atrocity();
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.departed, undefined);
  assert.ok(still(), "she stays for now");
  assert.equal(departure().intent.response, "slip_away");
  assert.doesNotMatch(JSON.stringify(done.result), /slip|plan/i, "no result names the plan: a console call's result is read by whoever made it");
  const lines = intentLinesForPrompt(world.campaign(), world.sheets());
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Seren means to slip away at the first moment the party is not watching/);
  assert.match(lines[0], /never say it/);
  const rest = await world.invoke("take_rest", { kind: "long" });
  assert.equal(rest.ok, true, rest.error);
  assert.equal(still(), false, "gone by morning");
  assert.equal(departure().gone.how, "Slipped away in the night");
  assert.match(rest.result.companionsLeft.join(" "), /Seren slipped away in the night/);
  assert.equal(departure().intent, null);
});

await test("a plan's opening on her own turn: she takes it back from her commander, breaks off and flees the field", async () => {
  const { world, sheet, atrocity, departure, still } = await table({ axes: { composure: 2 } });
  await atrocity();
  assert.equal(departure().intent.response, "slip_away");
  assert.equal(world.sheet(sheet.id).commandedBy, world.owner.id, "the solo player commands her in fights");
  // The fight opens on her turn (the bandit's die, then Kael's, then hers).
  world.dice([1, 5, 20]);
  const opened = await world.invoke("start_encounter", { enemies: [{ monster: "bandit", count: 1 }] });
  world.clearDice();
  assert.equal(opened.ok, true, opened.error);
  assert.equal(still(), false, "she fled on the turn she was given");
  assert.match(opened.result.companionsLeft.join(" "), /Seren broke off from the fight and fled the field/);
  assert.equal(departure().gone.how, "Broke off from the fight and fled the field");
  const encounter = world.encounter();
  assert.ok(!encounter.order.some((entry) => entry.characterId === sheet.id), "out of the order");
  assert.notEqual(encounter.order[encounter.turnIndex]?.characterId, sheet.id, "and the turn passed on");
});

await test("Talk never departs; Off never departs", async () => {
  for (const companionConscience of ["talk", "off"]) {
    const { world, atrocity, departure, still } = await table({ gameSettings: { companionConscience }, axes: { boldness: -2 } });
    const done = await atrocity();
    assert.equal(done.ok, true, done.error);
    assert.ok(still(), `${companionConscience}: she stays`);
    assert.deepEqual(settleDepartures(world.campaign()), [], companionConscience);
    assert.deepEqual(departureOpenings(world.campaign(), "long_rest"), []);
    await world.invoke("take_rest", { kind: "long" });
    assert.ok(still(), `${companionConscience}: still there after the night`);
    assert.deepEqual(departure(), departuresDb.companionDeparture("none"), "no plan, no departure");
    assert.deepEqual(intentLinesForPrompt(world.campaign(), world.sheets()), []);
  }
});

await test("a dutiful companion who respects the law reports the party, and its standing there falls", async () => {
  const world0 = await table({
    axes: { diligence: 3 },
    companion: { values: [{ value: "respects_law", strength: "red_line" }, { value: "protects_innocent", strength: "red_line" }] },
  });
  const watch = factions.insertFaction(world0.world.campaignId, { name: "the City Watch", power: 4 });
  factions.insertFaction(world0.world.campaignId, { name: "a Smugglers' Ring", power: 1 });
  const done = await world0.atrocity();
  assert.equal(done.result.departed, "Left to report the party to the City Watch");
  assert.equal(getParty(world0.world.campaignId).reputation[watch.id], -2);
  assert.match(done.result.note, /The party's standing with the City Watch fell/);
});

await test("at a Turn table a bold, rash companion confronts the party: she turns where she stands, her own sheet on the foes' side of a fight the server starts", async () => {
  const { world, sheet, row, atrocity, departure, still } = await table({ gameSettings: { companionConscience: "turn" }, axes: { boldness: 3, composure: -1 } });
  assert.equal(world.sheet(sheet.id).commandedBy, world.owner.id, "the solo player commands her");
  const done = await atrocity();
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.turned, "Turned on the party");
  assert.equal(done.result.departed, undefined, "she has not left");
  assert.match(done.result.note, /Seren turned on the party: the server has put them on the foes' side of a fight it started, them alone against the party, as their own sheet\. Nobody commands them now; you play them\./);
  assert.ok(still(), "her own sheet fights: nothing was deleted or copied");
  const encounter = world.encounter();
  assert.ok(encounter, "a fight is running");
  assert.equal(sideOf(encounter, "sheet", sheet.id), "foe");
  assert.equal(world.enemies().length, 0, "no stat block stands in for her");
  assert.equal(world.sheet(sheet.id).commandedBy, null, "her command is revoked");
  assert.equal(departure().turned.response, "confront");
  assert.equal(departure().gone, null);
  assert.equal(row().attitude, "hostile");
  assert.match(lastLine(world), /Seren turns against the party\./);
  assert.ok(!conscienceViews(world.campaign(), STORYTELLER_VIEW).has("seren"), "past her conscience: no ladder while she fights them");
});

await test("biding to strike waits until the party has fallen low, then turns in the night: the fight starts at the watch", async () => {
  const { world, party, sheet, row, departure, still } = await table({ gameSettings: { companionConscience: "turn" }, heroes: 3 });
  departuresDb.saveDeparture(row().id, { intent: { response: "bide_strike", at: 0, cause: "torture by Kael" }, gone: null });
  conscienceDb.saveConscience(row().id, { ...conscienceDb.companionConscience(row().id), held: 4 });
  await world.invoke("take_rest", { kind: "long" });
  assert.ok(still(), "three whole characters: the odds are against her");
  assert.equal(world.encounter(), null);
  for (const hero of party) {
    world.patch(hero.id, { currentHp: 1 });
  }
  const outcomes = departureOpenings(world.campaign(), "long_rest");
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].turned, true);
  assert.equal(outcomes[0].how, "Turned on the party in the night");
  assert.equal(departure().turned.response, "bide_strike");
  assert.equal(departure().intent, null, "the plan is spent");
  assert.ok(still());
  assert.equal(sideOf(world.encounter(), "sheet", sheet.id), "foe");
});

await test("in a fight already running, a turn moves her to the foes' side on the spot and the DM plays her turn", async () => {
  const { world, sheet, row, departure } = await table({ gameSettings: { companionConscience: "turn" }, axes: { boldness: 3, composure: -1 } });
  world.dice([1, 20, 5]);
  const opened = await world.invoke("start_encounter", { enemies: [{ monster: "bandit", count: 1 }] });
  world.clearDice();
  assert.equal(opened.ok, true, opened.error);
  assert.equal(sideOf(world.encounter(), "sheet", sheet.id), "party");
  const encounterId = world.encounter().id;
  const done = await world.invoke("relationship_beat", { characterId: world.sheets().find((entry) => entry.name === "Kael").id, subject: "Seren", beat: "murder_helpless", severity: "atrocity", note: "Kael cut the bound prisoner's throat." });
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.turned, "Turned on the party");
  assert.match(done.result.note, /on the foes' side of this fight/);
  assert.equal(world.encounter().id, encounterId, "the same fight");
  assert.equal(sideOf(world.encounter(), "sheet", sheet.id), "foe");
  assert.equal(world.sheet(sheet.id).commandedBy, null);
  assert.equal(departure().turned.response, "confront");
  void row;
});

await test("after the fight a turncoat still standing leaves as a departed companion with her sheet kept, to come back with help", async () => {
  const { world, sheet, row, atrocity, departure, still } = await table({ gameSettings: { companionConscience: "turn" }, axes: { boldness: 3, composure: -1 } });
  await atrocity();
  assert.ok(world.encounter());
  const ended = await world.invoke("end_encounter", { outcome: "party_fled" });
  assert.equal(ended.ok, true, ended.error);
  assert.match(ended.result.turncoats, /Seren turned on the party and left to raise a force against them: the server has taken them out of the party \(their sheet is kept\)/);
  assert.equal(still(), false);
  assert.ok(conscienceDb.departedSheet(row().id), "the row keeps her sheet");
  assert.equal(departure().gone.response, "confront");
  assert.equal(departure().gone.hostile, true);
  assert.equal(departure().gone.avenging, true);
  assert.equal(departure().turned ?? null, null);
  assert.match(row().agency.goals.session.text, /bring down the party Seren left/);
  void sheet;
});

await test("the lead's End encounter settles a turncoat as a fight's end does: she leaves, not back among the party", async () => {
  const { world, row, atrocity, departure, still } = await table({ gameSettings: { companionConscience: "turn" }, axes: { boldness: 3, composure: -1 } });
  await atrocity();
  assert.ok(world.encounter());
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/encounter");
  const response = await handler.DELETE(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
  assert.equal(response.status, 200);
  assert.equal(world.encounter(), null, "the fight is over");
  assert.equal(still(), false, "out of the party, not back in it");
  assert.ok(conscienceDb.departedSheet(row().id), "the row keeps her sheet");
  assert.equal(departure().gone.response, "confront");
  assert.equal(departure().gone.hostile, true);
  assert.equal(departure().turned ?? null, null);
  assert.match(lastLine(world), /Seren turned on the party and left/, "the table is told by the server");
});

await test("a turncoat beaten to 0 lies at the party's mercy after the fight, out of it and dying, and crawls away at the next long rest", async () => {
  const { world, sheet, row, atrocity, departure, still } = await table({ gameSettings: { companionConscience: "turn" }, axes: { boldness: 3, composure: -1 } });
  await atrocity();
  // Struck down: dying, not dead (Phase 6's rule for a sheet on the foes' side).
  world.patch(sheet.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  const ended = await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(ended.ok, true, ended.error);
  assert.match(ended.result.turncoats, /Seren lies beaten at 0 hit points, at the party's mercy/);
  assert.ok(still(), "still at the table, at their mercy");
  assert.equal(departure().turned.response, "confront");
  assert.deepEqual(settleDepartures(world.campaign()), [], "nothing moves while she lies there");
  const rest = await world.invoke("take_rest", { kind: "long" });
  assert.equal(rest.ok, true, rest.error);
  assert.equal(still(), false, "gone by morning");
  assert.equal(departure().gone.how, "Crawled away in the night, beaten");
  assert.equal(departure().gone.avenging, true);
  void row;
});

await test("a turncoat killed in the fight fell: off the party, never coming back", async () => {
  const { world, sheet, row, atrocity, departure, still } = await table({ gameSettings: { companionConscience: "turn" }, axes: { boldness: 3, composure: -1 } });
  await atrocity();
  world.patch(sheet.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const ended = await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(still(), false);
  assert.equal(departure().gone.how, "Fell fighting the party");
  assert.equal(departure().gone.avenging, false);
  assert.equal(row().agency.goals.session, undefined, "no return to gather help for");
});

await test("a departed companion keeps pace with the party, gathers help with rumours, and returns at shadow level with allies inside the budget", async () => {
  const { world, party, row, sheet, atrocity, departure } = await table({ heroes: 4, level: 3, axes: { boldness: -2 } });
  const leftLevel = sheet.level;
  await atrocity();
  assert.equal(departure().gone.leftLevel, leftLevel);
  const awarded = await world.invoke("award_xp", { characterIds: party.map((hero) => hero.id), amount: 2000, reason: "the bandit camp" });
  assert.equal(awarded.ok, true, awarded.error);
  assert.equal(departure().gone.xpSince, 2000, "the party's award, counted on her record");
  const target = row().agency.goals.session.target;
  world.dice(new Array(target).fill(20));
  advanceNpcAgency(world.campaignId, "", { rounds: target, tickPressureCounters: false });
  world.clearDice();
  const rumours = listActiveFacts(world.campaignId).filter((fact) => fact.subject.toLowerCase().startsWith("rumour of seren"));
  assert.ok(rumours.length >= 1, "rumours as DM-only facts");
  assert.ok(rumours.every((fact) => fact.knownBy === "dm"));
  const gone = departure().gone;
  assert.equal(gone.cued, "fight");
  const prepared = listEncounterTemplates(world.campaignId).find((entry) => entry.id === gone.templateId);
  assert.ok(prepared, "a prepared fight");
  assert.equal(prepared.name, "Seren's return");
  assert.equal(prepared.enemies[0].monster, "Seren");
  assert.equal(gone.wear, null, "four characters: she need not be worn");
  assert.ok(prepared.enemies.length > 1, "she brings allies");
  const readout = templateDifficulty(world.campaign(), prepared.enemies);
  assert.equal(readout.unknownMonster, null, "she resolves as herself");
  assert.equal(readout.tooDeadly, false, `inside the ceiling (${readout.adjustedXp} of ${readout.ceiling})`);
  assert.match(readout.verdict, /^(hard|deadly)/);
  const event = listCalendarEvents(world.campaignId, true).find((entry) => entry.id === gone.eventId);
  assert.equal(event.visibility, "dm");
  assert.ok(!listCalendarEvents(world.campaignId, false).some((entry) => entry.id === gone.eventId));
  assert.match(returnDirectorNotes(world.campaign()).join(" "), /run_prepared_encounter/);
  world.dice(new Array(20).fill(10));
  const started = await deployTemplate(world.campaign(), world.owner.id, prepared);
  world.clearDice();
  assert.equal(started.ok, true, started.error);
  assert.ok(!world.enemies().some((enemy) => enemy.displayName === "Seren"), "no stat block stands in for her");
  const her = world.sheets().find((entry) => entry.name === "Seren");
  assert.ok(her, "she fights as her own sheet");
  assert.equal(sideOf(world.encounter(), "sheet", her.id), "foe", "on the foes' side");
  assert.equal(her.class, "paladin");
  assert.equal(her.level, leftLevel + 1, "at the level she kept pace to");
  assert.ok(her.maxHp > sheet.maxHp, "her hit points grew with her level");
  assert.equal(her.currentHp, her.maxHp, "whole: she arrives at her maximum");
  assert.equal(her.commandedBy, null, "nobody commands her: the DM plays her");
  assert.ok(world.enemies().length >= 1, "with her allies");
  assert.ok(world.encounter().order.some((entry) => entry.characterId === her.id) || !world.encounter().orderReady, "in the order");
  assert.equal(departure().gone.returned, true, "the return has run");
  assert.ok(!listEncounterTemplates(world.campaignId).some((entry) => entry.name === "Seren's return"), "and its prepared fight is spent");
  assert.equal(row().attitude, "hostile");
});

await test("a companion whose standing has climbed back comes to parley, and rejoins at shadow level as herself", async () => {
  const { world, pc, party, row, sheet, atrocity, departure } = await table({ heroes: 2, level: 3, axes: { boldness: -2 } });
  await atrocity();
  await world.invoke("award_xp", { characterIds: party.map((hero) => hero.id), amount: 2000, reason: "a long road" });
  const bond = relationships.getRelationship(world.campaignId, pc.id, "Seren");
  relationships.patchRelationship(bond.id, { approval: 5 });
  for (const hero of party.slice(1)) {
    const other = relationships.getRelationship(world.campaignId, hero.id, "Seren");
    if (other) relationships.patchRelationship(other.id, { approval: 5 });
  }
  const target = row().agency.goals.session.target;
  world.dice(new Array(target).fill(20));
  advanceNpcAgency(world.campaignId, "", { rounds: target, tickPressureCounters: false });
  world.clearDice();
  assert.equal(departure().gone.cued, "parley");
  assert.equal(departure().gone.templateId, "", "no fight is prepared");
  assert.match(returnDirectorNotes(world.campaign()).join(" "), /seeks them out to talk, not to fight/);
  const back = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", personality: "Home.", kind: "party", level: 1 });
  assert.equal(back.ok, true, back.error);
  assert.equal(back.result.returned, true);
  const now = world.sheets().find((entry) => entry.name === "Seren");
  assert.equal(now.class, "paladin");
  assert.equal(now.level, sheet.level + 1, "the level she kept pace to, not the one the call named");
  assert.deepEqual(departure(), departuresDb.companionDeparture("none"), "her leaving is behind her");
  assert.equal(conscienceViews(world.campaign(), STORYTELLER_VIEW).get("seren").rung, "content", "she starts afresh");
  const gone = await get(world, world.owner, "campaigns/[campaignId]/companions/gone");
  assert.deepEqual(gone.body.gone, [], "off the Gone list");
});

// Lets the agency dice finish a departed companion's goal at once.
function finishGoal(world, row) {
  const target = row().agency.goals.session.target;
  world.dice(new Array(target).fill(20));
  advanceNpcAgency(world.campaignId, "", { rounds: target, tickPressureCounters: false });
  world.clearDice();
}

await test("a solo character's equal comes back alone and worn: inside the ceiling, never below half her hit points, and the DM is told why", async () => {
  const { world, row, atrocity, departure } = await table({ level: 3, axes: { boldness: -2 } });
  await atrocity();
  finishGoal(world, row);
  const gone = departure().gone;
  assert.equal(gone.cued, "fight", "a fight, not a standoff");
  assert.equal(gone.standoff, false);
  assert.ok(gone.wear, "worn");
  const whole = returningCombatant(world.campaign(), row().id, "Seren", null);
  const worn = returningCombatant(world.campaign(), row().id, "Seren");
  assert.ok(worn.cr < whole.cr, `rated as she stands (CR ${worn.cr} against ${whole.cr} whole)`);
  assert.ok(worn.currentHp < whole.stats.maxHp && worn.currentHp >= Math.ceil(whole.stats.maxHp / 2), `${worn.currentHp} of ${whole.stats.maxHp}: never below half`);
  assert.match(gone.wornBy, /hard road/);
  assert.match(gone.wornBy, new RegExp(`${worn.currentHp} of ${whole.stats.maxHp} hit points`));
  const prepared = listEncounterTemplates(world.campaignId).find((entry) => entry.id === gone.templateId);
  assert.deepEqual(prepared.enemies, [{ monster: "Seren", count: 1 }], "alone");
  assert.match(prepared.notes, /alone and worn/);
  const readout = templateDifficulty(world.campaign(), prepared.enemies);
  assert.equal(readout.tooDeadly, false, `inside the ceiling (${readout.adjustedXp} of ${readout.ceiling})`);
  assert.match(readout.verdict, /^(hard|deadly)/);
  const cue = returnDirectorNotes(world.campaign()).join(" ");
  assert.match(cue, /alone and worn: .*hard road/);
  assert.match(cue, /Narrate the wear/);
  const event = listCalendarEvents(world.campaignId, true).find((entry) => entry.id === gone.eventId);
  assert.match(event.title, /alone and worn/);
  assert.equal(event.visibility, "dm");
  world.dice(new Array(20).fill(10));
  const started = await deployTemplate(world.campaign(), world.owner.id, prepared);
  world.clearDice();
  assert.equal(started.ok, true, started.error);
  const her = world.sheets().find((entry) => entry.name === "Seren");
  assert.ok(her, "she fights as her own sheet");
  assert.equal(sideOf(world.encounter(), "sheet", her.id), "foe");
  assert.equal(world.enemies().length, 0, "alone");
  assert.equal(her.currentHp, worn.currentHp, "she arrives worn");
  assert.equal(her.maxHp, whole.stats.maxHp, "out of her own maximum");
  const spent = Object.values(gone.wear.slotsSpent).reduce((sum, count) => sum + count, 0);
  const used = Object.values(her.spellcasting?.slots ?? {}).reduce((sum, slot) => sum + slot.used, 0) + (her.spellcasting?.pact?.used ?? 0);
  assert.equal(used, spent, "her slots spent as the wear says");
});

await test("one past the ceiling even worn to the floor comes in a standoff in words", async () => {
  const { world, row, atrocity, departure } = await table({ gameSettings: {}, level: 1, axes: { boldness: -2 }, companion: { level: 7 } });
  await atrocity();
  finishGoal(world, row);
  const gone = departure().gone;
  assert.equal(gone.cued, "parley");
  assert.equal(gone.standoff, true);
  assert.equal(gone.wear, null);
  assert.equal(gone.templateId, "", "no fight is prepared");
  assert.match(returnDirectorNotes(world.campaign()).join(" "), /even worn to half their strength/);
});

await test("a wear lowers a sheet's own hit points and marks its slots spent, highest first: the rule Phase 6's real sheet keeps", async () => {
  const sheet = {
    name: "Ilsa",
    level: 5,
    class: "wizard",
    maxHp: 30,
    currentHp: 30,
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 1 } }, prepared: [], known: [], cantrips: [] },
  };
  assert.deepEqual(slotPools(sheet).map((pool) => [pool.key, pool.count]), [["1", 4], ["2", 3], ["3", 1]]);
  const worn = applyWear(sheet, { hpLost: 12, slotsSpent: { 3: 1, 2: 1 } });
  assert.equal(worn.currentHp, 18);
  assert.equal(worn.maxHp, 30, "out of its own maximum");
  assert.deepEqual(worn.spellcasting.slots, { 1: { max: 4, used: 0 }, 2: { max: 3, used: 1 }, 3: { max: 2, used: 2 } });
  assert.equal(sheet.currentHp, 30, "the sheet given is left as it was");
});

await test("where companions may turn, a command that ends on her own turn hands that turn to the DM", async () => {
  const { world, pc, sheet } = await table({ gameSettings: { companionConscience: "turn" } });
  await world.beginFight([{ monster: "bandit", count: 1 }], { heroFaces: { [sheet.id]: 20, [pc.id]: 5 } });
  const encounter = world.encounter();
  assert.equal(encounter.order[encounter.turnIndex].characterId, sheet.id, "her turn");
  assert.deepEqual(campaigns.getFloor(world.campaignId).userIds, [world.owner.id], "her commander's floor");
  await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "cruelty" });
  await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "broke_word" });
  assert.equal(world.sheet(sheet.id).commandedBy, null);
  assert.deepEqual(campaigns.getFloor(world.campaignId).userIds, [sheet.userId], "the turn is the DM's now");
});

// ---- who may read a held plan ----

const PLAN = /slip away|means to/i;

await test("the lead of an AI table reads a held plan nowhere: Bonds, ?secrets=1, facts, the Context tab", async () => {
  const { world, atrocity, departure } = await table({ axes: { composure: 2 }, heroes: 2 });
  await atrocity();
  assert.ok(departure().intent);
  const bonds = await get(world, world.owner, "campaigns/[campaignId]/relationships");
  assert.equal(bonds.status, 200);
  assert.doesNotMatch(bonds.text, PLAN);
  assert.ok(!bonds.body.relationships.some((row) => row.conscience?.plan), "no plan on any row");
  const secrets = await get(world, world.owner, "campaigns/[campaignId]/facts", "?secrets=1");
  assert.equal(secrets.status, 200);
  assert.doesNotMatch(secrets.text, PLAN);
  const campaign = world.campaign();
  const sheets = world.sheets();
  const state = {
    campaign,
    members: campaigns.listMembers(world.campaignId),
    sheets,
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    storytellerLines: [...storytellerLinesForPrompt(campaign, sheets, []), ...intentLinesForPrompt(campaign, sheets)],
  };
  const conversation = buildDmMessages(state, []);
  assert.match(conversation.map((message) => message.content).join("\n"), /Seren means to slip away/, "the AI has it");
  assert.ok(state.contextTrace.blocks.some((block) => block.id === "storyteller"), "costed on the storyteller's row");
  const turn = turns.createDmTurn(world.campaignId, conversation);
  turn.contextTrace = state.contextTrace;
  turns.saveDmTurn(turn);
  const trace = await get(world, world.owner, "campaigns/[campaignId]/context-trace");
  assert.equal(trace.status, 200);
  assert.ok(!trace.body.trace.blocks.some((block) => block.id === "storyteller"), "no storyteller row for the lead");
  assert.doesNotMatch(trace.text, PLAN);
});

await test("nor does a lore check the lead runs on her hand the checker the plan", async () => {
  const { fakeModel, reply, settleQueue } = await import("./lib/enforce-narrator.mjs");
  const model = await fakeModel();
  try {
    const { world, atrocity, departure } = await table({ axes: { composure: 2 }, heroes: 2 });
    model.pointAt(world);
    await atrocity();
    assert.ok(departure().intent);
    const factsDb = await import("../src/lib/db/facts.ts");
    factsDb.insertFact({ campaignId: world.campaignId, category: "npc", subject: "Seren", fact: "Seren keeps the road watch.", knownBy: "party", pinned: true, source: "manual" });
    factsDb.insertFact({ campaignId: world.campaignId, category: "npc", subject: "Seren", fact: "Seren was raised by a temple of the dawn.", knownBy: "dm", pinned: true, source: "manual" });
    for (const category of ["wrong_fact", "out_of_character"]) {
      const narration = messages.insertCampaignMessage({
        campaignId: world.campaignId,
        seq: campaigns.allocateSeq(world.campaignId),
        authorType: "dm",
        content: "Seren keeps her pack packed by the door.",
      });
      model.script([reply({ text: JSON.stringify({ verdict: "consistent", explanation: "Fine.", citations: [], rewrite: null }) })]);
      world.signIn(world.owner);
      const route = await world.route("campaigns/[campaignId]/lore-check");
      const response = await route.POST(
        new Request("http://test/", { method: "POST", body: JSON.stringify({ messageId: narration.id, category, ...(category === "wrong_fact" ? {} : { npcName: "Seren" }) }) }),
        { params: Promise.resolve({ campaignId: world.campaignId }) },
      );
      await settleQueue(world.campaignId);
      assert.equal(response.status, 200, `${category}: ${JSON.stringify(await response.clone().json())} after ${model.requests.length} requests`);
      const evidence = model.requests.at(-1).messages.map((message) => String(message.content ?? "")).join("\n");
      assert.match(evidence, /temple of the dawn/, `${category}: the lead's own DM secrets are there`);
      assert.doesNotMatch(evidence, PLAN, `${category}: the plan is not the checker's to quote`);
    }
  } finally {
    model.close();
  }
});

await test("at a table a person runs, that person reads the plan on the Bonds tab", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "human" } });
  const leadUser = world.addUser("lead");
  const pc = world.addHero({ user: leadUser, name: "Kael", gender: "Male" });
  const added = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", alignment: "LG", personality: "Stern.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  const row = npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
  npcs.patchNpcAgency(row.id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 2 } });
  await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "murder_helpless", severity: "atrocity" });
  assert.ok(departuresDb.companionDeparture(row.id).intent);
  const dm = await get(world, world.owner, "campaigns/[campaignId]/relationships");
  assert.match(dm.body.relationships.find((entry) => entry.subjectName === "Seren").conscience.plan, /slip away/);
  const player = await get(world, leadUser, "campaigns/[campaignId]/relationships");
  assert.doesNotMatch(player.text, PLAN, "its lead plays a character: never theirs");
  // Nor the breaking point the plan stands on: nobody has said it (issue 615).
  assert.equal(player.body.relationships.find((entry) => entry.subjectName === "Seren" && entry.conscience)?.conscience.rung, "content", "the player's Bonds tab shows what the table heard");
  assert.equal(dm.body.relationships.find((entry) => entry.subjectName === "Seren").conscience.rung, "breaking", "whoever runs it, the truth");
});

await test("two companions gathering help against the party are no rivals: the agency dice write no rivalry between them", async () => {
  const world = await openWorld();
  world.addHero({ name: "Kael" });
  const { avengeGoal } = await import("../src/lib/dm/departure-logic.ts");
  const gone = [];
  for (const name of ["Brother Aldous Penn", "Dame Seraphine Vale"]) {
    assert.equal((await world.invoke("set_npc", { name })).ok, true);
    const npc = npcs.getNpcByName(world.campaignId, name);
    npcs.patchNpcAgency(npc.id, { goals: { session: { text: avengeGoal(name), progress: 0, target: 3 } } });
    gone.push(npc.id);
  }
  // A step on each goal, then a contest a rivalry would settle.
  world.dice(1, 1, 5, 15);
  advanceNpcAgency(world.campaignId, "", { tickPressureCounters: false });
  world.clearDice();
  const rivalries = listActiveFacts(world.campaignId).filter((fact) => /rivalry/.test(fact.fact));
  assert.deepEqual(rivalries.map((fact) => fact.fact), []);
  for (const id of gone) {
    assert.deepEqual(npcs.getNpcById(id).agency.relations, [], "neither resents the other");
  }
});

await test("two strangers at the ford the party stands at are no rivals over it: the agency dice write no rivalry", async () => {
  const world = await openWorld();
  world.addHero({ name: "Kael" });
  assert.equal((await world.invoke("move_party", { name: "Lower Ford", visionClear: false })).ok, true);
  const goals = {
    "Mara Fen": "Get her family and their stuck cart safely out of the ford.",
    "Briar-road Raider Captain": "Leave the ford with the stolen strongbox.",
  };
  for (const [name, text] of Object.entries(goals)) {
    assert.equal((await world.invoke("set_npc", { name })).ok, true);
    const npc = npcs.getNpcByName(world.campaignId, name);
    npcs.patchNpcAgency(npc.id, { goals: { session: { text, progress: 0, target: 3 } } });
  }
  // A step on each goal, then a contest a rivalry would settle.
  world.dice(1, 1, 5, 15);
  advanceNpcAgency(world.campaignId, "", { tickPressureCounters: false });
  world.clearDice();
  assert.deepEqual(listActiveFacts(world.campaignId).filter((fact) => /rivalry/.test(fact.fact)).map((fact) => fact.fact), []);
});

// ---- said at the table (issue 615) ----

await test("on the AI's turn, a warning its narration left out is posted as her line after that narration", async () => {
  const { fakeModel, reply } = await import("./lib/enforce-narrator.mjs");
  const model = await fakeModel();
  try {
    const { world, pc, sheet } = await table();
    model.pointAt(world);
    await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "cruelty" });
    await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "broke_word" });
    model.script([reply({ text: "The road bends toward the river, and the party walks on." })]);
    await model.turn(world, "We keep walking.", pc.id);
    const recent = messages.listRecentMessages(world.campaignId, 20);
    const narration = recent.find((message) => message.authorType === "dm" && message.content.includes("The road bends toward the river"));
    assert.ok(narration, "the narration landed");
    const hers = recent.filter((message) => message.authorType === "dm" && message.speech.some((line) => line.speaker.kind === "pc" && line.speaker.id === sheet.id));
    assert.equal(hers.length, 1, "one line of hers");
    assert.ok(hers[0].seq > narration.seq, `after the narration (${hers[0].seq} > ${narration.seq})`);
    assert.match(hers[0].content, /^Seren: ".+That stops now\."$/);
    assert.equal(messages.getLatestDmMessage(world.campaignId).id, narration.id, "the narration stays the one a reroll or a continue works on");
    assert.ok(narration.dmTurnId, "and it carries its turn to replay");
    assert.equal(conscienceDb.companionConscience(npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren").id).owed, null, "owed once");
  } finally {
    model.close();
  }
});

// Issue 668: "Sir Hollis Stonebridge walked out on the party" sat above the
// attack and damage cards that made him leave. The server's line was
// posted the moment the tool ran; the roll cards ride on the narration,
// written when the turn ends. A note the turn's own tools post now waits
// below that turn's narration.
await test("a companion who walks out during a turn is announced below the narration of that turn", async () => {
  const { fakeModel, reply, call } = await import("./lib/enforce-narrator.mjs");
  const model = await fakeModel();
  try {
    const { world, pc, still } = await table({ axes: { boldness: -2 } });
    model.pointAt(world);
    model.script([
      reply({ calls: [call("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "murder_helpless", severity: "atrocity", note: "Kael cut the bound prisoner's throat." })] }),
      reply({ text: "The blade falls. Seren stares at the body, then at Kael, and says nothing at all." }),
    ]);
    const dm = await model.turn(world, "Kael cuts the bound prisoner's throat.", pc.id, pc.userId);
    assert.ok(dm, "the turn wrote its narration");
    assert.equal(still(), false, "she walked out during the turn");
    const line = messages.listRecentMessages(world.campaignId, 40).find((message) => /Seren walked out on the party\./.test(message.content));
    assert.ok(line, "the table was told");
    assert.ok(dm.seq < line.seq, `the narration (${dm.seq}) sits above the walk-out line (${line.seq})`);
  } finally {
    model.close();
  }
});

await test("a move posted while the AI's turn ran is never left looking answered: her line waits for the narration that answers it", async () => {
  const { fakeModel, reply, held } = await import("./lib/enforce-narrator.mjs");
  const { startDmTurn } = await import("../src/lib/dm/turn.ts");
  const { claimNarrationSeq } = await import("../src/lib/dm/narration-slot.ts");
  const model = await fakeModel();
  try {
    const { world, pc, sheet } = await table();
    model.pointAt(world);
    await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "cruelty" });
    await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat: "broke_word" });
    const post = (content) => {
      // What POST /actions does: claim, then take a seq.
      claimNarrationSeq(world.campaignId);
      return messages.insertCampaignMessage({ campaignId: world.campaignId, seq: campaigns.allocateSeq(world.campaignId), authorType: "player", userId: world.owner.id, characterId: pc.id, content });
    };
    const slow = held(reply({ text: "The road bends toward the river." }));
    model.script([slow.entry]);
    post("We keep walking.");
    const running = startDmTurn(world.campaignId);
    const until = Date.now() + 20_000;
    while (!model.requests.length) {
      assert.ok(Date.now() < until, "the turn reached the model");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const mid = post("Kael asks Seren what is wrong.");
    slow.release();
    await running;
    const hers = () => messages.listRecentMessages(world.campaignId, 30).filter((message) => message.authorType === "dm" && message.speech.some((line) => line.speaker.kind === "pc" && line.speaker.id === sheet.id));
    assert.equal(hers().length, 0, "nothing posted below the move that came in mid-turn");
    const last = messages.listRecentMessages(world.campaignId, 5).filter((message) => message.authorType !== "system").at(-1);
    assert.equal(last.id, mid.id, "the move is still the last word, waiting for the GM");
    model.script([reply({ text: "Seren's jaw tightens, and the river runs on beside them." })]);
    await startDmTurn(world.campaignId);
    const [line] = hers();
    assert.ok(line, "the narration that answers it brings her line");
    assert.ok(line.seq > mid.seq, "after the move it follows");
  } finally {
    model.close();
  }
});

await test("a held plan's breaking point is the storyteller's: the moment block the lead reads says what the table heard (issue 615)", async () => {
  const { world, atrocity, departure } = await table({ axes: { composure: 2 }, heroes: 2 });
  await atrocity();
  assert.ok(departure().intent, "she holds a plan");
  const campaign = world.campaign();
  const sheets = world.sheets();
  const moment = conscienceBlockForPrompt(campaign, sheets);
  assert.match(moment, /- Seren: holds [^\n]*; content/, "the moment reads her as the table has heard her");
  assert.doesNotMatch(moment, /Seren: holds [^\n]*breaking point/, "never the breaking point under the plan");
  assert.doesNotMatch(moment, PLAN);
  const secret = conscienceSecretLines(campaign, sheets);
  assert.match(secret.join("\n"), /Seren is at their breaking point, which the table has not seen \(it has heard only: content\)/, "the truth is the storyteller's");
  const state = {
    campaign,
    members: campaigns.listMembers(world.campaignId),
    sheets,
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    conscienceBlock: moment,
    storytellerLines: [...intentLinesForPrompt(campaign, sheets), ...secret],
  };
  const conversation = buildDmMessages(state, []);
  assert.match(conversation.map((message) => message.content).join("\n"), /Seren is at their breaking point/, "the AI has it");
  const turn = turns.createDmTurn(world.campaignId, conversation);
  turn.contextTrace = state.contextTrace;
  turns.saveDmTurn(turn);
  const trace = await get(world, world.owner, "campaigns/[campaignId]/context-trace");
  assert.equal(trace.status, 200);
  assert.ok(!trace.body.trace.blocks.some((block) => block.id === "storyteller"), "the truth rides the storyteller's row, cut for the lead");
  assert.doesNotMatch(trace.text, /Seren is at their breaking point/);
});

await test("armour put on at a table a person runs moves the clock past an ultimatum, and the departure is settled then; where the AI runs the turns, its next turn does (issue 615)", async () => {
  const { advanceClock } = await import("../src/lib/db/clock.ts");
  const setup = async (gameSettings) => {
    const world = await openWorld({ gameSettings: { companions: "full", ...gameSettings } });
    const player = world.addUser("player");
    const pc = world.addHero({ user: player, name: "Kael", gender: "Male" });
    world.patch(pc.id, { equipment: [{ name: "Chain Mail", qty: 1, equipped: false }] });
    const added = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", alignment: "LG", personality: "Stern.", kind: "party" });
    assert.equal(added.ok, true, added.error);
    const row = npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
    npcs.patchNpcAgency(row.id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 } });
    const seren = world.sheets().find((entry) => entry.name === "Seren").id;
    for (const [beat, extra] of [["cruelty", {}], ["broke_word", {}], ["torture", { demand: "Release them", deadlineHours: 1 }]]) {
      const done = await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat, ...extra });
      assert.equal(done.ok, true, done.error);
    }
    advanceClock(world.campaignId, 55, "minutes");
    assert.ok(world.sheet(seren), "the deadline has not passed yet");
    world.signIn(player);
    const usage = await world.route("campaigns/[campaignId]/sheet/usage");
    const response = await usage.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ gear: { "Chain Mail": { equipped: true } } }) }), {
      params: Promise.resolve({ campaignId: world.campaignId }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, body.error);
    assert.match(body.timePassed ?? "", /10 minutes|minutes/, "putting the mail on took the minutes past the deadline");
    assert.equal(body.companionsLeft, undefined, "the GM's notes never reach a player's answer");
    return { world, seren, row };
  };
  const human = await setup({ dmMode: "human" });
  assert.equal(human.world.sheet(human.seren), null, "she went as the minutes passed her deadline");
  assert.ok(departuresDb.companionDeparture(human.row.id).gone);
  assert.ok(messages.listRecentMessages(human.world.campaignId, 10).some((message) => message.authorType === "system" && /^Seren /.test(message.content)), "the table is told");
  const ai = await setup({});
  assert.ok(ai.world.sheet(ai.seren), "where the AI runs the turns, it is left to the turn that narrates it");
  assert.equal(conscienceViews(ai.world.campaign(), STORYTELLER_VIEW).get("seren").rung, "breaking", "though the deadline has passed");
  assert.equal(settleDepartures(ai.world.campaign()).length, 1, "and that turn's start settles it");
});

await test("at a table a person runs, moving the clock past an ultimatum settles the departure then and says so", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "human", companions: "full" } });
  const player = world.addUser("player");
  const pc = world.addHero({ user: player, name: "Kael", gender: "Male" });
  const added = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", alignment: "LG", personality: "Stern.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  const row = npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
  npcs.patchNpcAgency(row.id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 } });
  const sheetId = world.sheets().find((entry) => entry.name === "Seren").id;
  for (const [beat, extra] of [["cruelty", {}], ["broke_word", {}], ["torture", { demand: "Release them", deadlineHours: 2 }]]) {
    const done = await world.invoke("relationship_beat", { characterId: pc.id, subject: "Seren", beat, ...extra });
    assert.equal(done.ok, true, done.error);
  }
  world.signIn(world.owner);
  const route = await world.route("campaigns/[campaignId]/dm/clock");
  const response = await route.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ do: "advance", amount: 3, unit: "hours" }) }), {
    params: Promise.resolve({ campaignId: world.campaignId }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(world.sheet(sheetId), null, "she went as the clock passed her deadline, not at the next console call");
  assert.match((body.companionsLeft ?? []).join(" "), /Seren .+the server has taken them out of the party/, "the GM is told, as a console call tells them");
  assert.ok(departuresDb.companionDeparture(row.id).gone);
});

finish();
