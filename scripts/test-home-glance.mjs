// The title screen's glance at a table (src/lib/db/home-glance.ts) and the
// home's own helpers (src/app/home/types.ts): what "when last we left" says,
// which table the screen opens on, and the lines under the save slots.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-home-glance-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { clipRecap, homeGlanceFor, partyFacesByCampaign } = await import("../src/lib/db/home-glance.ts");
const { agoLabel, chapterLine, pickContinue, romanNumeral, seatLine, slotLine } = await import("../src/app/home/types.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { allocateSeq, createCampaign, joinByInviteCode } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`not ok - ${name}`);
    console.log(error);
  }
}

// ---- clipRecap ----

test("clipRecap keeps the first paragraph and drops roll markers and emphasis", () => {
  assert.equal(
    clipRecap("[roll:7183e805-0eb0-43ae-ac40-7b0922358b2d] The *bolt* dies against wet salt.\n\nThe husk turns."),
    "The bolt dies against wet salt.",
  );
});

test("clipRecap skips a paragraph that was only dice", () => {
  assert.equal(clipRecap("[roll:7183e805-0eb0-43ae-ac40-7b0922358b2d]\n\nWhat do you do?"), "What do you do?");
  assert.equal(clipRecap("[roll:7183e805-0eb0-43ae-ac40-7b0922358b2d]"), "");
});

test("clipRecap ends a long passage at a sentence", () => {
  const sentence = "The lantern above you is still lit, and nobody can say who lit it. ";
  const long = sentence.repeat(12);
  const clipped = clipRecap(long, 200);
  assert.ok(clipped.length <= 200, "within the limit");
  assert.ok(clipped.endsWith("."), `ends at a sentence: ${clipped.slice(-20)}`);
});

test("clipRecap falls back to a word boundary and an ellipsis when no sentence fits", () => {
  const long = "word ".repeat(80).trim();
  const clipped = clipRecap(long, 100);
  assert.ok(clipped.endsWith("…"));
  assert.ok(clipped.length <= 101);
});

// ---- the home helpers ----

const day = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-09-24T12:00:00Z");
const iso = (offsetMs) => new Date(now + offsetMs).toISOString();

test("agoLabel is coarse and readable", () => {
  assert.equal(agoLabel(iso(-30_000), now), "just now");
  assert.equal(agoLabel(iso(-5 * 60_000), now), "5 minutes ago");
  assert.equal(agoLabel(iso(-3 * 3_600_000), now), "3 hours ago");
  assert.equal(agoLabel(iso(-day), now), "yesterday");
  assert.equal(agoLabel(iso(-5 * day), now), "5 days ago");
  assert.equal(agoLabel(iso(-3 * 7 * day), now), "3 weeks ago");
  assert.equal(agoLabel(iso(-400 * day), now), "a year ago");
  assert.equal(agoLabel(null, now), "");
  assert.equal(agoLabel("not a date", now), "");
});

test("romanNumeral covers the chapters a campaign reaches", () => {
  assert.equal(romanNumeral(1), "I");
  assert.equal(romanNumeral(4), "IV");
  assert.equal(romanNumeral(9), "IX");
  assert.equal(romanNumeral(14), "XIV");
  assert.equal(romanNumeral(0), "0");
});

const base = (over) => ({
  id: "c",
  title: "Embers",
  description: "A drowned coast turned to black glass.",
  status: "active",
  playerCount: 4,
  maxPlayers: 5,
  playingAs: null,
  dmUserId: null,
  assistantDmUserId: null,
  leadUserId: "u1",
  updatedAt: iso(-2 * day),
  startingLevel: 3,
  difficulty: "normal",
  ...over,
});

test("pickContinue prefers a live table and falls back to the newest finished one", () => {
  const live = base({ id: "live", updatedAt: iso(-10 * day) });
  const lobby = base({ id: "lobby", status: "lobby", updatedAt: iso(-day) });
  const endedOld = base({ id: "ended-old", status: "ended", updatedAt: iso(-3 * day) });
  const endedNew = base({ id: "ended-new", status: "ended", updatedAt: iso(-2 * day) });
  assert.equal(pickContinue([live, lobby, endedNew])?.id, "lobby", "the most recently touched live table");
  assert.equal(pickContinue([endedOld, endedNew])?.id, "ended-new", "an account with only finished tales opens on the newest");
  assert.equal(pickContinue([]), null);
});

test("seatLine says who you are at the table", () => {
  assert.equal(seatLine(base({ status: "lobby", playerCount: 3, maxPlayers: 4 }), "u1"), "Lobby · 3 of 4 ready");
  assert.equal(seatLine(base({ playingAs: "Thane Ordwin" }), "u1"), "Playing as Thane Ordwin · 4 of 5 seats");
  assert.equal(seatLine(base({ dmUserId: "u1" }), "u1"), "Running the table · 4 of 5 seats");
  assert.equal(seatLine(base({ maxPlayers: 1, playerCount: 1, playingAs: "Sera" }), "u1"), "Playing as Sera · solo");
  assert.equal(seatLine(base({}), "u9"), "No character yet · 4 of 5 seats");
});

test("chapterLine reads the chapter, then the scene, then the description", () => {
  assert.equal(chapterLine(base({ glance: { chapter: { index: 3, title: "The Drowned Lantern" } } })), "Chapter III · The Drowned Lantern");
  assert.equal(chapterLine(base({ scene: "Halvord's Reach", glance: { chapter: { index: 1, title: "" } } })), "Chapter I · Halvord's Reach");
  assert.equal(chapterLine(base({ scene: "Halvord's Reach" })), "Halvord's Reach");
  assert.equal(chapterLine(base({})), "A drowned coast turned to black glass.");
});

test("slotLine states the table in a few words", () => {
  assert.equal(slotLine(base({ status: "lobby", playerCount: 3, maxPlayers: 4 }), "u1"), "3 of 4 ready");
  assert.match(slotLine(base({ status: "ended" }), "u1"), /^Finished /);
  assert.equal(slotLine(base({ dmUserId: "u1" }), "u1"), "Running the table");
  assert.match(slotLine(base({}), "u9"), /^Last played /);
});

// ---- the glance against a real table ----

const alice = createUser("alice", "hash");
const bob = createUser("bob", "hash");
const campaign = createCampaign(alice.id, {
  title: "Embers of the Saltglass Coast",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 3,
  difficulty: "normal",
});
const sheetInput = (name) =>
  createSheetSchema.parse({
    name,
    race: "human",
    class: "fighter",
    abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 8 },
    maxHp: 12,
    ac: 16,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: [], languages: [], tools: [], armor: [], weapons: [] },
  });

test("a fresh table has no recap, no chapter, no painting and no faces", () => {
  const glance = homeGlanceFor(campaign.id, []);
  assert.deepEqual(glance, { chapter: null, recap: "", recapAt: null, sceneImage: null, faces: [] });
});

test("the glance carries the last narration that said something, the newest painting and the party's faces", () => {
  createSheet(campaign.id, alice.id, 1, sheetInput("Thane Ordwin"));
  joinByInviteCode(bob.id, campaign.inviteCode);
  const companion = createSheet(campaign.id, bob.id, 1, sheetInput("Faithful Hound"));
  // A companion is not a face on the title screen.
  getDatabase().prepare("UPDATE character_sheets SET is_companion = 1 WHERE id = ?").run(companion.id);
  insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "dm", content: "Two husks of salt-glass crawled from the tide-line.\n\nSera's fire bolt went wide." });
  insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId: alice.id, content: "I hold the line." });
  insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "dm", content: "[roll:7183e805-0eb0-43ae-ac40-7b0922358b2d] [roll:e9990e5b-aa8b-4a33-911f-009e49cd2837]" });
  const faces = partyFacesByCampaign([campaign.id], new Map([[campaign.id, "high-fantasy"]]));
  const glance = homeGlanceFor(campaign.id, faces.get(campaign.id) ?? []);
  assert.equal(glance.recap, "Two husks of salt-glass crawled from the tide-line.", "a turn that was only dice is not the recap");
  assert.ok(glance.recapAt, "the recap carries its time");
  const names = glance.faces.map((face) => face.name);
  assert.ok(names.includes("Thane Ordwin"), "the hero has a face");
  assert.ok(!names.includes("Faithful Hound"), "the companion is not");
  assert.ok(glance.faces.every((face) => face.url.length > 0), "every face has a picture");
});

removeTempDir(dir);
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("home glance: all passed");
