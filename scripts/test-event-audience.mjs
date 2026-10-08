// Deny-by-default delivery (src/lib/event-audience.ts): every event type
// the server publishes is written down with its audience, an undeclared
// type reaches nobody, and the known secrets never reach a seat that may
// not read them, live or on replay. Real seats on a real throwaway
// database: a human DM, a player with a character, and a second player.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-event-audience-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { EVENT_AUDIENCE, audienceOf, isDeclaredEvent } = await import("../src/lib/event-audience.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, joinByInviteCode } = await import("../src/lib/db/campaigns.ts");
const { setDmCover } = await import("../src/lib/db/dm-cover.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { insertRoll } = await import("../src/lib/db/rolls.ts");
const events = await import("../src/lib/events.ts");
const { payloadForViewer, tablePayload, viewerFor } = await import("../src/lib/table-delivery.ts");

let failed = 0;
function test(name, run) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}`);
    console.log(error);
  }
}

// ---- the table is the whole truth ----

// Every `publish*(…, "type"` literal in the server source, the way a
// grep would find it, so a new event type fails here before it ships.
function publishedTypes() {
  const found = new Set();
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && entry.name !== "user-events.ts") {
        // user-events.ts is the per-account bell channel, a different bus
        // that carries nothing but a contentless ping.
        const text = fs.readFileSync(full, "utf8");
        for (const match of text.matchAll(/publish(?:Persisted|Ephemeral|WithSeq)\([^,]+,\s*(?:[^,]+,\s*)?"([a-z_]+)"/g)) {
          found.add(match[1]);
        }
        for (const match of text.matchAll(/sseChunk\("([a-z_]+)"/g)) {
          found.add(match[1]);
        }
      }
    }
  };
  walk(path.join(repo, "src"));
  return found;
}

test("every event type the server publishes is in the audience table, and nothing in the table is dead", () => {
  const published = publishedTypes();
  assert.ok(published.size >= 70, `found ${published.size} published types`);
  const undeclared = [...published].filter((type) => !isDeclaredEvent(type));
  assert.deepEqual(undeclared, [], "published but not in the table");
  const dead = Object.keys(EVENT_AUDIENCE).filter((type) => !published.has(type));
  assert.deepEqual(dead, [], "in the table but never published");
  assert.equal(audienceOf("made_up_event"), null);
});

// ---- real seats ----

const dmUser = createUser("Dungeon Master", "x");
const kara = createUser("Kara", "x");
const brom = createUser("Brom", "x");
const campaign = createCampaign(dmUser.id, {
  title: "Leak test",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: { dmMode: "human" },
});
assert.ok("campaign" in joinByInviteCode(kara.id, campaign.inviteCode));
assert.ok("campaign" in joinByInviteCode(brom.id, campaign.inviteCode));
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const karaSheet = createSheet(
  campaign.id,
  kara.id,
  1,
  createSheetSchema.parse({
    name: "Kara",
    race: "human",
    class: "fighter",
    abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 8 },
    maxHp: 12,
    ac: 16,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: [], languages: [], tools: [], armor: [], weapons: [] },
    notes: "SECRET NOTE: Kara is secretly the baron's daughter",
  }),
);
assert.ok(karaSheet.notes.includes("SECRET NOTE"), "the fixture sheet carries its notes");

// Three listeners, one per seat, each keeping what it was sent.
const heard = { dm: [], kara: [], brom: [] };
const parse = (chunk) => {
  const type = /event: ([a-z_]+)/.exec(chunk)?.[1];
  const data = /data: (.*)\n/.exec(chunk)?.[1];
  return { type, payload: data ? JSON.parse(data) : null };
};
const unsubscribe = [
  events.subscribe(campaign.id, (chunk) => heard.dm.push(parse(chunk)), dmUser.id),
  events.subscribe(campaign.id, (chunk) => heard.kara.push(parse(chunk)), kara.id),
  events.subscribe(campaign.id, (chunk) => heard.brom.push(parse(chunk)), brom.id),
];
const clear = () => {
  heard.dm.length = 0;
  heard.kara.length = 0;
  heard.brom.length = 0;
};
const got = (seat, type) => heard[seat].filter((event) => event.type === type);
const text = (seat, type) => JSON.stringify(got(seat, type));

test("an undeclared event type is sent to nobody, live and on replay", () => {
  clear();
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    events.publishPersisted(campaign.id, "secret_plan", { twist: "THE BARON IS THE LICH" });
    events.publishEphemeral(campaign.id, "secret_whisper", { twist: "THE BARON IS THE LICH" });
  } finally {
    console.error = original;
  }
  for (const seat of ["dm", "kara", "brom"]) {
    assert.equal(heard[seat].length, 0, `${seat} heard an undeclared event`);
  }
  assert.ok(errors.some((line) => line.includes("secret_plan")), "the drop is logged");
  const replayed = [];
  events.forEachEventSince(campaign.id, 0, (event) => replayed.push(event.type), undefined, kara.id);
  assert.ok(!replayed.includes("secret_plan"));
  assert.ok(!events.listEventsSince(campaign.id, 0).some((event) => event.type === "secret_plan"));
});

test("the DM's board record reaches the DM seat only", () => {
  clear();
  events.publishPersisted(campaign.id, "dm_board_action", { note: "The DM hid the ASSASSIN from the party" });
  assert.equal(got("dm", "dm_board_action").length, 1);
  assert.equal(got("kara", "dm_board_action").length, 0);
  assert.equal(got("brom", "dm_board_action").length, 0);
  assert.ok(!JSON.stringify(heard.kara).includes("ASSASSIN"));
});

test("a sheet's notes reach the owner and the DM, never the other player", () => {
  clear();
  events.publishPersisted(campaign.id, "sheet_updated", { sheet: karaSheet });
  assert.ok(text("kara", "sheet_updated").includes("SECRET NOTE"));
  assert.ok(text("dm", "sheet_updated").includes("SECRET NOTE"));
  assert.equal(got("brom", "sheet_updated").length, 1, "Brom still gets the sheet");
  assert.ok(!text("brom", "sheet_updated").includes("SECRET NOTE"));
  // The log never held the notes either.
  assert.ok(!JSON.stringify(events.listEventsSince(campaign.id, 0)).includes("SECRET NOTE"));
});

test("a roll for the DM's eyes reaches the DM with its number and nobody else at all", () => {
  clear();
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: karaSheet.id,
    requestedBy: "dm",
    kind: "check",
    detail: "Insight",
    result: { expression: "1d20", total: 17, terms: [] },
    visibility: "dm",
  });
  events.publishPersisted(campaign.id, "roll_result", { roll, source: "digital" });
  assert.equal(got("dm", "roll_result").length, 1);
  assert.ok(text("dm", "roll_result").includes('"total":17'));
  assert.equal(got("kara", "roll_result").length, 0);
  assert.equal(got("brom", "roll_result").length, 0);
  assert.ok(!JSON.stringify(events.listEventsSince(campaign.id, 0)).includes('"total":17'));
});

test("an enemy's real damage rides only to seats allowed real numbers; the ring and the word reach everyone", () => {
  clear();
  const fx = { id: "fx-1", kind: "hit", at: Date.now(), to: { x: 1, y: 1 }, amount: 23, outcome: "hit", numbers: "dm" };
  events.publishEphemeral(campaign.id, "fx", fx);
  assert.equal(got("dm", "fx").length, 1);
  assert.equal(got("dm", "fx")[0].payload.amount, 23);
  for (const seat of ["kara", "brom"]) {
    assert.equal(got(seat, "fx").length, 1, `${seat} still sees the effect`);
    assert.equal(got(seat, "fx")[0].payload.amount, undefined, `${seat} was sent the number`);
    assert.equal(got(seat, "fx")[0].payload.outcome, "hit");
  }
  // A public roll's effect keeps its number for everyone.
  clear();
  events.publishEphemeral(campaign.id, "fx", { ...fx, id: "fx-2", numbers: "all" });
  assert.equal(got("brom", "fx")[0].payload.amount, 23);
});

test("the DM's cover reaches every seat; the brief handed to the AI stays with the story's keeper", () => {
  clear();
  const cover = { turnsLeft: 3, brief: "KEEP THE TWIST: the innkeeper is the cult's eye", byUserId: dmUser.id, startedAt: new Date().toISOString() };
  setDmCover(campaign.id, cover);
  events.publishPersisted(campaign.id, "dm_cover_changed", { cover });
  assert.equal(got("dm", "dm_cover_changed")[0].payload.cover.brief, cover.brief);
  for (const seat of ["kara", "brom"]) {
    assert.equal(got(seat, "dm_cover_changed").length, 1, `${seat} learns the DM stepped out`);
    assert.equal(got(seat, "dm_cover_changed")[0].payload.cover.turnsLeft, 3);
    assert.equal(got(seat, "dm_cover_changed")[0].payload.cover.brief, "");
  }
  assert.ok(!JSON.stringify(events.listEventsSince(campaign.id, 0)).includes("KEEP THE TWIST"));
  // Replay hands the brief back to the DM seat and to no other.
  const dmReplay = [];
  events.forEachEventSince(campaign.id, 0, (event) => dmReplay.push(event), undefined, dmUser.id);
  assert.ok(JSON.stringify(dmReplay).includes("KEEP THE TWIST"));
  const bromReplay = [];
  events.forEachEventSince(campaign.id, 0, (event) => bromReplay.push(event), undefined, brom.id);
  assert.ok(!JSON.stringify(bromReplay).includes("KEEP THE TWIST"));
  assert.ok(!JSON.stringify(bromReplay).includes("SECRET NOTE"));
  assert.ok(!JSON.stringify(bromReplay).includes("ASSASSIN"));
});

test("a table event reaches every seat as one text", () => {
  clear();
  events.publishPersisted(campaign.id, "title_card", { title: "Chapter 2", at: Date.now() });
  for (const seat of ["dm", "kara", "brom"]) {
    assert.equal(got(seat, "title_card").length, 1);
  }
  // A listener nobody vouched for is sent a table event and nothing seat-bound.
  assert.deepEqual(payloadForViewer("title_card", { title: "x" }, null), { title: "x" });
  assert.equal(payloadForViewer("dm_board_action", { note: "x" }, null), null);
  assert.equal(payloadForViewer("made_up", { note: "x" }, viewerFor(campaign.id, dmUser.id)), null);
  // What the log stores of the two new projections.
  assert.equal(tablePayload("fx", { numbers: "dm", amount: 9 }).amount, undefined);
  assert.equal(tablePayload("dm_cover_changed", { cover: { brief: "b", turnsLeft: 1 } }).cover.brief, "");
});

for (const release of unsubscribe) {
  release();
}
removeTempDir(dir);
if (failed) {
  process.exit(1);
}
console.log("\nevent audience checks passed");
