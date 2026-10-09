// Prep travelling with everything it leans on, end to end, against a real
// encrypted SQLite file (#153, #155, #156, #157, #158, #159).
//
// The other workshop suites prove each stage alone. This one walks the path
// an author actually takes: a shared workshop and a chapter workshop that
// draws on it, a portable bundle out and back in, and a campaign the
// chapters are imported into one after another. At every stage it checks the
// RELATIONSHIPS, not the counts: a fight still drawn on its own map with its
// rewards, a card still picking its person, place and fight, a route still a
// route, the shared cast arriving once.
//
// It also holds the column ratchet: every column of every table a campaign
// import copies is filled, copied, and compared, so a column added tomorrow
// either travels or is named in COPY_OVERRIDES with a reason.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "odm-deps-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-alias.mjs", import.meta.url);
globalThis.__odmEmbedderPromise = Promise.resolve((texts) =>
  Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) }),
);

const { getDatabase, nowIso } = await import("../src/lib/db/core.ts");
const { createCampaign, getCampaignById, setStoryArc } = await import("../src/lib/db/campaigns.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { planContentImport, runContentImport } = await import("../src/lib/db/content-import.ts");
const { COPY_OVERRIDES } = await import("../src/lib/db/content-copy.ts");
const { cloneCampaign } = await import("../src/lib/db/campaign-clone.ts");
const { insertEncounterTemplate, listEncounterTemplates } = await import("../src/lib/db/encounter-templates.ts");
const { createLibraryMap } = await import("../src/lib/dm/map-library.ts");
const { insertBeat, listBeats, updateBeat } = await import("../src/lib/db/workshop-beats.ts");
const { checkBeat } = await import("../src/lib/workshop/board.ts");
const { setCommonWorkshop, storyboardInventory } = await import("../src/lib/db/workshop-common.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { BUNDLE_COLUMNS } = await import("../src/lib/db/workshop-bundle-export.ts");
const { sharedHomesFor } = await import("../src/lib/db/workshop-bundle-parts.ts");
const { bundleDependencies, pickBundleKinds, readBundle } = await import("../src/lib/workshop/bundle.ts");
const { listQuests } = await import("../src/lib/db/quests.ts");
const { listDmPrepNotes } = await import("../src/lib/db/notes.ts");
const { normalizeStoryArc } = await import("../src/lib/dm/arc-logic.ts");

const db = getDatabase();
let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const userId = crypto.randomUUID();
db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)`).run(
  userId,
  `author-${userId.slice(0, 8)}`,
  nowIso(),
);
const table = (title) =>
  createCampaign(userId, { title, description: "", theme: "", maxPlayers: 4, startingLevel: 3, difficulty: "normal" });
const rows = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
const copyOf = (campaignId, kind, originRowId) =>
  one(`SELECT row_id FROM content_origins WHERE campaign_id = ? AND kind = ? AND origin_row_id = ?`, campaignId, kind, originRowId)?.row_id;

// ---- the column ratchet (#153 and its cousins) ----

{
  const source = createWorkshop(userId, { title: "Every column" });
  const target = table("Every column, copied");
  // A value for every column, distinct per column, legal under the table's
  // CHECKs. Anything named in `fixed` is what the copy must remap or reset.
  const fill = (tableName, fixed) => {
    const columns = rows(`PRAGMA table_info(${tableName})`);
    const values = {};
    for (const column of columns) {
      values[column.name] =
        column.name in fixed ? fixed[column.name] : /INT/i.test(column.type) ? 1 : /BLOB/i.test(column.type) ? Buffer.from([1, 2]) : `x-${column.name}`;
    }
    const names = Object.keys(values);
    db.prepare(`INSERT INTO ${tableName} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(
      ...names.map((name) => values[name]),
    );
    return values;
  };
  const ids = { map: crypto.randomUUID(), location: crypto.randomUUID(), faction: crypto.randomUUID() };
  const filled = {
    prepared_maps: fill("prepared_maps", { id: ids.map, campaign_id: source.id, ambient: "dim", width: 4, height: 4 }),
    locations: fill("locations", { id: ids.location, campaign_id: source.id, prepared_map_id: ids.map }),
    factions: fill("factions", { id: ids.faction, campaign_id: source.id }),
    npcs: fill("npcs", { id: crypto.randomUUID(), campaign_id: source.id, attitude: "friendly", faction_id: ids.faction }),
    lore_entries: fill("lore_entries", { id: crypto.randomUUID(), campaign_id: source.id, category: "magic" }),
    roll_tables: fill("roll_tables", { id: crypto.randomUUID(), campaign_id: source.id, created_by_user_id: userId }),
    encounter_templates: fill("encounter_templates", {
      id: crypto.randomUUID(),
      campaign_id: source.id,
      created_by_user_id: userId,
      map_json: JSON.stringify({ mapId: ids.map, seed: 3 }),
    }),
    overworld_maps: fill("overworld_maps", {
      campaign_id: source.id,
      anchors_json: JSON.stringify({ [ids.location]: { x: 1, y: 1 } }),
    }),
  };
  runContentImport({
    sourceId: source.id,
    campaignId: target.id,
    selection: ["maps", "locations", "npcs", "lore", "tables", "encounters", "overworld"],
    houseRulesMode: "replace",
  });
  const kindOf = { prepared_maps: "maps", locations: "locations", factions: "factions", npcs: "npcs", lore_entries: "lore", roll_tables: "tables", encounter_templates: "encounters" };

  test("every column of every copied table travels, or is a named override", () => {
    for (const [tableName, source_] of Object.entries(filled)) {
      const copy =
        tableName === "overworld_maps"
          ? one(`SELECT * FROM overworld_maps WHERE campaign_id = ?`, target.id)
          : one(`SELECT * FROM ${tableName} WHERE id = ?`, copyOf(target.id, kindOf[tableName], source_.id));
      assert.ok(copy, `${tableName} did not copy`);
      const overridden = new Set(COPY_OVERRIDES[tableName] ?? []);
      for (const [column, value] of Object.entries(source_)) {
        if (!overridden.has(column)) {
          assert.deepEqual(copy[column], value, `${tableName}.${column} was dropped by the copy`);
        }
      }
    }
  });

  test("the overrides remap, reset or leave behind what they say", () => {
    const map = copyOf(target.id, "maps", ids.map);
    const place = one(`SELECT * FROM locations WHERE campaign_id = ?`, target.id);
    assert.equal(place.prepared_map_id, map, "a place lost its map");
    assert.equal(place.visited, 0);
    const fight = one(`SELECT * FROM encounter_templates WHERE campaign_id = ?`, target.id);
    assert.equal(JSON.parse(fight.map_json).mapId, map, "a fight still points at the workshop's map");
    assert.equal(fight.cued, 0);
    const npc = one(`SELECT * FROM npcs WHERE campaign_id = ?`, target.id);
    assert.equal(npc.faction_id, copyOf(target.id, "factions", ids.faction));
    assert.equal(npc.archived, 1, "an archived NPC came back to life");
    assert.equal(npc.bonds_json, "[]");
    assert.equal(one(`SELECT drawn_json FROM roll_tables WHERE campaign_id = ?`, target.id).drawn_json, "[]");
    assert.equal(one(`SELECT embedding FROM lore_entries WHERE campaign_id = ?`, target.id).embedding, null);
    const region = one(`SELECT * FROM overworld_maps WHERE campaign_id = ?`, target.id);
    assert.deepEqual(JSON.parse(region.anchors_json), { [place.id]: { x: 1, y: 1 } });
  });
}

test("every column a bundle could carry is carried or named as left behind, with a reason", () => {
  for (const [tableName, columns] of Object.entries(BUNDLE_COLUMNS)) {
    const listed = new Set([...columns.carried, ...Object.keys(columns.left)]);
    for (const column of rows(`PRAGMA table_info(${tableName})`).map((entry) => entry.name)) {
      assert.ok(listed.has(column), `${tableName}.${column} is neither carried by a bundle nor named as left behind`);
    }
  }
});

// ---- a shared workshop and a chapter (#159) ----

const common = createWorkshop(userId, { title: "Common" });
const chapter = createWorkshop(userId, { title: "Chapter One" });
const chapterTwo = createWorkshop(userId, { title: "Chapter Two" });
const npcRow = (campaignId, name) => {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO npcs (id, campaign_id, name, attitude, trait, location, last_shift_turn, created_at, updated_at)
     VALUES (?, ?, ?, 'indifferent', '', '', '', ?, ?)`,
  ).run(id, campaignId, name, nowIso(), nowIso());
  return id;
};
const placeRow = (campaignId, name, mapId = null) => {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO locations (id, campaign_id, name, layout_description, prepared_map_id, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?, ?)`,
  ).run(id, campaignId, name, mapId, nowIso(), nowIso());
  return id;
};
const marla = npcRow(common.id, "Marla Venn");
const harbour = placeRow(common.id, "The Harbour");
assert.ok("ok" in setCommonWorkshop(chapter, common.id));
assert.ok("ok" in setCommonWorkshop(chapterTwo, common.id));

const cellar = createLibraryMap(chapter, { name: "Cellar", width: 12, height: 10, blank: "floor" }).map;
db.prepare(`UPDATE prepared_maps SET labels_json = ?, zones_json = ? WHERE id = ?`).run(
  JSON.stringify([{ x: 2, y: 2, text: "Trapdoor", dmOnly: true }]),
  JSON.stringify([{ x0: 1, y0: 1, x1: 3, y1: 3, ambient: "dim", kind: "light" }]),
  cellar.id,
);
const ambush = insertEncounterTemplate({
  campaignId: chapter.id,
  name: "Smugglers' ambush",
  enemies: [{ monster: "bandit", count: 3 }],
  battlefield: "a flooded cellar",
  map: { mapId: cellar.id, seed: null, theme: null, ambient: null, width: null, height: null },
  notes: "They wait below the trapdoor.",
  extras: { rewards: "40 gp and a ledger", phases: ["When two fall, the third runs."], placements: [{ slot: 0, x: 3, y: 3 }], overrides: [{ slot: 1, hp: 20 }] },
  createdByUserId: userId,
});
placeRow(chapter.id, "The Cellar", cellar.id);
const card = (workshop, kind, title, links = {}, body = "") => insertBeat(workshop.id, checkBeat({ kind, title, body, links }).beat);
const lore = card(chapter, "backstory", "The smuggling ring", {}, "Twenty years of quiet trade.");
const hook = card(chapter, "hook", "A missing shipment");
const meet = card(chapter, "npc_moment", "Marla asks for help", { npcId: marla, locationId: harbour });
const fight = card(chapter, "encounter", "Down the trapdoor", { encounterId: ambush.id, mapId: cellar.id }, "Torches out first.");
const sideRoute = card(chapter, "event", "Bribe the harbourmaster", { locationId: harbour });
const fightRoute = card(chapter, "event", "Storm the warehouse");
const after = card(chapter, "event", "The ledger is found");
card(chapter, "secret", "Marla runs the ring", {}, "She hired the bandits.");
const link = (from, edges, routes = {}) => updateBeat(chapter.id, from.id, { ...listBeats(chapter.id).find((beat) => beat.id === from.id), edges: edges.map((beat) => beat.id), routes });
link(lore, [hook]);
link(hook, [meet]);
link(meet, [sideRoute, fightRoute], { [sideRoute.id]: { kind: "choice", label: "if they pay" }, [fightRoute.id]: { kind: "choice", label: "if they fight" } });
link(fightRoute, [fight]);
link(fight, [after]);
link(sideRoute, [after]);

test("a chapter's pickers list the shared workshop's rows, marked, and a foreign link is refused", () => {
  const { inventory } = storyboardInventory(getCampaignById(chapter.id));
  assert.equal(inventory.npcs.find((entry) => entry.id === marla)?.from, "Common");
  assert.ok(inventory.encounters.some((entry) => entry.id === ambush.id && !entry.from));
  const stranger = createWorkshop(userId, { title: "Somebody else's" });
  assert.equal(storyboardInventory(getCampaignById(stranger.id)).inventory.npcs.length, 0);
});

test("a shared workshop cannot itself draw on one, and chapters cannot be shared under", () => {
  assert.ok("error" in setCommonWorkshop(common, chapter.id));
  assert.ok("error" in setCommonWorkshop(chapter, chapter.id));
});

// ---- the campaign import of a chapter (#153, #156, #157, #159) ----

const campaign = table("The Saltmarch table");
const plan = planContentImport(chapter.id, campaign.id, ["storyboard", "encounters", "maps", "locations"]);
test("the preview says what the shared workshop brings and how the routes arrive", () => {
  assert.ok(plan.notes.some((note) => /From the shared workshop "Common": 2 records copied in/.test(note.message)), JSON.stringify(plan.notes));
  assert.ok(plan.notes.some((note) => /alternative or optional route/.test(note.message)));
});
const outcome = runContentImport({ sourceId: chapter.id, campaignId: campaign.id, selection: ["storyboard", "encounters", "maps", "locations"], houseRulesMode: "replace" });
const fights = listEncounterTemplates(campaign.id);

test("a fight card uses the fight it picked: one row, its roster, its map, its plan (#153, #156)", () => {
  assert.equal(fights.length, 1, `fights: ${fights.map((entry) => entry.name)}`);
  const [copy] = fights;
  assert.deepEqual(copy.enemies, [{ monster: "bandit", count: 3 }]);
  assert.equal(copy.map.mapId, copyOf(campaign.id, "maps", cellar.id));
  assert.equal(copy.extras.rewards, "40 gp and a ledger");
  assert.deepEqual(copy.extras.phases, ["When two fall, the third runs."]);
  assert.deepEqual(copy.extras.placements, [{ slot: 0, x: 3, y: 3 }]);
  assert.match(copy.notes, /Torches out first/);
});

test("the shared cast and place arrive once, and the scene's beat waits on them", () => {
  assert.equal(rows(`SELECT id FROM npcs WHERE campaign_id = ? AND name = 'Marla Venn'`, campaign.id).length, 1);
  const arc = getCampaignById(campaign.id).storyArc;
  const beat = arc.beats.find((entry) => entry.text.startsWith("Marla asks for help"));
  assert.deepEqual(beat.waypoints.map((waypoint) => waypoint.kind).sort(), ["npc", "place"]);
  assert.ok(beat.waypoints.some((waypoint) => waypoint.text === "Marla Venn"));
});

test("routes become moments, and they rejoin where the routes meet (#157)", () => {
  const arc = getCampaignById(campaign.id).storyArc;
  const texts = arc.beats.map((entry) => entry.text);
  assert.ok(!texts.some((text) => text.startsWith("Bribe the harbourmaster")), "an alternative became a required beat");
  assert.ok(!texts.some((text) => text.startsWith("Down the trapdoor")), "a fight on one route became a required beat");
  assert.ok(texts.some((text) => text.startsWith("The ledger is found")), "the join did not rejoin the spine");
  const bribe = arc.events.find((event) => event.name === "Bribe the harbourmaster");
  assert.match(bribe.trigger, /if they pay/);
  assert.match(bribe.trigger, /Storm the warehouse/);
  const trapdoor = arc.events.find((event) => event.name === "Down the trapdoor");
  assert.match(trapdoor.detail, /Fight: 3 bandit/);
});

test("hooks reach the quest log the table and the storyteller read; secrets reach the storyteller", () => {
  assert.ok(listQuests(campaign.id).some((quest) => quest.title === "A missing shipment"));
  assert.ok(listDmPrepNotes(campaign.id).some((note) => note.title === "Marla runs the ring"));
  assert.ok(outcome.copied > 0);
});

// Chapter two picks the same shared NPC: it is reused, not copied again.
card(chapterTwo, "backstory", "After the ring", {}, "The harbour is quiet.");
card(chapterTwo, "npc_moment", "Marla returns", { npcId: marla });
card(chapterTwo, "event", "A new ship arrives");
test("a second chapter reuses the shared NPC the first one brought (#159)", () => {
  const second = planContentImport(chapterTwo.id, campaign.id, ["storyboard"], { arcMode: "append" });
  assert.ok(second.notes.some((note) => /already in this campaign and reused/.test(note.message)), JSON.stringify(second.notes));
  runContentImport({ sourceId: chapterTwo.id, campaignId: campaign.id, selection: ["storyboard"], houseRulesMode: "replace", arcMode: "append" });
  assert.equal(rows(`SELECT id FROM npcs WHERE campaign_id = ? AND name LIKE 'Marla Venn%'`, campaign.id).length, 1);
});

test("a later chapter joins the played arc as its next act, and never twice (#157)", () => {
  const arc = getCampaignById(campaign.id).storyArc;
  assert.equal(arc.acts, 2);
  const actTwo = arc.beats.filter((entry) => entry.act === 2).map((entry) => entry.text);
  assert.deepEqual(actTwo, ["Marla returns", "A new ship arrives"]);
  runContentImport({ sourceId: chapterTwo.id, campaignId: campaign.id, selection: ["storyboard"], houseRulesMode: "replace", arcMode: "append" });
  assert.equal(getCampaignById(campaign.id).storyArc.beats.length, arc.beats.length);
});

test("played beats are untouched when an act joins", () => {
  const playing = table("A table mid-story");
  setStoryArc(
    playing.id,
    normalizeStoryArc({
      version: 3, premise: "A city under siege", stakes: "", antagonist: "", finale: "", saga: null,
      beats: [{ text: "The walls hold", status: "done", act: 1, detail: "They burned the ram." }, { text: "The gate falls", status: "active", act: 1 }],
      acts: 1, cast: [], events: [], subArcs: [], worldArcs: [], updatedAt: nowIso(),
    }),
  );
  const leave = planContentImport(chapterTwo.id, playing.id, ["storyboard"]);
  assert.ok(leave.warnings.some((warning) => /already has a story arc/.test(warning.message)));
  runContentImport({ sourceId: chapterTwo.id, campaignId: playing.id, selection: ["storyboard"], houseRulesMode: "replace", arcMode: "append" });
  const arc = getCampaignById(playing.id).storyArc;
  assert.deepEqual(arc.beats[0], { text: "The walls hold", status: "done", act: 1, detail: "They burned the ram." });
  assert.equal(arc.beats[1].status, "active", "the beat the table is on moved");
  assert.equal(arc.beats[2].act, 2);
});

test("bringing the shared workshop in afterwards keeps what the chapters brought", () => {
  const before = rows(`SELECT id FROM npcs WHERE campaign_id = ?`, campaign.id).length;
  runContentImport({ sourceId: common.id, campaignId: campaign.id, selection: ["npcs", "locations"], houseRulesMode: "replace" });
  assert.equal(rows(`SELECT id FROM npcs WHERE campaign_id = ?`, campaign.id).length, before);
});

test("a fight card keeps its fight even when the encounters are not ticked (#156)", () => {
  const solo = table("Board only");
  const preview = planContentImport(chapter.id, solo.id, ["storyboard"]);
  assert.ok(preview.notes.some((note) => /fight card brings the prepared fight it picks/.test(note.message)));
  runContentImport({ sourceId: chapter.id, campaignId: solo.id, selection: ["storyboard"], houseRulesMode: "replace" });
  const solos = listEncounterTemplates(solo.id);
  assert.equal(solos.length, 1);
  assert.deepEqual(solos[0].enemies, [{ monster: "bandit", count: 3 }]);
  assert.equal(solos[0].map.mapId, null, "an unticked map left a dangling binding");
});

test("encounters without their maps arrive unbound, and the preview said so (#153)", () => {
  const bare = table("No maps");
  const preview = planContentImport(chapter.id, bare.id, ["encounters"]);
  assert.ok(preview.warnings.some((warning) => /drawn on a battle map that is not coming along/.test(warning.message)));
  runContentImport({ sourceId: chapter.id, campaignId: bare.id, selection: ["encounters"], houseRulesMode: "replace" });
  assert.equal(listEncounterTemplates(bare.id)[0].map.mapId, null);
});

test("a cloned chapter's fight is drawn on the clone's map, and keeps its shared workshop", () => {
  const clone = cloneCampaign(userId, chapter.id).campaign;
  const [copy] = listEncounterTemplates(clone.id);
  assert.equal(copy.map.mapId, copyOf(clone.id, "maps", cellar.id));
  assert.equal(copy.extras.rewards, "40 gp and a ledger");
  const marlaCard = listBeats(clone.id).find((beat) => beat.title === "Marla asks for help");
  assert.equal(marlaCard.links.npcId, marla, "a link into the shared workshop was dropped");
  assert.equal(Object.keys(listBeats(clone.id).find((beat) => beat.title === "Marla asks for help").routes).length, 2);
});

// ---- the portable bundle (#155, #158, #159) ----

const manifest = { name: "Chapter One", blurb: "The smugglers.", inspiredBy: "Original work" };
const commonBundle = readBundle(JSON.stringify(exportWorkshopBundle(common.id, { ...manifest, name: "Common" }).bundle)).bundle;
const chapterBundle = readBundle(JSON.stringify(exportWorkshopBundle(chapter.id, manifest).bundle)).bundle;

test("a chapter bundle carries what its cards pick, by index, and names its shared workshop", () => {
  assert.equal(chapterBundle.dependsOn.name, "Common");
  const meetCard = chapterBundle.storyboard.find((beat) => beat.title === "Marla asks for help");
  assert.equal(chapterBundle.npcs[meetCard.links.npc].name, "Marla Venn");
  assert.equal(chapterBundle.npcs[meetCard.links.npc].shared, true);
  const encounter = chapterBundle.encounters.find((entry) => entry.name === "Smugglers' ambush");
  assert.equal(chapterBundle.maps[encounter.map.map].name, "Cellar");
  assert.equal(encounter.extras.rewards, "40 gp and a ledger");
  assert.equal(chapterBundle.maps.find((map) => map.name === "Cellar").labels[0].text, "Trapdoor");
  assert.ok(bundleDependencies(chapterBundle).some((dependency) => dependency.from === "storyboard" && dependency.to === "npcs"));
});

test("a chapter bundle on its own lands whole: every pick resolves inside the new workshop", () => {
  const result = importWorkshopBundle(userId, chapterBundle);
  const beats = listBeats(result.workshopId);
  const meetCard = beats.find((beat) => beat.title === "Marla asks for help");
  assert.equal(one(`SELECT campaign_id FROM npcs WHERE id = ?`, meetCard.links.npcId).campaign_id, result.workshopId);
  const fightCard = beats.find((beat) => beat.title === "Down the trapdoor");
  const template = listEncounterTemplates(result.workshopId).find((entry) => entry.id === fightCard.links.encounterId);
  assert.equal(template.extras.rewards, "40 gp and a ledger");
  assert.equal(one(`SELECT campaign_id FROM prepared_maps WHERE id = ?`, template.map.mapId).campaign_id, result.workshopId);
  assert.equal(one(`SELECT labels_json FROM prepared_maps WHERE id = ?`, template.map.mapId).labels_json.includes("Trapdoor"), true);
  const meetRoutes = beats.find((beat) => beat.title === "Marla asks for help").routes;
  assert.deepEqual(Object.values(meetRoutes).map((route) => route.label).sort(), ["if they fight", "if they pay"]);
});

test("after the shared workshop's own bundle, a chapter links to it instead of copying (#159)", () => {
  const sharedHome = importWorkshopBundle(userId, commonBundle).workshopId;
  const homes = sharedHomesFor(userId, chapterBundle);
  assert.ok(homes.some((home) => home.id === sharedHome && home.found === home.total), JSON.stringify(homes));
  const result = importWorkshopBundle(userId, chapterBundle, { sharedWorkshopId: sharedHome });
  assert.equal(result.linkedShared, 2);
  const meetCard = listBeats(result.workshopId).find((beat) => beat.title === "Marla asks for help");
  assert.equal(one(`SELECT campaign_id FROM npcs WHERE id = ?`, meetCard.links.npcId).campaign_id, sharedHome);
  assert.equal(rows(`SELECT id FROM npcs WHERE campaign_id = ?`, result.workshopId).length, 0);
  assert.equal(one(`SELECT common_workshop_id AS id FROM campaigns WHERE id = ?`, result.workshopId).id, sharedHome);
});

test("unticking a kind drops the links into it and the preview counts them (#158)", () => {
  const picked = pickBundleKinds(chapterBundle, ["storyboard", "encounters", "maps", "locations"]);
  const result = importWorkshopBundle(userId, picked);
  const meetCard = listBeats(result.workshopId).find((beat) => beat.title === "Marla asks for help");
  assert.equal(meetCard.links.npcId, undefined);
  assert.ok(result.droppedLinks >= 1);
});

test("a shared map named like one of the chapter's own lands numbered, not as a failed import", () => {
  const twin = JSON.parse(JSON.stringify(chapterBundle));
  twin.maps.push({ ...twin.maps.find((map) => map.name === "Cellar"), shared: true, ref: "r-twin" });
  const result = importWorkshopBundle(userId, readBundle(JSON.stringify(twin)).bundle);
  const names = rows(`SELECT name FROM prepared_maps WHERE campaign_id = ?`, result.workshopId).map((row) => row.name).sort();
  assert.deepEqual(names, ["Cellar", "Cellar (2)"]);
});

test("a bundle written before links existed still reads, cards and arrows intact", () => {
  const old = JSON.parse(JSON.stringify(chapterBundle));
  for (const beat of old.storyboard) {
    delete beat.links;
    delete beat.routes;
  }
  for (const encounter of old.encounters) {
    delete encounter.map;
    delete encounter.extras;
  }
  delete old.dependsOn;
  delete old.overworld;
  const read = readBundle(JSON.stringify(old));
  assert.ok("bundle" in read, read.error);
  const result = importWorkshopBundle(userId, read.bundle);
  assert.equal(listBeats(result.workshopId).length, chapterBundle.storyboard.length);
});

removeTempDir(dir);
console.log(`workshop dependencies: ${passed} checks passed.`);
