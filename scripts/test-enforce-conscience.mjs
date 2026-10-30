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
const { conscienceBlockForPrompt, conscienceViews, STORYTELLER_VIEW } = await import("../src/lib/dm/conscience.ts");
const { noteUnrecordedDeeds } = await import("../src/lib/dm/deed-claims.ts");
const { dmTurnTools } = await import("../src/lib/dm/turn.ts");
const { buildGameStateBlock } = await import("../src/lib/dm/prompt.ts");
const { THIS_MOMENT_HEADING } = await import("../src/lib/prompt-boundary.ts");
const { conscienceSecretLines } = await import("../src/lib/dm/conscience.ts");
const { recordBeat } = await import("../src/lib/dm/beats.ts");
const { passiveScore } = await import("../src/lib/dm/check-tools.ts");
const { computeSheetDerived } = await import("../src/lib/srd/index.ts");
const whispers = await import("../src/lib/db/dm-whispers.ts");
const rolls = await import("../src/lib/db/rolls.ts");

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
  const rung = () => conscienceViews(world.campaign(), STORYTELLER_VIEW).get(sheet.name.toLowerCase())?.rung;
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
  const loyalToNobody = await world.invoke("add_companion", {
    name: "Ash",
    class: "fighter",
    gender: "Male",
    personality: "Quiet.",
    kind: "party",
    values: [{ value: "faction_loyalty", strength: "cares" }],
  });
  assert.equal(loyalToNobody.ok, false, "a faction loyalty with no faction is refused, not dropped");
  assert.ok(!world.sheets().some((entry) => entry.name === "Ash"), "nothing was added");
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
  const view = conscienceViews(world.campaign(), STORYTELLER_VIEW).get("seren");
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
  assert.equal(conscienceViews(world.campaign(), STORYTELLER_VIEW).size, 0, "the Bonds tab shows no ladder");
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
    ["betrayal", "broke_word", "cruelty", "desecration", "freed_captives", "laid_to_rest", "mercy", "murder_helpless", "necromancy", "slaving", "theft_from_poor", "torture", "upheld_law"],
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
  // While she still follows them, GAME STATE names whose orders she waits
  // for by the character too: the account name reached the narration.
  const party = buildGameStateBlock({ campaign: world.campaign(), members: campaigns.listMembers(world.campaignId), sheets: world.sheets(), recentRolls: [], storySummary: "", contextLimitTokens: 32_000 });
  assert.match(party, /in fights Kael commands them: on their turn wait for Kael's orders/);
  assert.ok(!party.includes(`${world.owner.username}'s orders`), "never the account's orders");
  await deed("cruelty");
  assert.equal(world.sheet(sheet.id).commandedBy, world.owner.id, "uneasy is not yet a warning");
  const warned = await deed("broke_word");
  assert.equal(warned.result.conscience, "uneasy -> warning");
  assert.equal(world.sheet(sheet.id).commandedBy, null, "command ends");
  assert.match(warned.result.note, /no longer takes Kael's orders in a fight/, "the GM is told the character, not the account");
  const told = messages.listRecentMessages(world.campaignId, 3).find((message) => message.content.includes("no longer takes"));
  assert.ok(told, "the table is told");
  assert.match(told.content, /no longer takes Kael's orders in a fight/, "the table reads the player's character");
  assert.ok(!told.content.includes(`${world.owner.username}'s`), "never the account name");
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
  const { world, pc, bond, rung, row } = await table();
  relationships.patchRelationship(bond()?.id ?? relationships.ensureRelationship({ campaignId: world.campaignId, characterId: pc.id, characterName: "Kael", subjectKind: "companion", subjectName: "Seren" }).id, { approval: -20 });
  world.dice(1);
  const talked = await world.invoke("social_check", { characterId: pc.id, npc: "Seren", approach: "intimidate" });
  world.clearDice();
  assert.equal(talked.ok, true, talked.error);
  assert.ok(bond().approval <= -25, `standing fell (${bond().approval})`);
  assert.equal(rung(), "warning", "disliked is a warning");
  // A road no tool reports is said at the table all the same (issue 615).
  assert.deepEqual(conscienceDb.companionConscience(row().id).owed, { rung: "warning" }, "owed to the table, with no deed to name");
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

// ---- said at the table (issue 615) ----

// A table a person runs (the owner, as its GM) with two players: Kael and
// Brin, and Seren, an even-tempered paladin unless a test says otherwise.
async function humanTable({ gameSettings = {}, composure = 0, kael = {}, brin = {} } = {}) {
  const world = await openWorld({ gameSettings: { dmMode: "human", companions: "full", ...gameSettings } });
  const kaelUser = world.addUser("kael");
  const brinUser = world.addUser("brin");
  const kaelSheet = world.addHero({ user: kaelUser, name: "Kael", gender: "Male", ...kael });
  const brinSheet = world.addHero({ user: brinUser, name: "Brin", gender: "Female", ...brin });
  const added = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", alignment: "LG", personality: "Stern.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  const sheet = world.sheets().find((entry) => entry.name === "Seren");
  const row = () => npcs.listNpcs(world.campaignId).find((npc) => npc.companionSheetId === sheet.id);
  npcs.patchNpcAgency(row().id, { personality: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure } });
  const deed = (beat, extra = {}) => world.invoke("relationship_beat", { characterId: kaelSheet.id, subject: "Seren", beat, ...extra });
  const narrate = async (content) => {
    world.signIn(world.owner);
    const route = await world.route("campaigns/[campaignId]/dm/narrate");
    const response = await route.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ content }) }), { params: Promise.resolve({ campaignId: world.campaignId }) });
    assert.equal(response.status, 201, await response.clone().text());
    return messages.getCampaignMessage((await response.json()).messageId);
  };
  // Lines the server posted as Seren's own, newest last.
  const hers = () =>
    messages
      .listRecentMessages(world.campaignId, 60)
      .filter((message) => message.authorType === "dm" && message.speech.some((line) => line.speaker.kind === "pc" && line.speaker.id === sheet.id) && !message.userId);
  const bonds = async (user) => {
    world.signIn(user);
    const handler = await world.route("campaigns/[campaignId]/relationships");
    const response = await handler.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
    const body = await response.json();
    return body.relationships.find((entry) => entry.subjectName === "Seren" && entry.conscience)?.conscience;
  };
  return { world, kael: kaelSheet, brin: brinSheet, kaelUser, brinUser, sheet, row, deed, narrate, hers, bonds };
}

await test("an ultimatum the GM's narration leaves out is posted once, as Seren's own line, right after it", async () => {
  const t = await humanTable();
  await t.deed("cruelty");
  await t.deed("broke_word");
  const third = await t.deed("torture", { demand: "Free the captives you took", deadlineHours: 6 });
  assert.match(third.result.note, /or the server posts their line after it/, "the GM is told what happens if they do not");
  assert.equal(t.hers().length, 0, "nothing posted before a narration");
  const narration = await t.narrate("The cellar door creaks in the wind, and nobody speaks.");
  const posted = t.hers();
  assert.equal(posted.length, 1, "exactly one line");
  const [line] = posted;
  assert.ok(line.seq > narration.seq, "after the narration in the transcript");
  assert.match(line.content, /^Seren: "Free the captives you took\. By .+, or I am done with this company\."$/);
  assert.equal(line.speech.length, 1);
  assert.deepEqual(line.speech[0].speaker, { kind: "pc", id: t.sheet.id, name: "Seren" }, "her face and voice");
  assert.ok(line.content.includes(`"${line.speech[0].line}"`), "the stored line is the quoted one");
  assert.equal(messages.getLatestDmMessage(t.world.campaignId).id, narration.id, "the newest narration an X-card, a picture or a reroll means is still the GM's passage");
  await t.narrate("They walk on toward the river.");
  assert.equal(t.hers().length, 1, "a second narration posts nothing more");
  const kael = await t.bonds(t.kaelUser);
  assert.equal(kael.rung, "ultimatum", "once said, the table knows it");
  assert.equal(kael.ultimatum.condition, "Free the captives you took");
});

await test("a narration that says the demand in her words posts nothing; the Bonds tab follows what was said", async () => {
  const t = await humanTable();
  await t.deed("cruelty");
  await t.deed("broke_word");
  await t.deed("torture", { demand: "Free the captives you took", deadlineHours: 6 });
  const kaelBefore = await t.bonds(t.kaelUser);
  assert.equal(kaelBefore.rung, "content", "the players heard nothing yet");
  assert.equal(kaelBefore.ultimatum, null, "nor the terms");
  const gm = await t.bonds(t.world.owner);
  assert.equal(gm.rung, "ultimatum", "whoever runs the story sees the truth");
  assert.equal(gm.unheard, true, "and that the table has not heard it");
  assert.equal(gm.ultimatum.condition, "Free the captives you took");
  assert.match(conscienceBlockForPrompt(t.world.campaign(), t.world.sheets()), /not yet heard at the table: voice it this reply/);
  await t.narrate('Seren rounds on Kael. "Free the captives you took before the sun is down," Seren says.');
  assert.equal(t.hers().length, 0, "said in the narration: nothing posted");
  const kaelAfter = await t.bonds(t.kaelUser);
  assert.equal(kaelAfter.rung, "ultimatum");
  assert.equal(kaelAfter.ultimatum.condition, "Free the captives you took");
  assert.equal((await t.bonds(t.world.owner)).unheard, undefined, "nothing left unsaid");
  assert.doesNotMatch(conscienceBlockForPrompt(t.world.campaign(), t.world.sheets()), /not yet heard/);
});

await test("a warning left unsaid gets her line too, naming the deed the table saw", async () => {
  const t = await humanTable();
  await t.deed("cruelty");
  const warned = await t.deed("broke_word");
  assert.match(warned.result.note, /moves from uneasy to warning: .+ or the server posts their line after it/);
  await t.narrate("The road winds on.");
  const [line] = t.hers();
  assert.ok(line, "posted");
  assert.match(line.content, /^Seren: "A broken word by Kael: I will not stand for it again\. That stops now\."$/);
  assert.equal((await t.bonds(t.brinUser)).rung, "warning", "every seat heard it");
});

await test("a beat that says the warning clears it and posts nothing; one that does not leaves it for the next narration", async () => {
  const t = await humanTable();
  await t.deed("cruelty");
  await t.deed("broke_word");
  recordBeat(t.world.campaign(), t.world.owner.id, { body: "We rode on in silence.", kind: "scene", source: "typed" });
  assert.equal(t.hers().length, 0, "a beat never posts");
  assert.equal((await t.bonds(t.world.owner)).unheard, true, "still owed");
  recordBeat(t.world.campaign(), t.world.owner.id, { body: '"Never again," Seren told Kael.', kind: "scene", source: "typed" });
  assert.equal(t.hers().length, 0);
  assert.equal((await t.bonds(t.world.owner)).unheard, undefined, "said in the beat");
  assert.equal((await t.bonds(t.kaelUser)).rung, "warning");
  await t.narrate("Dawn comes grey.");
  assert.equal(t.hers().length, 0, "nothing left to post");
});

await test("a composed companion keeps unease in: a hidden Deception against passive Insight, whispered only to the one who noticed", async () => {
  const t = await humanTable({ composure: 2, kael: { abilities: { wis: 20 } }, brin: { abilities: { wis: 6 } } });
  const kaelSees = passiveScore(t.world.campaign(), t.world.sheet(t.kael.id), "insight");
  const brinSees = passiveScore(t.world.campaign(), t.world.sheet(t.brin.id), "insight");
  assert.ok(kaelSees - brinSees >= 4, `room between them (${kaelSees} against ${brinSees})`);
  const deception = computeSheetDerived(t.world.sheet(t.sheet.id)).skills.deception ?? 0;
  // A total Brin's passive cannot beat and Kael's can.
  const face = Math.max(1, Math.min(20, brinSees - deception));
  t.world.dice(face);
  const done = await t.deed("cruelty");
  t.world.clearDice();
  assert.equal(done.ok, true, done.error);
  assert.equal(done.result.conscience, undefined, "the result names no hidden move");
  assert.doesNotMatch(done.result.note, /conscience moves/, "nor does the note");
  const read = rolls.listRecentRolls(t.world.campaignId, 10).find((roll) => /Seren: Deception, hiding their unease/.test(roll.detail));
  assert.ok(read, "the read is a stored roll");
  assert.equal(read.visibility, "secret", "rolled where no player sees it");
  assert.ok(read.total < kaelSees && read.total >= brinSees, `Kael beats ${read.total}, Brin does not`);
  const toKael = whispers.listWhispersForUser(t.world.campaignId, t.kaelUser.id).map((entry) => entry.content);
  const toBrin = whispers.listWhispersForUser(t.world.campaignId, t.brinUser.id).map((entry) => entry.content);
  assert.ok(toKael.some((text) => /Kael catches something in Seren.+Only you noticed\./.test(text)), "Kael's player is told");
  assert.ok(!toBrin.some((text) => /Seren/.test(text)), "Brin's is not");
  assert.deepEqual(await t.bonds(t.kaelUser), { rung: "uneasy", ultimatum: null, noticed: true }, "Kael's player reads it, theirs alone");
  assert.deepEqual(await t.bonds(t.brinUser), { rung: "content", ultimatum: null }, "Brin's reads nothing");
  assert.deepEqual(await t.bonds(t.world.owner), { rung: "uneasy", ultimatum: null, hidden: { noticedBy: ["Kael"] } }, "whoever runs the story reads who noticed");
  await t.narrate("The fire burns low.");
  assert.equal(t.hers().length, 0, "unease kept in is never posted");
});

await test("unease kept in sits in the storyteller's section, never in the moment part of GAME STATE", async () => {
  const t = await humanTable({ composure: 1, kael: { abilities: { wis: 20 } }, brin: { abilities: { wis: 6 } } });
  const brinSees = passiveScore(t.world.campaign(), t.world.sheet(t.brin.id), "insight");
  const deception = computeSheetDerived(t.world.sheet(t.sheet.id)).skills.deception ?? 0;
  t.world.dice(Math.max(1, Math.min(20, brinSees - deception)));
  await t.deed("cruelty");
  t.world.clearDice();
  const moment = conscienceBlockForPrompt(t.world.campaign(), t.world.sheets());
  assert.match(moment, /Seren: holds .+; content/, "the moment reads her as the table sees her");
  assert.doesNotMatch(moment, /uneasy|cruelty by Kael/);
  const secret = conscienceSecretLines(t.world.campaign(), t.world.sheets()).join("\n");
  assert.match(secret, /Seren is uneasy, but they keep it in: play them as content/);
  assert.match(secret, /Kael noticed: show Kael a tell/);
  const state = {
    campaign: t.world.campaign(),
    members: campaigns.listMembers(t.world.campaignId),
    sheets: t.world.sheets(),
    recentRolls: [],
    storySummary: "",
    contextLimitTokens: 32_000,
    conscienceBlock: moment,
    storytellerLines: conscienceSecretLines(t.world.campaign(), t.world.sheets()),
  };
  const rendered = buildGameStateBlock(state);
  assert.match(rendered, /Storyteller secrets[\s\S]*Seren is uneasy, but they keep it in/, "carried in the storyteller's section");
  // A night's watch reads her again: Brin, who missed it, may catch it now.
  t.world.dice(1);
  const rest = await t.world.invoke("take_rest", { kind: "long" });
  t.world.clearDice();
  assert.equal(rest.ok, true, rest.error);
  assert.match(conscienceSecretLines(t.world.campaign(), t.world.sheets()).join("\n"), /Kael and Brin noticed: show each of them a tell/);
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
