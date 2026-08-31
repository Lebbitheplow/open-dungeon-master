// The workshop end to end, against a real encrypted SQLite file.
//
// Every other suite here drives a pure module. This one is deliberately
// different, because the load-bearing claim of docs/workshop-plan.md is a
// claim about the DATABASE: that a workshop can be a campaigns row without
// behaving like a table that plays, and that importing prep is a row copy
// between two campaign ids. Neither is provable without a database.
//
// Self-contained: it makes its own throwaway key and its own temp file
// before importing anything, so it needs no environment and touches no real
// data. The temp file is removed on the way out.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const selfPath = fileURLToPath(import.meta.url);

// A child run reopens the same file to prove the schema migration, so both
// modes need the same key and path. The parent hands them down through the
// environment it already set for itself.
const dbPath = process.env.ODM_TEST_DB || path.join(mkdtempSync(path.join(os.tmpdir(), "odm-workshop-")), "test.sqlite");
const dbKey = process.env.ODM_TEST_KEY || randomBytes(32).toString("hex");
process.env.SQLITE_DB_PATH = dbPath;
process.env.DB_ENCRYPTION_KEY = dbKey;

register("./lib/register-alias.mjs", import.meta.url);

// Stub the MiniLM embedder before anything can trigger it. src/lib/
// embeddings.ts caches the pipeline on this global (for dev HMR), which
// makes it the natural seam: without it this suite would either download a
// model or spend its run logging caught failures, and neither says anything
// about a workshop. With it, "did the copy get indexed" becomes assertable.
globalThis.__odmEmbedderPromise = Promise.resolve((texts) =>
  Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) }),
);

const reopening = process.argv[2] === "--reopen";

const { getDatabase, nowIso } = await import("../src/lib/db/core.ts");
const db = getDatabase();

// ---- child mode: the upgrade path ----

if (reopening) {
  // The parent dropped campaigns.kind to imitate a database written before
  // the column existed. Opening it again runs ensureSchema, which must add
  // the column back and read every pre-existing row as a table that plays.
  const columns = db.prepare(`PRAGMA table_info(campaigns)`).all().map((column) => column.name);
  assert.ok(columns.includes("kind"), "reopening did not re-add campaigns.kind");
  const rows = db.prepare(`SELECT kind FROM campaigns`).all();
  assert.ok(rows.length > 0, "the fixture rows vanished");
  for (const row of rows) {
    assert.equal(row.kind, "campaign", "an existing row did not upgrade to 'campaign'");
  }
  console.log("  upgrade path: column restored, existing rows read as campaigns.");
  process.exit(0);
}

// ---- parent mode ----

const {
  createCampaign,
  getCampaignById,
  listCampaignsForUser,
} = await import("../src/lib/db/campaigns.ts");
const {
  createWorkshop,
  getWorkshopForUser,
  listWorkshopsForUser,
  setWorkshopTargetParty,
} = await import("../src/lib/db/workshops.ts");
const { insertLoreEntry, listLoreEntries } = await import("../src/lib/db/lore.ts");
const { getHouseRulesText, setHouseRules } = await import("../src/lib/db/rules.ts");
const { planContentImport, runContentImport } = await import(
  "../src/lib/db/content-import.ts"
);
const { applyRulesetToCampaign, captureRulesetFromCampaign, createRuleset } = await import(
  "../src/lib/db/rulesets.ts"
);
const { requestDmTurn } = await import("../src/lib/dm/loop.ts");
const { getPreparedMap, listPreparedMaps } = await import("../src/lib/db/prepared-maps.ts");
const { createLibraryMap, paintLibraryMap } = await import("../src/lib/dm/map-library.ts");
const { TERRAIN, tileAt } = await import("../src/lib/battlemap/types.ts");
const { createNpcFromDraft, getNpcById, listNpcs, updateNpcFromDraft } = await import(
  "../src/lib/db/npcs.ts"
);
const { normalizeNpcDraft } = await import("../src/lib/npcs/forge.ts");
const { createCharacter, listCharactersForUser } = await import("../src/lib/db/characters.ts");
const { createHomebrewMonster, findHomebrewMonster, listHomebrewMonsters } = await import(
  "../src/lib/bestiary/homebrew-monsters.ts"
);
const { checkMonsterDraft } = await import("../src/lib/bestiary/monster-draft.ts");
const { resolveEnemyRequests } = await import("../src/lib/dm/encounter-spawn.ts");
const { templateDifficulty } = await import("../src/lib/dm/encounter-templates.ts");
const { insertEncounterTemplate, listEncounterTemplates } = await import(
  "../src/lib/db/encounter-templates.ts"
);
const { insertBeat, listBeats } = await import("../src/lib/db/workshop-beats.ts");
const { checkBeat } = await import("../src/lib/workshop/board.ts");
const { listNotesVisibleTo } = await import("../src/lib/db/notes.ts");
const { encounterCeiling, thresholdsForParty } = await import(
  "../src/lib/srd/encounter-math.ts"
);
const { exportWorkshopBundle, importWorkshopBundle } = await import(
  "../src/lib/db/workshop-bundle.ts"
);
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { runsAiTurns } = await import("../src/lib/workshop/kind.ts");
const deleteBeatModule = await import("../src/lib/db/workshop-beats.ts");
const updateBeatModule = deleteBeatModule;

let passed = 0;
const pending = [];
function test(name, fn) {
  const result = fn();
  // A few checks have to wait on the background indexing pass; collecting
  // their promises keeps the synchronous ones reading as before.
  if (result && typeof result.then === "function") {
    pending.push(result.then(() => {
      passed += 1;
    }));
  } else {
    passed += 1;
  }
}

// Lets the fire-and-forget embedding work settle. Two turns of the macrotask
// queue is enough with a stubbed embedder; the real one is never used here.
const flushEmbeddings = () =>
  new Promise((resolve) => setTimeout(resolve, 0)).then(
    () => new Promise((resolve) => setTimeout(resolve, 0)),
  );

const userId = randomUUID();
db.prepare(
  `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)`,
).run(userId, `tester-${userId.slice(0, 8)}`, nowIso());

// ---- the schema ----

test("the migration adds campaigns.kind and the ruleset library", () => {
  const columns = db.prepare(`PRAGMA table_info(campaigns)`).all().map((column) => column.name);
  assert.ok(columns.includes("kind"));
  assert.ok(db.prepare(`PRAGMA table_info(library_rulesets)`).all().length > 0);
});

// ---- the isolation guards, against real rows ----

const workshop = createWorkshop(userId, {
  title: "Saltmarch prep",
  targetParty: { size: 5, level: 4 },
});

test("a workshop seats its creator as the DM and never narrates on its own", () => {
  assert.equal(workshop.kind, "workshop");
  assert.equal(workshop.gameSettings.dmMode, "human");
  assert.equal(workshop.dmUserId, userId);
  assert.equal(workshop.gameSettings.aiStorySetup, false);
  assert.equal(workshop.gameSettings.worldSimulation, false);
});

test("a workshop carries the party it is building for", () => {
  assert.deepEqual(workshop.gameSettings.targetParty, { size: 5, level: 4 });
  assert.equal(workshop.startingLevel, 4, "starting_level should mirror the target level");
});

test("a workshop never appears in the campaign list", () => {
  assert.equal(listCampaignsForUser(userId).length, 0);
  assert.equal(listWorkshopsForUser(userId).length, 1);
});

test("a workshop never wakes the AI DM", () => {
  // The guard that makes the shadow-campaign design safe.
  assert.equal(requestDmTurn(workshop.id), false);
});

const campaign = createCampaign(userId, {
  title: "The real table",
  description: "",
  theme: "",
  maxPlayers: 5,
  startingLevel: 1,
  difficulty: "normal",
});

test("an ordinary campaign is unaffected by any of it", () => {
  assert.equal(campaign.kind, "campaign");
  assert.equal(listCampaignsForUser(userId).length, 1);
  assert.equal(requestDmTurn(campaign.id), true, "a real campaign was refused a DM turn");
});

test("a campaign id cannot be used where a workshop id is meant", () => {
  assert.equal(getWorkshopForUser(campaign.id, userId), null);
});

test("another user's workshop is not reachable", () => {
  assert.equal(getWorkshopForUser(workshop.id, randomUUID()), null);
});

// ---- filling the workshop ----

insertLoreEntry({
  campaignId: workshop.id,
  category: "geography",
  title: "The Saltmarch",
  body: "A drowned fen the sea keeps taking back.",
  tags: [],
});
insertLoreEntry({
  campaignId: workshop.id,
  category: "factions",
  title: "The Ashen League",
  body: "Smugglers who own the harbour watch.",
  tags: [],
});
setHouseRules(workshop.id, "Potions:\nDrinking a potion is a bonus action.");
const insertPlace = (campaignId, name, visited, current) =>
  db
    .prepare(
      `INSERT INTO locations
         (id, campaign_id, name, layout_description, connections_json, visited, is_current,
          created_at, updated_at)
       VALUES (?, ?, ?, '', '[]', ?, ?, ?, ?)`,
    )
    .run(randomUUID(), campaignId, name, visited, current, nowIso(), nowIso());
insertPlace(workshop.id, "Rusted Anchor Inn", 1, 1);
db.prepare(
  `INSERT INTO roll_tables (id, campaign_id, name, entries_json, created_by_user_id, created_at, updated_at)
   VALUES (?, ?, 'Harbour rumours', '[]', ?, ?, ?)`,
).run(randomUUID(), workshop.id, userId, nowIso(), nowIso());
// The campaign already has a place by the same name in a different case,
// which is exactly what the locations UNIQUE ... COLLATE NOCASE forbids.
insertPlace(campaign.id, "rusted anchor inn", 0, 0);

const SELECTION = ["lore", "locations", "tables", "houseRules"];

test("planning reports the counts and the collision before anything is written", () => {
  const plan = planContentImport(workshop.id, campaign.id, SELECTION);
  assert.equal(plan.counts.lore, 2);
  assert.equal(plan.counts.locations, 1);
  assert.ok(plan.warnings.some((warning) => /already exist/i.test(warning.message)));
  // Planning must not write.
  assert.equal(listLoreEntries(campaign.id).length, 0);
});

const outcome = runContentImport({
  sourceId: workshop.id,
  campaignId: campaign.id,
  selection: SELECTION,
  houseRulesMode: "replace",
});

test("the import succeeds", () => {
  assert.ok(!outcome.error, `import failed: ${outcome.error}`);
  assert.ok(outcome.copied > 0);
});

test("lore arrives", () => {
  assert.equal(listLoreEntries(campaign.id).length, 2);
});

test("a colliding place is numbered rather than failing the transaction", () => {
  const places = db
    .prepare(`SELECT name, visited, is_current FROM locations WHERE campaign_id = ?`)
    .all(campaign.id);
  assert.equal(places.length, 2);
  const copied = places.find((place) => place.name === "Rusted Anchor Inn (2)");
  assert.ok(copied, `collision was not numbered: ${JSON.stringify(places)}`);
});

test("an imported place has not been visited and is nobody's current location", () => {
  // The workshop's copy was marked visited and current. Carrying that across
  // would tell a campaign that has not started that it has already travelled.
  const copied = db
    .prepare(`SELECT visited, is_current FROM locations WHERE campaign_id = ? AND name = ?`)
    .get(campaign.id, "Rusted Anchor Inn (2)");
  assert.equal(copied.visited, 0);
  assert.equal(copied.is_current, 0);
});

test("imported house rules are chunked for retrieval, not just stored", () => {
  assert.match(getHouseRulesText(campaign.id), /bonus action/);
  const chunks = db
    .prepare(`SELECT COUNT(*) AS count FROM rule_chunks WHERE campaign_id = ?`)
    .get(campaign.id);
  assert.ok(chunks.count > 0, "house rules landed without chunks, so retrieval cannot see them");
});

test("imported lore is queued for retrieval indexing", async () => {
  // The copy skips the per-insert embed to keep the import one transaction,
  // so the catch-up pass is the only thing that indexes it. If that pass is
  // ever dropped, imported lore silently becomes keyword-only.
  await flushEmbeddings();
  const unindexed = db
    .prepare(`SELECT COUNT(*) AS count FROM lore_entries WHERE campaign_id = ? AND embedding IS NULL`)
    .get(campaign.id);
  assert.equal(unindexed.count, 0, "imported lore never got embedded");
});

test("the import copies rather than moves", () => {
  assert.equal(listLoreEntries(workshop.id).length, 2);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS count FROM locations WHERE campaign_id = ?`).get(workshop.id)
      .count,
    1,
  );
});

test("a workshop refuses to import into itself", () => {
  const result = runContentImport({
    sourceId: workshop.id,
    campaignId: workshop.id,
    selection: SELECTION,
    houseRulesMode: "replace",
  });
  assert.ok(result.error);
});

test("importing nothing is a no-op rather than an error", () => {
  const result = runContentImport({
    sourceId: workshop.id,
    campaignId: campaign.id,
    selection: [],
    houseRulesMode: "replace",
  });
  assert.ok(!result.error);
  assert.equal(result.copied, 0);
});

// ---- rulesets ----

test("applying a ruleset writes the variant flags and appends the prose", () => {
  const ruleset = createRuleset(userId, {
    name: "Gritty table",
    description: "",
    variantRules: {
      ...campaign.gameSettings.variantRules,
      encumbrance: true,
      restVariant: "gritty",
    },
    houseRulesText: "Rests:\nA long rest is a week.",
    homebrewIds: [],
  });
  applyRulesetToCampaign(ruleset, campaign.id, "append");
  const after = getCampaignById(campaign.id);
  assert.equal(after.gameSettings.variantRules.encumbrance, true);
  assert.equal(after.gameSettings.variantRules.restVariant, "gritty");
  const text = getHouseRulesText(campaign.id);
  assert.match(text, /bonus action/, "append dropped what the table already had");
  assert.match(text, /a week/, "append dropped the incoming rules");
});

test("capturing a table's rules round-trips them into the library", () => {
  const captured = captureRulesetFromCampaign(userId, campaign.id, "Captured");
  assert.equal(captured.variantRules.encumbrance, true);
  assert.equal(captured.variantRules.restVariant, "gritty");
  assert.match(captured.houseRulesText, /a week/);
});

// ---- the map library ----
//
// A workshop has no party and so can never open a scene, which is exactly
// why prepared maps exist: without them the workshop's map tab could only
// roll previews it had nowhere to put.

const blank = createLibraryMap(workshop, {
  name: "Undercroft",
  width: 20,
  height: 15,
  blank: "rock",
}).map;

test("a blank map is solid rock inside a walled border", () => {
  assert.equal(blank.terrain.length, 20 * 15);
  assert.equal(tileAt(blank.terrain, 20, 10, 7), TERRAIN.wall);
  assert.equal(tileAt(blank.terrain, 20, 0, 0), TERRAIN.wall);
});

test("a prepared map belongs to the workshop and not to any encounter", () => {
  // The whole point of the separate table: no encounter row, no tokens, no
  // fog, so nothing in the combat lifecycle has to learn about prep.
  assert.equal(blank.campaignId, workshop.id);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM battle_maps WHERE campaign_id = ?`).get(workshop.id).n,
    0,
  );
});

test("stamping a room carves it out of the rock", () => {
  const painted = paintLibraryMap(workshop, blank.id, {
    stamp: { kind: "room", x: 10, y: 7, width: 5, height: 5 },
  });
  assert.ok(!painted.error, painted.error);
  assert.equal(tileAt(painted.map.terrain, 20, 10, 7), TERRAIN.floor);
  assert.equal(tileAt(painted.map.terrain, 20, 13, 7), TERRAIN.wall, "the room has no east wall");
  // And it is the STORED map that changed, not a copy handed back.
  assert.equal(tileAt(getPreparedMap(workshop.id, blank.id).terrain, 20, 10, 7), TERRAIN.floor);
});

test("a brush stroke on a stored map goes through the same painter", () => {
  const painted = paintLibraryMap(workshop, blank.id, {
    strokes: [{ x: 10, y: 7, brush: "water" }],
  });
  assert.ok(!painted.error, painted.error);
  assert.equal(tileAt(painted.map.terrain, 20, 10, 7), TERRAIN.water);
});

test("a prepared map cannot have its border opened either", () => {
  // paintTerrain refuses to touch the edge, and the library gets that for
  // free by not reimplementing it.
  const painted = paintLibraryMap(workshop, blank.id, {
    strokes: [{ x: 0, y: 7, brush: "floor" }],
  });
  assert.ok(!painted.error, painted.error);
  assert.equal(tileAt(painted.map.terrain, 20, 0, 7), TERRAIN.wall, "the border was opened");
});

test("a second map with the same name is numbered, not refused", () => {
  // prepared_maps has UNIQUE (campaign_id, name COLLATE NOCASE), so this is
  // a failed transaction if the dedupe is wrong, not a cosmetic problem.
  const again = createLibraryMap(workshop, { name: "undercroft", blank: "ground" }).map;
  assert.notEqual(again.name, blank.name);
  assert.match(again.name, /\(2\)$/);
});

test("a map with no name is refused rather than filed as Untitled", () => {
  assert.ok(createLibraryMap(workshop, { name: "   ", blank: "rock" }).error);
});

test("a rolled map is reproducible from its seed", () => {
  const rolled = createLibraryMap(workshop, { name: "Rolled", seed: 12345 }).map;
  const again = createLibraryMap(workshop, { name: "Rolled again", seed: 12345 }).map;
  assert.equal(rolled.seed, 12345);
  assert.equal(rolled.terrain, again.terrain, "the same seed gave a different map");
});

test("a backdrop path this app did not write is stored as no backdrop", () => {
  db.prepare(`UPDATE prepared_maps SET backdrop_path = ? WHERE id = ?`).run(
    "/uploads/../../etc/passwd",
    blank.id,
  );
  assert.equal(getPreparedMap(workshop.id, blank.id).backdrop, null);
  db.prepare(`UPDATE prepared_maps SET backdrop_path = '' WHERE id = ?`).run(blank.id);
});

test("maps come across on an import and the workshop keeps its own", () => {
  const before = listPreparedMaps(workshop.id).length;
  assert.ok(before >= 2, "the fixture should have several maps by now");
  runContentImport({
    sourceId: workshop.id,
    campaignId: campaign.id,
    selection: ["maps"],
    houseRulesMode: "replace",
  });
  assert.equal(listPreparedMaps(campaign.id).length, before, "the copy is short");
  assert.equal(listPreparedMaps(workshop.id).length, before, "the import moved rather than copied");
});

test("importing the same maps twice numbers them instead of failing", () => {
  const before = listPreparedMaps(campaign.id).length;
  runContentImport({
    sourceId: workshop.id,
    campaignId: campaign.id,
    selection: ["maps"],
    houseRulesMode: "replace",
  });
  const after = listPreparedMaps(campaign.id);
  assert.equal(after.length, before * 2);
  assert.equal(new Set(after.map((map) => map.name.toLowerCase())).size, after.length);
});

// ---- the NPC forge ----
//
// The agency model has been reachable only by the AI DM's tools since it was
// built. These are the assertions that a person writing an NPC by hand gets
// the same row the tools would have produced, and that a workshop is a place
// they can do it.

const draftOf = (input) => {
  const result = normalizeNpcDraft(input);
  assert.ok(!result.error, result.error);
  return result.draft;
};

const marla = createNpcFromDraft(
  workshop.id,
  draftOf({
    name: "Marla Venn",
    aliases: ["Captain Marla"],
    attitude: "friendly",
    trait: "one eye and a harbourmaster's ledger",
    location: "the Saltmarch docks",
    personality: { warmth: -2, drive: 2, boldness: 1 },
    goals: {
      scene: "Get paid",
      session: { text: "Buy out the harbour watch", progress: 1, target: 4 },
      ambition: "Own every berth from the light to the fen",
    },
    relations: [{ npcName: "Toma", score: -2, note: "took her berth" }],
  }),
);

test("a hand-written NPC keeps everything the agency model can hold", () => {
  const stored = getNpcById(marla.id);
  assert.equal(stored.name, "Marla Venn");
  assert.deepEqual(stored.aliases, ["Captain Marla"]);
  assert.equal(stored.attitude, "friendly");
  assert.equal(stored.agency.personality.warmth, -2);
  assert.equal(stored.agency.personality.drive, 2);
  assert.equal(stored.agency.goals.session.target, 4);
  assert.equal(stored.agency.goals.ambition, "Own every berth from the light to the fen");
  assert.equal(stored.agency.relations[0].note, "took her berth");
});

test("a workshop is a place to write a cast, because it is a campaign row", () => {
  assert.equal(marla.campaignId, workshop.id);
  assert.equal(listNpcs(campaign.id).length, 0, "the real table should still be empty");
});

test("an NPC written by hand starts unarchived and with no face", () => {
  assert.equal(marla.archived, false);
  assert.equal(marla.portraitUrl, "");
});

test("editing an NPC does not touch the counters the engine owns", () => {
  // The pressure meter is moved by the chapter engine and the arc cast link
  // is name-matched; a form that wrote either would be overwriting something
  // mid-flight.
  db.prepare(`UPDATE npcs SET pressure_json = ?, arc_cast_id = ? WHERE id = ?`).run(
    JSON.stringify({ ignored: 3, engaged: 1 }),
    "cast-7",
    marla.id,
  );
  const updated = updateNpcFromDraft(
    workshop.id,
    marla.id,
    draftOf({
      name: "Marla Venn",
      aliases: ["Captain Marla"],
      trait: "one eye",
      attitude: "hostile",
      personality: { warmth: -2, drive: 2, boldness: 1 },
      goals: { ambition: "Own every berth from the light to the fen" },
      relations: [{ npcName: "Toma", score: -2, note: "took her berth" }],
    }),
  );
  assert.equal(updated.attitude, "hostile", "the edit did not land");
  assert.equal(updated.agency.pressure.ignored, 3, "the pressure meter was reset");
  assert.equal(updated.arcCastId, "cast-7", "the arc cast link was cleared");
});

test("an edit writes the whole record, so a draft is never a partial patch", () => {
  // Worth pinning down rather than discovering: the panel always sends the
  // whole draft, and a caller that sent half of one would silently erase the
  // other half. This is the write that upsertNpc deliberately is not.
  const before = getNpcById(marla.id);
  assert.ok(before.agency.personality, "the fixture should have a personality here");
  updateNpcFromDraft(workshop.id, marla.id, draftOf({ name: "Marla Venn" }));
  assert.equal(getNpcById(marla.id).agency.personality, null);
  assert.equal(getNpcById(marla.id).agency.relations.length, 0);
  // Put her back, because the import below copies whatever is on the row.
  updateNpcFromDraft(workshop.id, marla.id, draftOf({
    name: "Marla Venn",
    aliases: ["Captain Marla"],
    trait: "one eye and a harbourmaster's ledger",
    location: "the Saltmarch docks",
    attitude: "friendly",
    personality: { warmth: -2, drive: 2, boldness: 1 },
    goals: { ambition: "Own every berth from the light to the fen" },
    relations: [{ npcName: "Toma", score: -2, note: "took her berth" }],
  }));
});

test("an NPC in another campaign cannot be edited through this one", () => {
  assert.equal(updateNpcFromDraft(campaign.id, marla.id, draftOf({ name: "Nobody" })), null);
  assert.equal(getNpcById(marla.id).name, "Marla Venn");
});

test("a portrait path this app did not write reads back as no face", () => {
  db.prepare(`UPDATE npcs SET portrait_url = ? WHERE id = ?`).run(
    "/uploads/../../etc/passwd",
    marla.id,
  );
  assert.equal(getNpcById(marla.id).portraitUrl, "");
  db.prepare(`UPDATE npcs SET portrait_url = ? WHERE id = ?`).run("/uploads/face.png", marla.id);
  assert.equal(getNpcById(marla.id).portraitUrl, "/uploads/face.png");
});

test("a cast written in a workshop travels into a campaign", () => {
  runContentImport({
    sourceId: workshop.id,
    campaignId: campaign.id,
    selection: ["npcs"],
    houseRulesMode: "replace",
  });
  const [copy] = listNpcs(campaign.id);
  assert.ok(copy, "nobody came across");
  assert.equal(copy.name, "Marla Venn");
  assert.equal(copy.agency.personality.warmth, -2, "the personality did not travel");
  assert.equal(copy.portraitUrl, "/uploads/face.png", "the face did not travel");
  // The relation names travel; the ids they would have pointed at do not
  // exist at the target, which is exactly why relations are keyed by name.
  assert.equal(copy.agency.relations[0].npcName, "Toma");
});

// ---- the companion library ----

test("a library entry written before the role column reads as a player character", () => {
  const character = createCharacter(userId, 5, {
    name: "Bregan",
    race: "human",
    class: "fighter",
    subclass: "champion",
    background: "soldier",
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
    maxHp: 44,
    hitDice: { total: 5, spent: 0 },
  });
  assert.equal(character.role, "pc");
  db.prepare(`UPDATE library_characters SET role = '' WHERE id = ?`).run(character.id);
  assert.equal(
    listCharactersForUser(userId).find((entry) => entry.id === character.id).role,
    "pc",
    "an empty role should read as a player character, which is what every old row is",
  );
});

test("a companion is the same sheet filed under a different role", () => {
  const companion = createCharacter(
    userId,
    5,
    {
      name: "Sera",
      race: "elf",
      class: "cleric",
      subclass: "life",
      background: "acolyte",
      abilities: { str: 10, dex: 12, con: 14, int: 10, wis: 16, cha: 12 },
      maxHp: 38,
      hitDice: { total: 5, spent: 0 },
    },
    "companion",
  );
  assert.equal(companion.role, "companion");
  const companions = listCharactersForUser(userId, "companion");
  assert.equal(companions.length, 1);
  assert.equal(companions[0].name, "Sera");
  assert.ok(
    listCharactersForUser(userId, "pc").every((entry) => entry.name !== "Sera"),
    "a companion turned up in the player-character list",
  );
  assert.ok(
    listCharactersForUser(userId).length > companions.length,
    "the unfiltered list should still hold everyone",
  );
});

// ---- retargeting ----

test("retargeting the party updates the setting and the starting level together", () => {
  const retargeted = setWorkshopTargetParty(workshop, { level: 9 });
  assert.equal(retargeted.level, 9);
  assert.equal(retargeted.size, 5, "an unspecified field should keep its value");
  const reread = getWorkshopForUser(workshop.id, userId);
  assert.equal(reread.gameSettings.targetParty.level, 9);
  assert.equal(reread.startingLevel, 9);
});

// ---- phase 6: a hand-built monster reaching the table ----

const boneTyrant = createHomebrewMonster(
  userId,
  checkMonsterDraft({
    name: "Bone Tyrant",
    cr: 4,
    ac: 16,
    maxHp: 120,
    attacksPerTurn: 2,
    attacks: [{ name: "Rusted Greatsword", toHit: 6, damage: "2d6+4", type: "slashing" }],
    traits: ["Undead Fortitude: drops to 1 hit point instead of 0 on a save."],
  }).draft,
  "A knight's armour walking with nobody inside it.",
);

test("a hand-built monster is stored where the pickers already look", () => {
  const mine = listHomebrewMonsters(userId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].draft.name, "Bone Tyrant");
  // The slug is the one src/lib/content hands out for homebrew rows, so a
  // picker and the resolver agree about what to call it.
  assert.equal(mine[0].slug, `homebrew:${boneTyrant.id}`);
  assert.equal(findHomebrewMonster(userId, "bone tyrant").id, boneTyrant.id);
});

test("another DM's bestiary is not reachable", () => {
  assert.equal(listHomebrewMonsters(randomUUID()).length, 0);
  assert.equal(findHomebrewMonster(randomUUID(), "Bone Tyrant"), null);
});

test("the rating is derived from the block rather than trusted from the client", () => {
  // Written as CR 4 with CR 4 numbers, so the two should agree; what matters
  // is that a rating exists at all without anybody typing one.
  const readout = listHomebrewMonsters(userId)[0].readout;
  assert.equal(typeof readout.derived.cr, "number");
  assert.ok(readout.derived.parts.length > 0, "the rating arrived with no working shown");
});

test("a hand-built monster resolves the way start_encounter resolves one", () => {
  // The whole point of phase 6: a monster built in the workshop has to reach
  // the board through the ordinary path, not a second one.
  const outcome = resolveEnemyRequests(
    workshop.gameSettings,
    [{ monster: "Bone Tyrant", count: 2 }],
    userId,
  );
  assert.ok(!("unknownMonster" in outcome), "the bestiary could not find its own monster");
  assert.equal(outcome.resolved.length, 2);
  assert.equal(outcome.resolved[0].name, "Bone Tyrant");
  assert.equal(outcome.resolved[0].stats.maxHp, 120);
});

test("without an owner the resolver behaves exactly as it did before", () => {
  const outcome = resolveEnemyRequests(workshop.gameSettings, [{ monster: "Bone Tyrant" }]);
  assert.ok("unknownMonster" in outcome);
});

// ---- phase 6: a prepared fight is costed against the party being built for ----

insertEncounterTemplate({
  campaignId: workshop.id,
  name: "Wolves in the yard",
  enemies: [{ monster: "Bone Tyrant", count: 1 }],
  battlefield: "",
  map: {},
  notes: "",
  createdByUserId: userId,
});

test("a workshop costs a fight against its target party, not a party of one", () => {
  // This was wrong before phase 6: with no character sheets the readout fell
  // back to a single character at the starting level, so every prepared
  // fight in a workshop read far deadlier than it is.
  const current = getWorkshopForUser(workshop.id, userId);
  const { size, level } = current.gameSettings.targetParty;
  const [template] = listEncounterTemplates(workshop.id);
  const readout = templateDifficulty(current, template.enemies);
  assert.equal(readout.unknownMonster, null);

  const forTheParty = encounterCeiling(
    "normal",
    thresholdsForParty(Array.from({ length: size }, () => level)).deadly,
  );
  const forOneCharacter = encounterCeiling("normal", thresholdsForParty([level]).deadly);
  assert.equal(readout.ceiling, forTheParty);
  assert.notEqual(readout.ceiling, forOneCharacter, "still budgeting for a solo adventurer");
});

test("a campaign with no sheets still reads as it always did", () => {
  // The fix is scoped to workshops. A campaign whose players have not rolled
  // up yet answers with one character at the level it starts at, which is
  // what this has always done.
  const target = getCampaignById(campaign.id);
  const readout = templateDifficulty(target, [{ monster: "Bone Tyrant", count: 1 }]);
  assert.equal(
    readout.ceiling,
    encounterCeiling(target.difficulty, thresholdsForParty([target.startingLevel]).deadly),
  );
});

// ---- phase 7: the storyboard, compiled into a real campaign ----

const boardCards = [
  ["backstory", "The flood", "The river took the lower village.", []],
  ["setting", "The mill", "Half-drowned and still turning.", []],
  ["hook", "A missing daughter", "", ["evt"]],
  ["event", "The wheel stops", "Something is jamming it.", []],
  ["npc_moment", "Marla confesses", "", []],
  ["encounter", "Wolves in the yard", "Three of them, hungry.", []],
  ["secret", "The miller did it", "For the insurance money.", []],
];
const beatIds = {};
for (const [kind, title, body] of boardCards) {
  const created = insertBeat(workshop.id, checkBeat({ kind, title, body }).beat);
  beatIds[title] = created.id;
}
// The arrow has to be drawn after both cards exist.
{
  const hook = listBeats(workshop.id).find((beat) => beat.title === "A missing daughter");
  const event = listBeats(workshop.id).find((beat) => beat.title === "The wheel stops");
  const { updateBeat } = await import("../src/lib/db/workshop-beats.ts");
  updateBeat(workshop.id, hook.id, { ...hook, edges: [event.id] });
}

const boardTarget = createCampaign(userId, {
  title: "A table for the board",
  description: "",
  theme: "",
  maxPlayers: 5,
  startingLevel: 1,
  difficulty: "normal",
});

test("the board appears in the import picker with its size", () => {
  const plan = planContentImport(workshop.id, boardTarget.id, ["storyboard"]);
  assert.equal(plan.counts.storyboard, 1);
  assert.match(plan.items[0].name, /7 cards/);
});

const boardOutcome = runContentImport({
  sourceId: workshop.id,
  campaignId: boardTarget.id,
  selection: ["storyboard"],
  houseRulesMode: "replace",
});

test("every kind of card lands somewhere that already existed", () => {
  assert.ok(!("error" in boardOutcome), boardOutcome.error);
  const lore = listLoreEntries(boardTarget.id);
  assert.equal(lore.length, 2, "places and history did not become lore");
  assert.ok(lore.some((entry) => entry.title === "The flood" && entry.category === "history"));
  assert.ok(lore.some((entry) => entry.title === "The mill" && entry.category === "geography"));

  const templates = listEncounterTemplates(boardTarget.id);
  assert.equal(templates.length, 1);
  assert.equal(templates[0].name, "Wolves in the yard");
  // The board says a fight belongs here, not what is in it.
  assert.deepEqual(templates[0].enemies, []);

  const after = getCampaignById(boardTarget.id);
  assert.deepEqual(after.questLog, ["A missing daughter"]);
});

test("a secret becomes a DM-only note and nothing the party can read", () => {
  const notes = listNotesVisibleTo(boardTarget.id, userId, true);
  const secret = notes.find((note) => note.title === "The miller did it");
  assert.ok(secret, "the secret did not become a note");
  assert.equal(secret.visibility, "private");
  assert.equal(secret.authorKind, "dm");
  // It must not also be readable as lore or as a quest.
  assert.ok(!listLoreEntries(boardTarget.id).some((entry) => entry.title === secret.title));
  assert.ok(!getCampaignById(boardTarget.id).questLog.includes(secret.title));
});

test("the board becomes the campaign's spine when it has none", () => {
  const arc = getCampaignById(boardTarget.id).storyArc;
  assert.ok(arc, "no arc was written");
  assert.match(arc.premise, /The flood/);
  // The hook points at the event, so the beats read in that order.
  assert.equal(arc.beats.length, 2);
  assert.ok(arc.beats.some((beat) => /The wheel stops/.test(beat.text)));
});

test("an arc the table has been playing is never written over", () => {
  // Overwriting it would delete the campaign's memory of itself: beats
  // marked done, detail accreted from actual play.
  const before = getCampaignById(boardTarget.id).storyArc;
  const plan = planContentImport(workshop.id, boardTarget.id, ["storyboard"]);
  assert.ok(
    plan.warnings.some((warning) => /already has a story arc/.test(warning.message)),
    "the import did not warn that an arc exists",
  );
  runContentImport({
    sourceId: workshop.id,
    campaignId: boardTarget.id,
    selection: ["storyboard"],
    houseRulesMode: "replace",
  });
  const after = getCampaignById(boardTarget.id).storyArc;
  assert.deepEqual(after.beats, before.beats, "the arc was overwritten");
});

test("a second import numbers its copies rather than failing on the collision", () => {
  // The lore titles collided on the second run above; nothing threw and both
  // sets are present.
  const titles = listLoreEntries(boardTarget.id).map((entry) => entry.title);
  assert.ok(titles.includes("The mill"));
  assert.ok(titles.includes("The mill (2)"));
});

test("deleting a card takes the arrows pointing at it with it", () => {
  const { deleteBeat } = deleteBeatModule;
  const event = listBeats(workshop.id).find((beat) => beat.title === "The wheel stops");
  deleteBeat(workshop.id, event.id);
  const hook = listBeats(workshop.id).find((beat) => beat.title === "A missing daughter");
  assert.deepEqual(hook.edges, [], "an arrow to a deleted card survived");
});

test("a card id from one workshop cannot be edited through another", () => {
  const other = createWorkshop(userId, { title: "Somewhere else" });
  const mine = listBeats(workshop.id)[0];
  assert.equal(updateBeatModule.updateBeat(other.id, mine.id, { ...mine, title: "Stolen" }), null);
  assert.equal(listBeats(workshop.id)[0].title, mine.title);
});

// ---- phase 9: a workshop leaving and coming back ----

const shareManifest = {
  name: "The Saltmarch bundle",
  blurb: "Everything prepared for the marsh.",
  version: "1.0.0",
  author: "A tester",
  homepage: "",
  inspiredBy: "Original work",
  rightsHolder: "",
};

let exported = null;

// locations has no list helper of its own in the db layer, so this suite
// reads the rows the same way src/lib/db/content-import.ts does.
const placesIn = (campaignId) =>
  db
    .prepare(`SELECT id, campaign_id, name FROM locations WHERE campaign_id = ? ORDER BY name`)
    .all(campaignId);

// A portrait that really exists on disk, so the export has art to carry. It
// goes under the app's real public/uploads because that is the only root the
// export reads from; the bottom of this file removes it, along with every
// file the imports below write.
const TINY_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const uploadsDir = path.join(process.cwd(), "public", "uploads");
const fixturePortrait = `test-bundle-${randomUUID()}.png`;

test("fixture: Marla's portrait becomes a file that exists", () => {
  mkdirSync(uploadsDir, { recursive: true });
  writeFileSync(path.join(uploadsDir, fixturePortrait), TINY_PNG_BYTES);
  db.prepare(`UPDATE npcs SET portrait_url = ? WHERE id = ?`).run(
    `/uploads/${fixturePortrait}`,
    marla.id,
  );
});

test("a workshop exports to a bundle that reads back in", () => {
  const result = exportWorkshopBundle(workshop.id, shareManifest);
  assert.ok(!("error" in result), result.error);
  // Through a real serialize and parse, not by handing the object straight
  // over: what a stranger receives is the FILE, and a bundle that only works
  // in memory would have proved nothing.
  const round = readBundle(JSON.stringify(result.bundle));
  assert.ok(!("error" in round), round.error);
  exported = round.bundle;
});

test("a campaign refuses to export, because it is not anybody else's to have", () => {
  const result = exportWorkshopBundle(boardTarget.id, shareManifest);
  assert.ok("error" in result);
  assert.match(result.error, /Only a workshop/);
});

test("an export without the licensing declarations is refused", () => {
  const result = exportWorkshopBundle(workshop.id, { ...shareManifest, inspiredBy: "" });
  assert.ok("error" in result);
});

test("the export carries the workshop's own prep", () => {
  const names = exported.locations.map((entry) => entry.name);
  assert.ok(names.length > 0, "no places travelled");
  assert.ok(exported.lore.length > 0, "no lore travelled");
  assert.ok(exported.storyboard.length > 0, "no board travelled");
  assert.equal(exported.genre, getCampaignById(workshop.id).gameSettings.genre);
});

test("art travels as data URLs and never as disk paths", () => {
  const marlaOut = exported.npcs.find((npc) => npc.name === marla.name);
  assert.ok(marlaOut, "Marla did not travel");
  assert.match(marlaOut.portrait, /^data:image\/png;base64,/, "the portrait did not come along");
  // The file itself travels; the path it lived at is nobody's business and
  // would be meaningless (or worse, dereferenced) on another machine.
  assert.ok(!JSON.stringify(exported).includes("/uploads/"), "a disk path leaked into the bundle");
});

let imported = null;

test("importing a bundle creates a new workshop that runs no AI turns", () => {
  const result = importWorkshopBundle(userId, exported);
  assert.ok(!("error" in result), result.error);
  imported = getCampaignById(result.workshopId);
  assert.equal(imported.kind, "workshop");
  assert.notEqual(imported.id, workshop.id, "it wrote into the source workshop");
  assert.equal(runsAiTurns(imported), false);
});

test("the imported workshop holds the same content under new ids", () => {
  const sourcePlaces = new Set(exported.locations.map((entry) => entry.name));
  const landedPlaces = placesIn(imported.id);
  assert.equal(landedPlaces.length, sourcePlaces.size);
  for (const place of landedPlaces) {
    assert.ok(sourcePlaces.has(place.name), `${place.name} is not from the bundle`);
    assert.notEqual(place.campaign_id, workshop.id);
  }
  assert.equal(listLoreEntries(imported.id).length, exported.lore.length);
  assert.equal(listBeats(imported.id).length, exported.storyboard.length);
});

test("the portrait lands as its own fresh file, not as the source's path", () => {
  const row = db
    .prepare(`SELECT portrait_url FROM npcs WHERE campaign_id = ? AND name = ?`)
    .get(imported.id, marla.name);
  assert.ok(row, "Marla did not land");
  assert.match(row.portrait_url, /^\/uploads\/[A-Za-z0-9][A-Za-z0-9_-]*\.png$/);
  // A fresh uuid name: deleting the source workshop's art can never blank an
  // import, and vice versa.
  assert.notEqual(row.portrait_url, `/uploads/${fixturePortrait}`);
  assert.ok(
    existsSync(path.join(process.cwd(), "public", row.portrait_url)),
    "the landed portrait is not on disk",
  );
});

test("the board's arrows survive the trip as arrows, not as dead ids", () => {
  const sourceArrows = exported.storyboard.reduce((sum, beat) => sum + beat.edges.length, 0);
  const landed = listBeats(imported.id);
  const landedIds = new Set(landed.map((beat) => beat.id));
  const landedArrows = landed.reduce((sum, beat) => sum + beat.edges.length, 0);
  assert.equal(landedArrows, sourceArrows, "arrows were lost or invented in transit");
  for (const beat of landed) {
    for (const edge of beat.edges) {
      assert.ok(landedIds.has(edge), "an arrow points at a card that is not on this board");
      assert.notEqual(edge, beat.id, "a card points at itself");
    }
  }
});

test("importing the same bundle twice makes two workshops, not one mess", () => {
  const again = importWorkshopBundle(userId, exported);
  assert.ok(!("error" in again));
  assert.notEqual(again.workshopId, imported.id);
  // The place names collided across the two, and neither import failed on a
  // constraint, because each one is scoped to its own new campaign id.
  assert.equal(placesIn(again.workshopId).length, exported.locations.length);
});

test("a bundle naming the same place twice is numbered rather than refused", () => {
  // locations has UNIQUE (campaign_id, name COLLATE NOCASE), so a hand-edited
  // bundle with a repeat would fail the whole transaction without this.
  const doubled = {
    ...exported,
    locations: [
      { name: "The same place", layoutDescription: "", connections: [] },
      { name: "the same place", layoutDescription: "", connections: [] },
    ],
  };
  const result = importWorkshopBundle(userId, doubled);
  assert.ok(!("error" in result), "a repeated place name broke the import");
  const names = placesIn(result.workshopId).map((entry) => entry.name);
  assert.equal(names.length, 2);
  assert.ok(names.some((name) => /\(2\)/.test(name)));
});


// ---- copying whole things ----
//
// An import furnishes a table from a source. These are the two things built
// on top of that: a source that is a CAMPAIGN rather than a workshop, and a
// clone, which is a new row plus a full import into it.

const { cloneCampaign } = await import("../src/lib/db/campaign-clone.ts");
const { getImportSourceForUser, listImportSourcesForUser } = await import(
  "../src/lib/db/import-sources.ts"
);
const { setQuestLog } = await import("../src/lib/db/campaigns.ts");
const { duplicateCharacter, instantiateIntoCampaign, listAssignmentsForUser } = await import(
  "../src/lib/db/characters.ts"
);

// An arrow, drawn here rather than relied on: the board tests above delete
// cards, and a vacuous "arrows survived" check would prove nothing.
{
  const { updateBeat } = await import("../src/lib/db/workshop-beats.ts");
  const board = listBeats(workshop.id);
  assert.ok(board.length >= 2, "the board fixture lost too many cards to test arrows");
  updateBeat(workshop.id, board[0].id, { ...board[0], edges: [board[1].id] });
}

const workshopClone = cloneCampaign(userId, workshop.id);

test("cloning a workshop copies the row and everything in it", () => {
  assert.ok(!workshopClone.error, `clone failed: ${workshopClone.error}`);
  assert.equal(workshopClone.campaign.kind, "workshop");
  assert.notEqual(workshopClone.campaign.id, workshop.id);
  assert.match(workshopClone.campaign.title, /\(copy\)/);
  assert.equal(placesIn(workshopClone.campaign.id).length, placesIn(workshop.id).length);
  assert.equal(
    listLoreEntries(workshopClone.campaign.id).length,
    listLoreEntries(workshop.id).length,
  );
});

test("a cloned workshop keeps its storyboard as a storyboard, arrows and all", () => {
  const original = listBeats(workshop.id);
  const copied = listBeats(workshopClone.campaign.id);
  assert.equal(copied.length, original.length, "the board did not travel as cards");
  assert.deepEqual(
    copied.map((beat) => beat.title).sort(),
    original.map((beat) => beat.title).sort(),
  );
  // Arrows survive, rewritten onto the copy's own card ids. Compared by
  // title, because the ids are supposed to be different.
  const copiedByTitle = new Map(copied.map((beat) => [beat.title, beat]));
  const copiedById = new Map(copied.map((beat) => [beat.id, beat.title]));
  const originalById = new Map(original.map((beat) => [beat.id, beat.title]));
  for (const beat of original) {
    assert.deepEqual(
      copiedByTitle.get(beat.title).edges.map((edge) => copiedById.get(edge)),
      beat.edges.map((edge) => originalById.get(edge)),
      `an arrow out of "${beat.title}" did not follow the copy`,
    );
  }
  // Every card is a new row: an arrow pointing back at the original workshop
  // would be a card attached to somebody else's prep.
  const originalIds = new Set(original.map((beat) => beat.id));
  assert.ok(!copied.some((beat) => originalIds.has(beat.id)));
});

setQuestLog(campaign.id, ["Find the miller's daughter"]);
const campaignClone = cloneCampaign(userId, campaign.id);

test("cloning a campaign carries the world and the quest log, not the seats", () => {
  assert.ok(!campaignClone.error, `clone failed: ${campaignClone.error}`);
  const copy = getCampaignById(campaignClone.campaign.id);
  assert.equal(copy.kind, "campaign");
  assert.equal(copy.status, "lobby", "a copy starts in the lobby, not mid-game");
  assert.notEqual(copy.inviteCode, campaign.inviteCode, "the room code must be its own");
  assert.deepEqual(copy.questLog, ["Find the miller's daughter"]);
  assert.equal(listLoreEntries(copy.id).length, listLoreEntries(campaign.id).length);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM campaign_members WHERE campaign_id = ?`).get(copy.id).n,
    1,
    "a clone seats its owner and nobody else",
  );
});

const secondTable = createCampaign(userId, {
  title: "Next year's table",
  description: "",
  theme: "",
  maxPlayers: 5,
  startingLevel: 1,
  difficulty: "normal",
});
const fromCampaign = runContentImport({
  sourceId: campaign.id,
  campaignId: secondTable.id,
  selection: ["lore"],
  houseRulesMode: "replace",
});

test("one campaign can furnish another", () => {
  assert.ok(!fromCampaign.error, `import failed: ${fromCampaign.error}`);
  assert.equal(listLoreEntries(secondTable.id).length, listLoreEntries(campaign.id).length);
});

test("the source list offers workshops and the campaigns this person steers", () => {
  const sources = listImportSourcesForUser(userId).map((source) => source.id);
  assert.ok(sources.includes(workshop.id));
  assert.ok(sources.includes(campaign.id));
});

test("a player at the table cannot copy prep out of it", () => {
  const stranger = randomUUID();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)`,
  ).run(stranger, `stranger-${stranger.slice(0, 8)}`, nowIso());
  db.prepare(
    `INSERT INTO campaign_members (campaign_id, user_id, role, ready, joined_at)
     VALUES (?, ?, 'player', 0, ?)`,
  ).run(campaign.id, stranger, nowIso());
  assert.equal(getImportSourceForUser(campaign.id, stranger), null);
  assert.ok("error" in cloneCampaign(stranger, campaign.id));
});

// ---- the character library ----

// Built through the schema rather than by hand, the way /api/characters
// does, so the fixture carries every default the sheet columns require.
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const hero = createCharacter(
  userId,
  3,
  createSheetSchema.parse({
    name: "Aldis Vane",
    race: "half-elf",
    class: "rogue",
    subclass: "thief",
    background: "criminal",
    alignment: "chaotic good",
    abilities: { str: 10, dex: 17, con: 13, int: 12, wis: 11, cha: 14 },
    maxHp: 21,
    ac: 14,
    hitDice: { die: "d8", total: 3, spent: 0 },
    proficiencies: {
      saves: ["dex", "int"],
      skills: ["stealth"],
      expertise: [],
      languages: [],
      tools: [],
      armor: [],
      weapons: [],
    },
  }),
);
const heroSheet = instantiateIntoCampaign(hero.id, secondTable.id, userId, 3);

test("a library character knows which campaigns it is playing in", () => {
  assert.ok(!heroSheet.error, `instantiate failed: ${heroSheet.error}`);
  const assignments = listAssignmentsForUser(userId).get(hero.id) ?? [];
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].campaignId, secondTable.id);
  assert.equal(assignments[0].title, secondTable.title);
  assert.equal(assignments[0].kind, "campaign");
});

test("duplicating a character numbers the copy and leaves it at no table", () => {
  const copy = duplicateCharacter(userId, hero.id);
  assert.ok(copy, "the duplicate was refused");
  assert.notEqual(copy.id, hero.id);
  assert.match(copy.name, /\(copy\)/);
  // The stored sheet has to agree with the row, or the builder reopens under
  // the original's name.
  assert.equal(copy.sheet.name, copy.name);
  assert.equal(copy.level, hero.level);
  assert.equal(copy.sheet.abilities.dex, hero.sheet.abilities.dex);
  assert.equal((listAssignmentsForUser(userId).get(copy.id) ?? []).length, 0);
  // A second copy cannot land on the first one's name.
  assert.notEqual(duplicateCharacter(userId, hero.id).name, copy.name);
});

test("a character somebody else owns cannot be duplicated", () => {
  assert.equal(duplicateCharacter(randomUUID(), hero.id), null);
});

// Any check that awaited the indexing pass has to finish before the schema
// is disturbed below.
await Promise.all(pending);

// ---- the upgrade path, in a second process ----

// ensureSchema runs once per process, so proving that an older database
// acquires the column on boot needs a fresh one. Drop the column here and
// let the child open the same file.
await flushEmbeddings();
db.exec(`ALTER TABLE campaigns DROP COLUMN kind`);
// Deliberately NOT closed: any embedding job still in flight would find a
// dead handle and log a caught failure, which reads like a broken test. The
// child opens its own connection to the same file, which SQLite allows.

const child = spawnSync(process.execPath, [selfPath, "--reopen"], {
  env: { ...process.env, ODM_TEST_DB: dbPath, ODM_TEST_KEY: dbKey },
  encoding: "utf8",
});
if (child.status !== 0) {
  console.error(child.stdout);
  console.error(child.stderr);
  throw new Error("the upgrade-path check failed");
}
process.stdout.write(child.stdout);
passed += 1;

// Remove every image file this suite caused to exist: the fixture portrait
// plus whatever the bundle imports wrote under fresh uuid names, found by
// asking the temp database what it points at. face.png is excluded on
// purpose; it was only ever a dangling DB string here, and a real deployment
// running from this checkout could own a file by that name.
{
  const artPaths = new Set([`/uploads/${fixturePortrait}`]);
  for (const row of db
    .prepare(`SELECT DISTINCT portrait_url AS p FROM npcs WHERE portrait_url LIKE '/uploads/%'`)
    .all()) {
    artPaths.add(row.p);
  }
  for (const row of db
    .prepare(
      `SELECT DISTINCT backdrop_path AS p FROM prepared_maps WHERE backdrop_path LIKE '/uploads/%'`,
    )
    .all()) {
    artPaths.add(row.p);
  }
  artPaths.delete("/uploads/face.png");
  for (const relPath of artPaths) {
    rmSync(path.join(process.cwd(), "public", relPath), { force: true });
  }
}

rmSync(path.dirname(dbPath), { recursive: true, force: true });

console.log(`workshop integration: ${passed} checks passed.`);
