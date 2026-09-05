// Campaign cover art: the prompt builder, the cover column's round trip
// through the real modules against a throwaway encrypted database, and the
// one-query playingAs helper the shells' home screen reads (friends test
// pattern).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-cover-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { buildCoverPrompt, coverStatus } = await import("../src/lib/campaign-cover.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const {
  createCampaign,
  getCampaignById,
  getCampaignForUser,
  listCampaignsForUser,
  normalizeCampaignCover,
  setCampaignCover,
} = await import("../src/lib/db/campaigns.ts");
const { createSheet, markSheetAsCompanion, playingAsByCampaign } = await import(
  "../src/lib/db/sheets.ts"
);
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { presetFor } = await import("../src/lib/worlds/preset.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// nowIso has millisecond resolution; two writes in the same tick would tie.
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

test("the prompt carries the campaign's words and the world's art style", () => {
  const prompt = buildCoverPrompt({
    title: "Ashes of Thornhold",
    description: "A border keep falls silent and the crows will not land there.",
    theme: "grim, autumnal",
    genre: "high_fantasy",
  });
  assert.ok(prompt.includes('"Ashes of Thornhold"'));
  assert.ok(prompt.includes("crows will not land"));
  assert.ok(prompt.includes("grim, autumnal"));
  assert.ok(prompt.includes(presetFor({ genre: "high_fantasy" }).portraitStyle));
  assert.ok(prompt.includes("no text"));
  assert.ok(prompt.startsWith("Tabletop RPG campaign cover art"));
});

test("empty fields drop out cleanly and a missing pack falls back to the genre", () => {
  const prompt = buildCoverPrompt({
    title: "",
    description: "",
    theme: "",
    genre: "high_fantasy",
    worldPack: "no-such-pack",
  });
  assert.ok(!prompt.includes('""'));
  assert.ok(!prompt.includes(".."));
  assert.equal(
    prompt,
    buildCoverPrompt({ title: "", description: "", theme: "", genre: "high_fantasy" }),
  );
});

test("the prompt is deterministic and bounded", () => {
  const input = {
    title: "Long",
    description: "x".repeat(2000),
    theme: "",
    genre: "high_fantasy",
  };
  assert.equal(buildCoverPrompt(input), buildCoverPrompt(input));
  assert.ok(buildCoverPrompt(input).length < 700);
});

test("normalizeCampaignCover trusts only our own upload paths", () => {
  assert.equal(normalizeCampaignCover(null), null);
  assert.equal(normalizeCampaignCover({ id: "x", url: "https://evil.example/x.png" }), null);
  assert.equal(normalizeCampaignCover({ id: "x", url: "/uploads/../secret.png" }), null);
  assert.deepEqual(normalizeCampaignCover({ id: "abc", url: "/uploads/abc.png" }), {
    id: "abc",
    url: "/uploads/abc.png",
  });
  // A row with only a url still gets an id, derived from the filename.
  assert.deepEqual(normalizeCampaignCover({ url: "/uploads/def.webp" }), {
    id: "def",
    url: "/uploads/def.webp",
  });
});

const alice = createUser("alice", "x");
const bob = createUser("bob", "x");
const campaign = createCampaign(alice.id, {
  title: "Ashes of Thornhold",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
});

test("a new campaign has no cover and no render in flight", () => {
  assert.equal(campaign.cover, null);
  assert.equal(coverStatus(campaign.id), null);
});

test("setting a cover stores it, touches updated_at, and lists it on the summary", () => {
  const before = getCampaignById(campaign.id).updatedAt;
  pause(5);
  assert.equal(setCampaignCover(campaign.id, { id: "c1", url: "/uploads/c1.png" }), true);
  const after = getCampaignById(campaign.id);
  assert.deepEqual(after.cover, { id: "c1", url: "/uploads/c1.png" });
  assert.notEqual(after.updatedAt, before);
  assert.deepEqual(getCampaignForUser(campaign.id, alice.id).cover, after.cover);
  const listed = listCampaignsForUser(alice.id).find((entry) => entry.id === campaign.id);
  assert.deepEqual(listed.cover, after.cover);
});

test("a cover that is not one of our uploads is refused and nothing changes", () => {
  assert.equal(setCampaignCover(campaign.id, { id: "e", url: "https://evil.example/e.png" }), false);
  assert.equal(setCampaignCover(campaign.id, { id: "e", url: "/uploads/../../etc/passwd" }), false);
  assert.deepEqual(getCampaignById(campaign.id).cover, { id: "c1", url: "/uploads/c1.png" });
});

test("clearing the cover puts the placeholder back", () => {
  assert.equal(setCampaignCover(campaign.id, null), true);
  assert.equal(getCampaignById(campaign.id).cover, null);
  assert.equal(setCampaignCover("no-such-campaign", null), false);
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
    proficiencies: {
      saves: ["str", "con"],
      skills: [],
      languages: [],
      tools: [],
      armor: [],
      weapons: [],
    },
  });

test("playingAs names the caller's own character per campaign, and never a companion", () => {
  const second = createCampaign(alice.id, {
    title: "Second Table",
    description: "",
    theme: "",
    maxPlayers: 4,
    startingLevel: 1,
    difficulty: "normal",
  });
  createSheet(campaign.id, alice.id, 1, sheetInput("Vex"));
  // A companion at the second table is a bot's sheet, filed under alice's
  // id only for this test to prove the filter; it must not count.
  const companion = createSheet(second.id, alice.id, 1, sheetInput("Faithful Hound"));
  markSheetAsCompanion(companion.id, "party", "loyal");

  const mine = playingAsByCampaign(alice.id);
  assert.equal(mine.get(campaign.id), "Vex");
  assert.equal(mine.get(second.id), undefined);
  assert.equal(playingAsByCampaign(bob.id).size, 0);
});

console.log(`${passed} campaign cover tests passed`);
