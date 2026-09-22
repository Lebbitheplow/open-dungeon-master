// The event log's readers behind the pre-1.0 plan's E2 and E3: a replay
// after a long absence hands over every persisted event, not one batch,
// and the snapshot route can read back the newest event of a kind.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-events-replay-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { forEachEventSince, latestEventOfType, listEventsSince, publishPersisted } = await import(
  "../src/lib/events.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });

test("nothing to read on an empty log", () => {
  assert.equal(latestEventOfType(campaign.id, ["title_card"]), null);
  assert.equal(latestEventOfType(campaign.id, []), null);
  assert.equal(forEachEventSince(campaign.id, 0, () => assert.fail("no events yet")), 0);
});

const TOTAL = 1_150;
for (let index = 1; index <= TOTAL; index += 1) {
  publishPersisted(campaign.id, index % 7 === 0 ? "title_card" : "message_added", { index });
}

test("one batch stops at the limit; the replay loop does not", () => {
  assert.equal(listEventsSince(campaign.id, 0).length, 500);
  const seen = [];
  const count = forEachEventSince(campaign.id, 0, (event) => seen.push(event.seq));
  assert.equal(count, TOTAL);
  assert.equal(seen.length, TOTAL);
  for (let index = 1; index < seen.length; index += 1) {
    assert.ok(seen[index] > seen[index - 1], "oldest first, no repeats");
  }
});

test("a replay from the middle picks up exactly what came after", () => {
  const all = [];
  forEachEventSince(campaign.id, 0, (event) => all.push(event.seq));
  const from = all[all.length - 601];
  const seen = [];
  forEachEventSince(campaign.id, from, (event) => seen.push(event.seq));
  assert.equal(seen.length, 600);
  assert.equal(seen[0], all[all.length - 600]);
  assert.equal(forEachEventSince(campaign.id, all[all.length - 1], () => {}), 0);
});

test("a smaller batch size reaches the same end", () => {
  let count = 0;
  forEachEventSince(campaign.id, 0, () => (count += 1), 64);
  assert.equal(count, TOTAL);
});

test("the newest event of a kind, and of several kinds", () => {
  const card = latestEventOfType(campaign.id, ["title_card"]);
  assert.equal(card.type, "title_card");
  assert.equal(card.payload.index, 1148, "the last multiple of seven");
  const either = latestEventOfType(campaign.id, ["title_card", "message_added"]);
  assert.equal(either.payload.index, TOTAL);
  assert.equal(latestEventOfType(campaign.id, ["handout_shown"]), null);
});

test("a dismissal lands after the handout it names", () => {
  publishPersisted(campaign.id, "handout_shown", { id: "h1", title: "A letter" });
  const shown = latestEventOfType(campaign.id, ["handout_shown"]);
  publishPersisted(campaign.id, "handout_dismissed", { id: "h1" });
  const dismissed = latestEventOfType(campaign.id, ["handout_dismissed"]);
  assert.ok(dismissed.seq > shown.seq);
  assert.equal(dismissed.payload.id, "h1");
});

// Windows refuses to delete a database file that is still open, so the
// connection goes first.
globalThis.__localRoleplayDb?.close();
removeTempDir(dir);
console.log(`\n${passed} event replay tests passed.`);
