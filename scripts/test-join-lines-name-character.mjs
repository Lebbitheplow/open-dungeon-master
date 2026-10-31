// Issue 658: the table's join and companion lines named the player's account
// ("playtester has joined the party as Vesper Lark", "playtester brings a
// companion into the party"). The GM reads those lines, so the account name
// reached the story, as the fight-control notice's did (#594). They name the
// characters now: the hero who joins, the hero who brings a companion, and
// no account at all when the one who acts has no hero.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { LEGAL_FIGHTER, PORTRAIT } from "./lib/enforce-creation.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-join-lines-name-character");

const world = await openWorld({ gameSettings: { companions: "full", maxCompanions: 4, multiCharacter: "all_active" } });
const { announceMidGameJoin } = await import("../src/lib/characters/mid-game-join.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { createCharacter } = await import("../src/lib/db/characters.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const sheetsDb = await import("../src/lib/db/sheets.ts");

const lineAbout = (name) =>
  listRecentMessages(world.campaignId, 20)
    .filter((message) => message.authorType === "system" && message.content.includes(name))
    .at(-1)?.content ?? "";

async function call(name, user, body) {
  const route = await world.route(name);
  world.signIn(user);
  const response = await route.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}

const CREATE = "campaigns/[campaignId]/companions/create";
const ADOPT = "campaigns/[campaignId]/companions/adopt";

const lead = world.addHero({ name: "Vesper Lark" });
const player = world.addUser("player");

await test("a hero who joins in play is named, not their player's account", () => {
  const sheet = sheetsDb.createSheet(world.campaignId, player.id, 1, { ...LEGAL_FIGHTER, name: "Oren Hale" });
  announceMidGameJoin({ campaign: world.campaign(), user: player }, sheet, "Vex");
  const note = lineAbout("Oren Hale");
  assert.ok(!note.includes(player.username), note);
  assert.match(note, /^\[New adventurer\] Oren Hale, a human fighter, joins the party, taking the place of Vex, who fell\./, note);
});

await test("a companion is brought in by the player's hero, not their account", async () => {
  const made = await call(CREATE, world.owner, { sheet: { ...LEGAL_FIGHTER, name: "Sir Ivo Ashford", portrait: PORTRAIT } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const line = lineAbout("Sir Ivo Ashford");
  assert.ok(!line.includes(world.owner.username), line);
  assert.match(line, /^Vesper Lark brings a companion into the party: Sir Ivo Ashford, a human fighter\./, line);
});

await test("whoever runs the story with no hero of their own brings a companion without an account name", async () => {
  // The lead's hero leaves the table: they run the story with none.
  sheetsDb.deleteSheetById(world.campaignId, world.owner.id, lead.id);
  const made = await call(CREATE, world.owner, { sheet: { ...LEGAL_FIGHTER, name: "Brannoc", portrait: PORTRAIT } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const line = lineAbout("Brannoc");
  assert.ok(!line.includes(world.owner.username), line);
  assert.match(line, /^A companion joins the party: Brannoc, a human fighter\./, line);
});

await test("an ally handed to the GM is announced without an account name", async () => {
  const input = createSheetSchema.parse({ ...LEGAL_FIGHTER, name: "Wren", portrait: PORTRAIT });
  const library = createCharacter(player.id, 1, input, "companion");
  const copy = sheetsDb.createSheet(world.campaignId, player.id, 1, input, library.id);
  const handed = await call(ADOPT, world.owner, { sheetId: copy.id });
  assert.equal(handed.status, 200, JSON.stringify(handed.json));
  const line = lineAbout("Wren");
  assert.ok(!line.includes(world.owner.username), line);
  assert.match(line, /^Wren is handed to the GM: from here they travel with the party as a companion/, line);
});

// The other table notes the GM reads, and the plan's "asked by", named the
// account the same way (#658 follow-up).
const latestSystem = () =>
  listRecentMessages(world.campaignId, 20).filter((message) => message.authorType === "system").at(-1)?.content ?? "";

await test("a new party lead is named by their hero in the line the GM reads", async () => {
  // Seated by hand above; a member from here, as a player at the table is.
  const { joinByInviteCode, setCampaignStatus } = await import("../src/lib/db/campaigns.ts");
  setCampaignStatus(world.campaignId, "lobby");
  const joined = joinByInviteCode(player.id, world.campaign().inviteCode);
  setCampaignStatus(world.campaignId, "active");
  assert.ok(!("error" in joined), JSON.stringify(joined));
  const handed = await call("campaigns/[campaignId]/lead", world.owner, { userId: player.id });
  assert.equal(handed.status, 200, JSON.stringify(handed.json));
  const line = latestSystem();
  assert.ok(!line.includes(player.username), line);
  assert.equal(line, "Oren Hale's player is now the party lead.");
});

await test("a request for a companion names the asker's hero, not their account", async () => {
  const asked = await call("campaigns/[campaignId]/companions/request", player, {});
  assert.equal(asked.status, 201, JSON.stringify(asked.json));
  const line = latestSystem();
  assert.ok(!line.includes(player.username), line);
  assert.match(line, /^Oren Hale's player asks the GM to write a companion into the story/);
});

await test("a settled dispute names its raiser's hero, not their account", async () => {
  const { insertDispute } = await import("../src/lib/db/disputes.ts");
  const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
  const dispute = insertDispute({ campaignId: world.campaignId, messageId: "msg-658", raisedByUserId: player.id, reason: "that hit missed", seq: allocateSeq(world.campaignId) });
  const route = await world.route("campaigns/[campaignId]/disputes/[disputeId]");
  world.signIn(player);
  const response = await route.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "withdraw" }) }),
    { params: Promise.resolve({ campaignId: world.campaignId, disputeId: dispute.id }) },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  const line = latestSystem();
  assert.ok(!line.includes(player.username), line);
  assert.equal(line, "Oren Hale's player withdrew their dispute of the last ruling.");
});

await test("a companion's part in the party's plan is asked by the player's hero, not their account", async () => {
  const ivo = sheetsDb.listSheets(world.campaignId).find((sheet) => sheet.name === "Sir Ivo Ashford");
  const oren = sheetsDb.listSheets(world.campaignId).find((sheet) => sheet.name === "Oren Hale");
  const opened = await call("campaigns/[campaignId]/coordination", player, { action: "open", characterIds: [oren.id, ivo.id] });
  assert.ok(opened.status < 300, JSON.stringify(opened.json));
  const asked = await call("campaigns/[campaignId]/coordination", player, { action: "request", characterId: ivo.id, text: "hold the door" });
  assert.ok(asked.status < 300, JSON.stringify(asked.json));
  const entry = asked.json.phase.entries.find((candidate) => candidate.characterId === ivo.id);
  assert.equal(entry.requestedBy, "Oren Hale");
});

await test("one with no hero of their own takes the lead and asks for a companion with no account named", async () => {
  const back = await call("campaigns/[campaignId]/lead", world.owner, { userId: world.owner.id });
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(latestSystem(), "The party has a new lead.");
  const asked = await call("campaigns/[campaignId]/companions/request", world.owner, {});
  assert.equal(asked.status, 201, JSON.stringify(asked.json));
  const line = latestSystem();
  assert.ok(!line.includes(world.owner.username), line);
  assert.match(line, /^A player asks the GM to write a companion into the story/);
});

await test("a spoken line with no character behind it is labelled the GM or a player, never an account", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/app/api/campaigns/[campaignId]/voice/transcript/route.ts", import.meta.url), "utf8");
  assert.match(source, /const speaker = sheet\?\.name \?\? \(isDm\(context\) \? "GM" : storyNameOf\(campaignId, context\.user\.id\) \?\? "A player"\);/);
  assert.doesNotMatch(source, /username/);
});

world.close();
finish();
