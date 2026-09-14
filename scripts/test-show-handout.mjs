// Show this now (docs/vtt-parity-implementation-plan.md section 5.2): the
// model may show only what the party may read, a person may show what
// they like, and the event carries the entry's audience.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-handout-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { insertLoreEntry } = await import("../src/lib/db/lore.ts");
const { handleDismissHandout, handleShowHandout } = await import("../src/lib/dm/binder-tools.ts");
const { subscribe } = await import("../src/lib/events.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
const live = () => getCampaignById(campaign.id);
const events = [];
subscribe(campaign.id, (chunk) => events.push(String(chunk)));

const secret = insertLoreEntry({ campaignId: campaign.id, category: "history", title: "The truth", body: "x", tags: [], visibility: "dm" });
const letter = insertLoreEntry({ campaignId: campaign.id, category: "other", title: "Marla's letter", body: "Come at dusk.", tags: [], style: "parchment", audience: ["u1"] });
const aiTurn = { actor: "ai" };
const humanTurn = { actor: "human_dm" };

test("the model is refused a DM-only entry; a person is not", () => {
  const refused = handleShowHandout(live(), aiTurn, JSON.stringify({ loreId: secret.id }));
  assert.match(refused.error, /secret/);
  const shown = handleShowHandout(live(), humanTurn, JSON.stringify({ loreId: secret.id }));
  assert.equal(shown.ok, true);
});

test("a party entry publishes a persisted handout with its audience and style", () => {
  const before = events.length;
  const shown = handleShowHandout(live(), aiTurn, JSON.stringify({ loreId: letter.id, caption: "Found under the door" }));
  assert.equal(shown.ok, true);
  const event = events.slice(before).find((chunk) => chunk.includes("handout_shown"));
  assert.ok(event, "a handout_shown event went out");
  assert.ok(event.includes('"style":"parchment"'));
  assert.ok(event.includes('"audience":["u1"]'));
  assert.ok(event.includes('"caption":"Found under the door"'));
  assert.ok(/^id: \d+/m.test(event), "persisted, so a late joiner replays it");
});

test("a bare picture must be an uploaded file, and dismissing names the handout", () => {
  assert.ok("error" in handleShowHandout(live(), humanTurn, JSON.stringify({ imagePath: "https://elsewhere/x.png" })));
  const ok = handleShowHandout(live(), humanTurn, JSON.stringify({ imagePath: "/uploads/abc.png", caption: "A map" }));
  assert.equal(ok.ok, true);
  const before = events.length;
  handleDismissHandout(live(), JSON.stringify({ handoutId: ok.handoutId }));
  assert.ok(events.slice(before).some((chunk) => chunk.includes("handout_dismissed") && chunk.includes(ok.handoutId)));
  assert.ok("error" in handleShowHandout(live(), humanTurn, "{}"));
});

test("a stranger's entry is not shown", () => {
  const other = createCampaign(dm.id, { title: "O", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  assert.ok("error" in handleShowHandout(getCampaignById(other.id), humanTurn, JSON.stringify({ loreId: letter.id })));
});

console.log(`test-show-handout: ${passed} passed`);
