// Who may hold a table's prep, through the real route handlers (#154).
//
// At an AI-narrated campaign the party lead steers the story, imports the
// prep, and now also finishes it: the prepared fights and the map library
// answer the lead as they answer a DM, while every other player is still
// refused. A lead does not deploy a fight from the side of a table the
// storyteller runs; they cue it, privately, and the storyteller starts it by
// name with run_prepared_encounter (src/lib/dm/prepared-encounter-tool.ts).
//
// Also the storyboard's link guard: a card may only pick rows of its own
// workshop or its shared workshop (#159), whatever id a client sends.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-prep-routes-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-routes.mjs", import.meta.url);

const { getDatabase, nowIso } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { setCommonWorkshop } = await import("../src/lib/db/workshop-common.ts");
const { getEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
const { preparedFightsBlock, preparedEncounterTools, runPreparedEncounter } = await import(
  "../src/lib/dm/prepared-encounter-tool.ts"
);

const route = (name) => import(new URL(`../src/app/api/${name}/route.ts`, import.meta.url).href);
const campaignsRoute = await route("campaigns");
const templatesRoute = await route("campaigns/[campaignId]/dm/encounter-templates");
const templateRoute = await route("campaigns/[campaignId]/dm/encounter-templates/[templateId]");
const deployRoute = await route("campaigns/[campaignId]/dm/encounter-templates/[templateId]/deploy");
const mapsRoute = await route("campaigns/[campaignId]/dm/maps");
const storyboardRoute = await route("campaigns/[campaignId]/dm/storyboard");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

async function call(mod, method, body, params = {}) {
  const request = new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json() };
}

const lead = createUser("lead", "x");
const player = createUser("player", "x");
const as = (user) => {
  globalThis.__odmTestToken = mintSession(user.id).token;
};

as(lead);
const created = await call(campaignsRoute, "POST", { title: "The Salt Road", gameSettings: { dmMode: "ai" } });
assert.equal(created.status, 201, JSON.stringify(created.json));
const campaignId = created.json.campaign.id;
getDatabase()
  .prepare(`INSERT INTO campaign_members (campaign_id, user_id, role, ready, joined_at) VALUES (?, ?, 'player', 0, ?)`)
  .run(campaignId, player.id, nowIso());
getDatabase().prepare(`UPDATE campaigns SET status = 'active' WHERE id = ?`).run(campaignId);

let templateId = "";

await test("the lead of an AI-narrated table holds the prepared fights", async () => {
  as(lead);
  const list = await call(templatesRoute, "GET", undefined, { campaignId });
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const made = await call(
    templatesRoute,
    "POST",
    { name: "Wreckers on the shingle", enemies: "bandit x2\nbandit captain", battlefield: "a storm beach", map: { scene: "coast" }, notes: "At low tide." },
    { campaignId },
  );
  assert.equal(made.status, 201, JSON.stringify(made.json));
  templateId = made.json.template.id;
  const edited = await call(
    templateRoute,
    "PATCH",
    { extras: { rewards: "A smuggler's map", phases: ["When the captain falls, the rest surrender."] } },
    { campaignId, templateId },
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(getEncounterTemplate(templateId).extras.rewards, "A smuggler's map");
});

await test("the lead opens the map library too", async () => {
  as(lead);
  const maps = await call(mapsRoute, "GET", undefined, { campaignId });
  assert.equal(maps.status, 200, JSON.stringify(maps.json));
});

await test("every other player is still refused the prep", async () => {
  as(player);
  assert.equal((await call(templatesRoute, "GET", undefined, { campaignId })).status, 403);
  assert.equal((await call(mapsRoute, "GET", undefined, { campaignId })).status, 403);
  assert.equal((await call(deployRoute, "POST", {}, { campaignId, templateId })).status, 403);
});

await test("the lead's deploy is a private cue the storyteller reads, not a transcript line", async () => {
  as(lead);
  const before = getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaign_messages WHERE campaign_id = ?`).get(campaignId).n;
  const cued = await call(deployRoute, "POST", {}, { campaignId, templateId });
  assert.equal(cued.status, 200, JSON.stringify(cued.json));
  assert.equal(cued.json.cued, true);
  const after = getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaign_messages WHERE campaign_id = ?`).get(campaignId).n;
  assert.equal(after, before, "the cue was posted where the players read");
  const block = preparedFightsBlock(getCampaignById(campaignId));
  assert.match(block, /\[CUED by the party lead/);
  assert.match(block, /Wreckers on the shingle: .*bandit/);
  const back = await call(deployRoute, "POST", { cue: false }, { campaignId, templateId });
  assert.equal(back.json.cued, false);
  assert.ok(!/CUED/.test(preparedFightsBlock(getCampaignById(campaignId))));
});

await test("the storyteller is offered the fight by name, and running it uses the prepared roster", async () => {
  const campaign = getCampaignById(campaignId);
  assert.equal(preparedEncounterTools(campaign)[0]?.function.name, "run_prepared_encounter");
  let sent = null;
  const result = runPreparedEncounter(campaign, JSON.stringify({ name: "wreckers on the shingle", ambush: "enemies" }), (raw) => {
    sent = JSON.parse(raw);
    return { error: "stopped before the board, on purpose" };
  });
  assert.equal(result.error, "stopped before the board, on purpose");
  assert.deepEqual(
    sent.enemies.map((row) => row.monster),
    getEncounterTemplate(templateId).enemies.map((row) => row.monster),
  );
  // The fight's kind of ground goes to start_encounter; the battlefield line is the DM's to read.
  assert.equal(sent.scene, "coast");
  assert.equal(sent.battlefield, undefined);
  assert.equal(sent.ambush, "enemies");
  const unknown = runPreparedEncounter(campaign, JSON.stringify({ name: "The Kraken" }), () => ({}));
  assert.match(unknown.error, /Wreckers on the shingle/);
});

await test("a card may pick only its own workshop's rows or its shared workshop's", async () => {
  as(lead);
  const chapter = createWorkshop(lead.id, { title: "Chapter" });
  const common = createWorkshop(lead.id, { title: "Common" });
  const elsewhere = createWorkshop(lead.id, { title: "Elsewhere" });
  const npc = (workshopId, name) => {
    const id = crypto.randomUUID();
    getDatabase()
      .prepare(
        `INSERT INTO npcs (id, campaign_id, name, attitude, trait, location, last_shift_turn, created_at, updated_at)
         VALUES (?, ?, ?, 'indifferent', '', '', '', ?, ?)`,
      )
      .run(id, workshopId, name, nowIso(), nowIso());
    return id;
  };
  const shared = npc(common.id, "Marla");
  const foreign = npc(elsewhere.id, "A stranger");
  const refused = await call(storyboardRoute, "POST", { kind: "npc_moment", title: "Meet", links: { npcId: shared } }, { campaignId: chapter.id });
  assert.equal(refused.json.beat.links.npcId, undefined, "a shared row was accepted before the chapter drew on it");
  setCommonWorkshop(chapter, common.id);
  const kept = await call(storyboardRoute, "POST", { kind: "npc_moment", title: "Meet again", links: { npcId: shared } }, { campaignId: chapter.id });
  assert.equal(kept.json.beat.links.npcId, shared);
  const dropped = await call(storyboardRoute, "POST", { kind: "npc_moment", title: "Stranger", links: { npcId: foreign } }, { campaignId: chapter.id });
  assert.equal(dropped.json.beat.links.npcId, undefined, "a link into somebody else's workshop was stored");
  const board = await call(storyboardRoute, "GET", undefined, { campaignId: chapter.id });
  assert.equal(board.json.shared.common.title, "Common");
  assert.ok(board.json.inventory.npcs.some((entry) => entry.id === shared && entry.from === "Common"));
});

removeTempDir(dir);
console.log(`prep authority routes: ${passed} checks passed.`);
