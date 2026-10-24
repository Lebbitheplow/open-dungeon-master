// A companion's conscience (issue 503 Phase 0.3, 0.4 and 1), through the
// engine the way the DM reaches it, with the dice under the test's control.
//
// What a lasting companion holds to comes from its class and alignment (or
// the DM's add_companion); a deed recorded with witnesses moves every one of
// them by their nature and their values; a red line broken walks a companion
// down the ladder (content, uneasy, warning, ultimatum, breaking point) and
// the AI never names a rung; an ultimatum is a condition and a deadline on
// the clock, mirrored as a DM-only calendar event, met by amends and lapsed
// by the clock; deeds are offered mid-fight; Talk never departs; where the
// table lets companions turn, a player's command ends at a warning. A
// dismissal keeps the sheet on the row behind the companion, a return
// brings the same person back, and a chapter rewound across a dismissal
// puts the companion and the bot user behind it back.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-conscience");
const { getDatabase } = await import("../src/lib/db/core.ts");
const relationships = await import("../src/lib/db/relationships.ts");
const npcs = await import("../src/lib/db/npcs.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const messages = await import("../src/lib/db/messages.ts");
const conscienceDb = await import("../src/lib/db/companion-conscience.ts");
const { listCalendarEvents } = await import("../src/lib/db/calendar-events.ts");
const { advanceClock } = await import("../src/lib/db/clock.ts");
const { listActiveFacts } = await import("../src/lib/db/facts.ts");
const { ensureOpenChapter } = await import("../src/lib/db/chapters.ts");
const { captureBoundarySnapshot } = await import("../src/lib/db/snapshots.ts");
const { performRollback } = await import("../src/lib/dm/rollback.ts");
const { conscienceBlockForPrompt, conscienceViews } = await import("../src/lib/dm/conscience.ts");
const { noteUnrecordedDeeds } = await import("../src/lib/dm/deed-claims.ts");
const { dmTurnTools } = await import("../src/lib/dm/turn.ts");
const { buildGameStateBlock } = await import("../src/lib/dm/prompt.ts");
const { THIS_MOMENT_HEADING } = await import("../src/lib/prompt-boundary.ts");

// A solo table with a lasting companion, the way the AI recruits one.
async function table({ gameSettings = {}, companion = {}, hero = {} } = {}) {
  const world = await openWorld({ gameSettings });
  const pc = world.addHero({ name: "Kael", gender: "Male", ...hero });
  const added = await world.invoke("add_companion", {
    name: "Seren",
    class: "paladin",
    gender: "Female",
    alignment: "LG",
    personality: "Stern, devout, slow to anger and slower to forgive.",
    kind: "party",
    ...companion,
  });
  assert.equal(added.ok, true, added.error);
  const sheet = world.sheets().find((entry) => entry.name === (companion.name ?? "Seren"));
  const row = () => npcs.listNpcs(world.campaignId).find((npc) => npc.companionSheetId === sheet.id);
  // An even temper, so the numbers below are the deeds' and the values'
  // alone: a nature that makes a deed land harder is relationship-logic's.
  npcs.patchNpcAgency(row().id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 } });
  const bond = () => relationships.getRelationship(world.campaignId, pc.id, sheet.name);
  const rung = () => conscienceViews(world.campaign()).get(sheet.name.toLowerCase())?.rung;
  const deed = (beat, extra = {}) => world.invoke("relationship_beat", { characterId: pc.id, subject: sheet.name, beat, ...extra });
  return { world, pc, sheet, row, bond, rung, deed };
}

await test("a lasting companion holds values from its class and alignment, and the DM may set them", async () => {
  const { world, row } = await table();
  assert.deepEqual(
    conscienceDb.companionValues(row().id).map((held) => `${held.value}:${held.strength}`),
    ["protects_innocent:red_line", "keeps_oaths:red_line"],
    "a lawful good paladin's two red lines",
  );
  assert.equal(world.sheets().find((entry) => entry.name === "Seren").alignment, "LG", "the alignment is on the sheet");
  const added = await world.invoke("add_companion", {
    name: "Vex",
    class: "rogue",
    gender: "Male",
    personality: "Grins too much.",
    kind: "party",
    values: [{ value: "ruthless", strength: "cares" }, { value: "mercenary", strength: "red_line" }],
  });
  assert.equal(added.ok, true, added.error);
  const vex = npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Vex");
  assert.deepEqual(conscienceDb.companionValues(vex.id).map((held) => held.value), ["mercenary", "ruthless"], "red lines first");
  const guest = await world.invoke("add_companion", { name: "Guard", class: "fighter", gender: "Female", personality: "Brisk.", kind: "guest" });
  assert.equal(guest.ok, true, guest.error);
  assert.ok(!npcs.listNpcs(world.campaignId).some((npc) => npc.name === "Guard"), "a guest holds nothing: no row behind them");
});

await test("a red-line atrocity witnessed takes a companion straight to the breaking point", async () => {
  // At Talk, so she is still there to read: at Leave the server would act on
  // it at once (test-enforce-departure.mjs).
  const { bond, rung, deed } = await table({ gameSettings: { companionConscience: "talk" } });
  assert.equal(rung(), "content");
  const done = await deed("murder_helpless", { severity: "atrocity", note: "Kael cut the bound prisoner's throat." });
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.conscience, "content -> breaking");
  assert.deepEqual(done.result.breaks, ["protects the innocent (red line)"]);
  assert.ok(done.result.approvalChange <= -40, `an atrocity against a red line costs dearly (${done.result.approvalChange})`);
  assert.equal(rung(), "breaking");
  assert.match(done.result.note, /Seren's conscience moves from content to breaking point/);
  assert.ok(bond().approval < -30);
});

await test("serious breaches walk down one rung at a time; the third sets an ultimatum on the clock, mirrored for the DM", async () => {
  const { world, row, rung, deed } = await table();
  assert.equal((await deed("cruelty")).result.conscience, "content -> uneasy");
  assert.equal(rung(), "uneasy");
  assert.equal((await deed("broke_word")).result.conscience, "uneasy -> warning");
  const third = await deed("torture", { demand: "Free the captives you took", deadlineHours: 6 });
  assert.equal(third.ok, true, third.error);
  assert.equal(third.result.conscience, "warning -> ultimatum");
  assert.match(third.result.note, /Seren sets an ultimatum: "Free the captives you took", by .+ \(6 h\)/);
  const stored = conscienceDb.companionConscience(row().id);
  assert.equal(stored.ultimatum.condition, "Free the captives you took");
  assert.equal(stored.ultimatum.due - stored.ultimatum.set, 6 * 60);
  const events = listCalendarEvents(world.campaignId, true);
  const mirror = events.find((event) => event.id === stored.ultimatum.eventId);
  assert.ok(mirror, "a calendar event mirrors it");
  assert.equal(mirror.visibility, "dm", "only the DM's");
  assert.equal(mirror.atInstant, stored.ultimatum.due);
  assert.ok(!listCalendarEvents(world.campaignId, false).some((event) => event.id === mirror.id), "players' calendars do not list it");
  const view = conscienceViews(world.campaign()).get("seren");
  assert.equal(view.ultimatum.condition, "Free the captives you took");
  assert.equal(view.ultimatum.left, "6 h");
});

await test("an ultimatum met climbs a rung and takes its calendar event with it; once an exchange", async () => {
  const { world, row, rung, deed } = await table();
  await deed("cruelty");
  await deed("broke_word");
  await deed("torture", { demand: "Swear off the knife" });
  const eventId = conscienceDb.companionConscience(row().id).ultimatum.eventId;
  const amends = await world.invoke("relationship_beat", { characterId: (await world.sheets()).find((s) => s.name === "Kael").id, subject: "Seren", beat: "amends" });
  assert.equal(amends.ok, true, amends.error);
  assert.equal(amends.result.conscience, "ultimatum -> warning");
  assert.equal(rung(), "warning");
  assert.equal(conscienceDb.companionConscience(row().id).ultimatum, null);
  assert.ok(!listCalendarEvents(world.campaignId, true).some((event) => event.id === eventId), "the mirror went with it");
});

await test("an ultimatum whose deadline passes is the breaking point", async () => {
  const { world, rung, deed } = await table();
  await deed("cruelty");
  await deed("broke_word");
  await deed("torture", { demand: "Release them", deadlineHours: 2 });
  assert.equal(rung(), "ultimatum");
  const moved = advanceClock(world.campaignId, 3, "hours");
  assert.ok(!("error" in moved), moved.error);
  assert.equal(rung(), "breaking", "the clock passing it");
  const fact = listActiveFacts(world.campaignId).find((entry) => entry.fact.includes("Seren demanded: Release them"));
  assert.ok(fact, "the mirror fired as a DM-only fact");
  assert.equal(fact.knownBy, "dm");
});

await test("Talk keeps a companion at its breaking point; at Leave the server decides what she does (src/lib/dm/departure.ts)", async () => {
  const talk = await table({ gameSettings: { companionConscience: "talk" } });
  await talk.deed("slaving", { severity: "atrocity" });
  assert.equal(talk.rung(), "breaking");
  assert.ok(talk.world.sheet(talk.sheet.id), "talk: still in the party");
  assert.match(conscienceBlockForPrompt(talk.world.campaign(), talk.world.sheets()), /this table keeps its companions, so they stay/);
  const leave = await table({ gameSettings: { companionConscience: "leave" } });
  const done = await leave.deed("slaving", { severity: "atrocity" });
  assert.equal(done.result.departed, "Walked out on the party", "an even temper with nothing to stay for walks out");
  assert.equal(leave.world.sheet(leave.sheet.id), null);
});

await test("Off: deeds land by personality alone, with no values and no ladder", async () => {
  const { world, row, deed } = await table({ gameSettings: { companionConscience: "off" } });
  const done = await deed("murder_helpless", { severity: "atrocity" });
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.conscience, undefined);
  assert.equal(done.result.breaks, undefined);
  assert.equal(conscienceDb.companionConscience(row().id).shown, 0);
  assert.equal(conscienceBlockForPrompt(world.campaign(), world.sheets()), "");
  assert.equal(conscienceViews(world.campaign()).size, 0, "the Bonds tab shows no ladder");
});

await test("values cut both ways: a ruthless companion warms to cruelty and minds mercy", async () => {
  const { bond, rung, deed } = await table({
    companion: { name: "Grask", class: "fighter", alignment: "CE", personality: "Cold." },
  });
  const cruel = await deed("cruelty");
  assert.deepEqual(cruel.result.honours, ["ruthless (red line)"]);
  assert.ok(cruel.result.approvalChange > 0, `cruelty pleases them (${cruel.result.approvalChange})`);
  const mercy = await deed("mercy");
  assert.deepEqual(mercy.result.breaks, ["ruthless (red line)"]);
  assert.equal(mercy.result.conscience, "content -> uneasy");
  assert.ok(bond().approval < 20);
  assert.equal(rung(), "uneasy");
});

await test("every witness a deed names is moved by their own nature; a name nobody tracks is listed back", async () => {
  const { world, pc, deed } = await table();
  await world.invoke("set_npc", { name: "Brother Aldo", gender: "Male", location: "the chapel" });
  const done = await deed("desecration", { witnesses: ["Brother Aldo", "a passing farmer", "Kael"] });
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.witnesses.length, 1);
  assert.equal(done.result.witnesses[0].subject, "Brother Aldo");
  assert.ok(relationships.getRelationship(world.campaignId, pc.id, "Brother Aldo").approval < 0, "the priest minds");
  assert.match(done.result.note, /Not tracked, so they keep no memory of it: a passing farmer/);
  assert.doesNotMatch(done.result.note, /Not tracked[^.]*Kael/, "the doer is never their own witness");
});

await test("in a fight relationship_beat is offered for deeds alone, and a deed mid-fight is recorded", async () => {
  const { world, rung, deed } = await table();
  const offered = (tools) => tools.find((tool) => tool.function?.name === "relationship_beat");
  const calm = offered(dmTurnTools(world.campaign(), false, false, false));
  assert.ok(calm.function.parameters.properties.beat.enum.includes("helped"));
  const fight = offered(dmTurnTools(world.campaign(), true, false, false));
  assert.ok(fight, "offered in a fight");
  assert.deepEqual(
    [...fight.function.parameters.properties.beat.enum].sort(),
    ["betrayal", "broke_word", "cruelty", "desecration", "mercy", "murder_helpless", "necromancy", "slaving", "theft_from_poor", "torture"],
  );
  assert.ok(!dmTurnTools(world.campaign(), true, false, false).some((tool) => tool.function?.name === "relationship_end"), "the rest waits");
  for (const tool of [calm, fight]) {
    assert.ok(!("rung" in tool.function.parameters.properties) && !("conscience" in tool.function.parameters.properties), "no argument names a rung");
  }
  await world.beginFight([{ monster: "bandit", count: 1 }]);
  const refused = await deed("helped");
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Mid-fight only deeds are recorded/);
  const killed = await deed("murder_helpless", { note: "Kael ran the surrendered bandit through." });
  assert.equal(killed.ok, true, killed.error);
  assert.equal(rung(), "uneasy");
});

await test("where companions may turn, a player's command ends at a warning, the table is told, and the card cannot give it back", async () => {
  const { world, pc, sheet, deed } = await table({ gameSettings: { companionConscience: "turn" } });
  assert.equal(world.sheet(sheet.id).commandedBy, world.owner.id, "the solo player commands her in fights");
  await deed("cruelty");
  assert.equal(world.sheet(sheet.id).commandedBy, world.owner.id, "uneasy is not yet a warning");
  const warned = await deed("broke_word");
  assert.equal(warned.result.conscience, "uneasy -> warning");
  assert.equal(world.sheet(sheet.id).commandedBy, null, "command ends");
  assert.match(warned.result.note, /no longer takes .+'s orders in a fight/);
  const told = messages.listRecentMessages(world.campaignId, 3).find((message) => message.content.includes("no longer takes"));
  assert.ok(told, "the table is told");
  const route = await world.route("campaigns/[campaignId]/companions/[characterId]");
  world.signIn(world.owner);
  const response = await route.PATCH(
    new Request("http://test/", { method: "PATCH", body: JSON.stringify({ commandedBy: world.owner.id }) }),
    { params: Promise.resolve({ campaignId: world.campaignId, characterId: sheet.id }) },
  );
  assert.equal(response.status, 409, "command cannot be handed back while she stands at a warning");
  assert.equal(pc.name, "Kael");
});

await test("at a Leave table the player keeps command at a warning", async () => {
  const { world, sheet, deed } = await table();
  await deed("cruelty");
  await deed("broke_word");
  assert.equal(world.sheet(sheet.id).commandedBy, world.owner.id);
});

await test("standing sunk by a social check moves the ladder too: the server settles it on every change", async () => {
  const { world, pc, bond, rung } = await table();
  relationships.patchRelationship(bond()?.id ?? relationships.ensureRelationship({ campaignId: world.campaignId, characterId: pc.id, characterName: "Kael", subjectKind: "companion", subjectName: "Seren" }).id, { approval: -20 });
  world.dice(1);
  const talked = await world.invoke("social_check", { characterId: pc.id, npc: "Seren", approach: "intimidate" });
  world.clearDice();
  assert.equal(talked.ok, true, talked.error);
  assert.ok(bond().approval <= -25, `standing fell (${bond().approval})`);
  assert.equal(rung(), "warning", "disliked is a warning");
});

await test("the moment part of GAME STATE carries red lines, the rung and the ultimatum; the cached prefix does not", async () => {
  const { world, deed } = await table();
  await deed("cruelty");
  await deed("broke_word");
  await deed("torture", { demand: "Bury the dead you made" });
  const block = conscienceBlockForPrompt(world.campaign(), world.sheets());
  assert.match(block, /Seren: holds protects the innocent \(red line\), keeps oaths \(red line\); ultimatum/);
  assert.match(block, /after torture by Kael/);
  assert.match(block, /their demand: "Bury the dead you made", by .+ \(1 day left\)/);
  const state = {
    campaign: world.campaign(),
    members: campaigns.listMembers(world.campaignId),
    sheets: world.sheets(),
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    conscienceBlock: block,
  };
  const rendered = buildGameStateBlock(state);
  const at = rendered.indexOf(THIS_MOMENT_HEADING);
  assert.ok(at > 0 && rendered.indexOf("Companion conscience") > at, "after the moment heading");
});

await test("a deed the narration showed and nothing recorded is noted for the DM; recording it settles the note", async () => {
  const { world, pc, deed } = await table();
  const claim = { kind: "deed", character: pc.id, name: "Kael", deed: "torture", quote: "Kael heats the blade again" };
  const recorded = [
    { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "relationship_beat", arguments: JSON.stringify({ characterId: pc.id, beat: "cruelty" }) } }] },
    { role: "tool", tool_call_id: "c1", content: JSON.stringify({ ok: true }) },
  ];
  assert.equal(noteUnrecordedDeeds(world.campaign(), recorded, [claim, claim]), 1, "one note, however often it is claimed");
  const note = listActiveFacts(world.campaignId).find((fact) => fact.subject === "unrecorded deed kael");
  assert.ok(note, "a DM-only note");
  assert.equal(note.knownBy, "dm");
  assert.match(note.fact, /record it now with relationship_beat, beat torture/);
  const same = [
    { role: "assistant", content: "", tool_calls: [{ id: "c2", type: "function", function: { name: "relationship_beat", arguments: JSON.stringify({ characterId: pc.id, beat: "torture" }) } }] },
    { role: "tool", tool_call_id: "c2", content: JSON.stringify({ ok: true }) },
  ];
  assert.equal(noteUnrecordedDeeds(world.campaign(), same, [claim]), 0, "a deed the turn recorded needs no note");
  await deed("torture");
  assert.ok(!listActiveFacts(world.campaignId).some((fact) => fact.subject === "unrecorded deed kael"), "recording it settles the note");
});

// ---- dismissal, return and rewind (#503 Phase 0.4) ----

await test("a dismissal keeps the sheet on the row behind the companion, and no departed sheet stays among the party", async () => {
  const { world, sheet, row } = await table();
  const before = world.sheet(sheet.id);
  const gone = await world.invoke("dismiss_companion", { characterId: sheet.id, reason: "She will not travel with a murderer." });
  assert.equal(gone.ok, true, gone.error);
  assert.ok(!world.sheets().some((entry) => entry.id === sheet.id), "listSheets no longer lists her");
  assert.equal(world.sheet(sheet.id), null);
  const departed = conscienceDb.departedSheet(row().id);
  assert.ok(departed, "the row keeps her sheet");
  assert.equal(departed.level, before.level);
  assert.equal(departed.sheet.class, "paladin");
  assert.equal(departed.sheet.name, "Seren");
});

await test("a companion written back in is the same person: their sheet, at the table's level now", async () => {
  const { world, sheet } = await table({ hero: { level: 3 } });
  const row = () => npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren");
  const before = world.sheet(sheet.id);
  await world.invoke("dismiss_companion", { characterId: sheet.id });
  const back = await world.invoke("add_companion", { name: "Seren", class: "wizard", gender: "Female", personality: "Returned.", kind: "party", level: 5 });
  assert.equal(back.ok, true, back.error);
  assert.equal(back.result.returned, true);
  const now = world.sheets().find((entry) => entry.name === "Seren");
  assert.equal(now.class, "paladin", "not a stranger with her name");
  assert.equal(now.level, 5);
  assert.deepEqual(now.abilities.str >= before.abilities.str, true);
  assert.equal(row().companionSheetId, now.id, "the row stands behind the new sheet");
  assert.equal(conscienceDb.departedSheet(row().id), null, "the copy goes once she is back");
  assert.deepEqual(conscienceDb.companionValues(row().id).map((held) => held.value), ["protects_innocent", "keeps_oaths"], "what she holds is kept");
});

await test("rewinding a chapter in which a companion was dismissed puts the sheet and the bot user behind it back", async () => {
  const { world, sheet } = await table();
  ensureOpenChapter(world.campaignId);
  captureBoundarySnapshot(world.campaignId, 1, campaigns.latestSeq(world.campaignId));
  const userId = sheet.userId;
  await world.invoke("dismiss_companion", { characterId: sheet.id });
  assert.equal(getDatabase().prepare("SELECT id FROM users WHERE id = ?").get(userId), undefined, "the bot user went with her");
  const result = await performRollback(world.campaignId, 1);
  assert.equal(result.ok, true, result.error);
  const restored = world.sheet(sheet.id);
  assert.ok(restored, "her sheet is back");
  assert.ok(getDatabase().prepare("SELECT id FROM users WHERE id = ?").get(userId), "and the bot user behind it");
});

await test("rewinding past a recruitment leaves no bot user behind", async () => {
  const world = await openWorld();
  world.addHero({ name: "Kael" });
  ensureOpenChapter(world.campaignId);
  captureBoundarySnapshot(world.campaignId, 1, campaigns.latestSeq(world.campaignId));
  const added = await world.invoke("add_companion", { name: "Late", class: "fighter", gender: "Male", personality: "New.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  const userId = world.sheets().find((entry) => entry.name === "Late").userId;
  const result = await performRollback(world.campaignId, 1);
  assert.equal(result.ok, true, result.error);
  assert.ok(!world.sheets().some((entry) => entry.name === "Late"));
  assert.equal(getDatabase().prepare("SELECT id FROM users WHERE id = ?").get(userId), undefined, "no orphaned bot user");
});

finish();
