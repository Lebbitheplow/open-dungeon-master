import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { getCampaignById, updateGameSettings } from "@/lib/db/campaigns";
import { embedPendingLore } from "@/lib/db/lore";
import { listBeats } from "@/lib/db/workshop-beats";
import { compileBoard } from "@/lib/workshop/board-compile";
import {
  writeStoryboardColumns,
  writeStoryboardRows,
} from "@/lib/db/workshop-storyboard";
import { getHouseRulesText, setHouseRules } from "@/lib/db/rules";
import { mergeHouseRules } from "@/lib/rulesets/logic";
import {
  IMPORT_KINDS,
  emptyExisting,
  emptySource,
  keepsOverworldAnchors,
  planImport,
  type ImportExisting,
  type ImportKind,
  type ImportPlan,
  type ImportSource,
} from "@/lib/workshop/import";

// Executing a content import. The decisions are all in
// src/lib/workshop/import.ts; this reads the rows, writes the copies inside
// one transaction, and kicks the embedding work that has to happen after it.
//
// Everything here copies BETWEEN TWO CAMPAIGN IDS, which is the payoff of
// making a workshop a campaigns row: there is no translation layer, only new
// primary keys and a different campaign_id. Because that is all it is, the
// SOURCE does not have to be a workshop. A campaign already being played
// holds the same tables, so copying a cast, a region and a shelf of maps out
// of last year's game into this year's is the same walk over the same rows.
// Who is allowed to copy out of what is decided in
// src/lib/db/import-sources.ts, never here.

type Row = Record<string, unknown>;

function allRows(sql: string, ...args: unknown[]): Row[] {
  return getDatabase().prepare(sql).all(...args) as Row[];
}

// What a campaign or workshop holds, named for the picker. Rows keep their
// real ids so the plan can point back at them.
export function readImportSource(sourceId: string): ImportSource {
  const source = emptySource();
  source.lore = allRows(
    `SELECT id, title AS name FROM lore_entries WHERE campaign_id = ? ORDER BY created_at`,
    sourceId,
  ) as ImportSource["lore"];
  source.locations = allRows(
    `SELECT id, name FROM locations WHERE campaign_id = ? ORDER BY created_at`,
    sourceId,
  ) as ImportSource["locations"];
  // The roster refs ride along so the planner can warn about homebrew slugs,
  // which are user-scoped and do not travel (src/lib/workshop/import.ts).
  source.encounters = allRows(
    `SELECT id, name, enemies_json FROM encounter_templates WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
    sourceId,
  ).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    monsters: (parseJson(String(row.enemies_json ?? ""), []) as Array<{ monster?: unknown }>).map(
      (entry) => String(entry?.monster ?? ""),
    ),
  })) as ImportSource["encounters"];
  source.tables = allRows(
    `SELECT id, name FROM roll_tables WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
    sourceId,
  ) as ImportSource["tables"];
  source.npcs = allRows(
    `SELECT id, name FROM npcs WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
    sourceId,
  ) as ImportSource["npcs"];
  source.maps = allRows(
    `SELECT id, name FROM prepared_maps WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
    sourceId,
  ) as ImportSource["maps"];

  const beats = allRows(
    `SELECT COUNT(*) AS n FROM workshop_beats WHERE campaign_id = ?`,
    sourceId,
  ) as Array<{ n: number }>;
  source.storyboard = beats[0]?.n
    ? [{ id: sourceId, name: `The storyboard (${beats[0].n} cards)` }]
    : [];

  const overworld = allRows(
    `SELECT campaign_id AS id FROM overworld_maps WHERE campaign_id = ?`,
    sourceId,
  );
  source.overworld = overworld.length
    ? [{ id: sourceId, name: "Region map" }]
    : [];

  const houseRules = getHouseRulesText(sourceId);
  source.houseRules = houseRules.trim() ? [{ id: sourceId, name: "House rules" }] : [];

  return source;
}

// The names already at the target, so the planner can number collisions.
export function readTargetExisting(campaignId: string): ImportExisting {
  const existing = emptyExisting();
  const names = (sql: string) =>
    allRows(sql, campaignId).map((row) => String(row.name ?? ""));
  existing.lore = names(`SELECT title AS name FROM lore_entries WHERE campaign_id = ?`);
  existing.locations = names(`SELECT name FROM locations WHERE campaign_id = ?`);
  existing.encounters = names(`SELECT name FROM encounter_templates WHERE campaign_id = ?`);
  existing.tables = names(`SELECT name FROM roll_tables WHERE campaign_id = ?`);
  existing.npcs = names(`SELECT name FROM npcs WHERE campaign_id = ?`);
  existing.maps = names(`SELECT name FROM prepared_maps WHERE campaign_id = ?`);
  // A board is compiled rather than copied, so there is no name to collide
  // on. What matters at the target is whether an arc already exists, which
  // planImport is told separately.
  existing.storyboard = [];
  existing.overworld = allRows(
    `SELECT campaign_id FROM overworld_maps WHERE campaign_id = ?`,
    campaignId,
  ).length
    ? ["Region map"]
    : [];
  existing.houseRules = getHouseRulesText(campaignId).trim() ? ["House rules"] : [];
  return existing;
}

export function planContentImport(
  sourceId: string,
  campaignId: string,
  selection: readonly ImportKind[],
): ImportPlan {
  return planImport({
    selection,
    source: readImportSource(sourceId),
    existing: readTargetExisting(campaignId),
    targetHasHouseRules: Boolean(getHouseRulesText(campaignId).trim()),
    targetHasArc: Boolean(getCampaignById(campaignId)?.storyArc),
  });
}

// Every row that travelled, as `kind:oldId` -> newId. The region map needs
// it here to rewrite its anchors; a workshop clone needs it to rewire the
// storyboard cards that point at NPCs, maps, fights and places
// (src/lib/db/campaign-clone.ts).
export type ImportIdMap = Map<string, string>;

export type ImportOutcome = { plan: ImportPlan; copied: number; idMap: ImportIdMap };

// Copies the planned rows. One transaction, so a constraint the planner
// somehow failed to anticipate rolls the whole import back rather than
// leaving a campaign half-furnished.
//
// Embeddings and house-rules chunking happen AFTER the transaction: both
// walk the rows they just wrote and both can be slow, and neither should be
// able to hold a write lock open while a model runs.
export function runContentImport(input: {
  sourceId: string;
  campaignId: string;
  selection: readonly ImportKind[];
  houseRulesMode: "replace" | "append";
}): ImportOutcome | { error: string } {
  const { sourceId, campaignId, selection, houseRulesMode } = input;
  const source = getCampaignById(sourceId);
  const campaign = getCampaignById(campaignId);
  if (!source || !campaign) {
    return { error: "Not found." };
  }
  if (source.id === campaign.id) {
    return { error: "Nothing can import into itself." };
  }

  const plan = planContentImport(sourceId, campaignId, selection);
  if (plan.empty) {
    return { plan, copied: 0, idMap: new Map() };
  }

  const db = getDatabase();
  const now = nowIso();
  // Ids change on copy, so anything that points at a row by id has to be
  // rewritten through this map rather than carried across verbatim.
  const idMap: ImportIdMap = new Map();
  const trackId = (kind: ImportKind, sourceRowId: unknown) => {
    const id = crypto.randomUUID();
    idMap.set(`${kind}:${String(sourceRowId)}`, id);
    return id;
  };
  const finalNames = new Map<string, string>(
    plan.items.map((item) => [`${item.kind}:${item.sourceId}`, item.finalName]),
  );
  const nameFor = (kind: ImportKind, id: string, fallback: string) =>
    finalNames.get(`${kind}:${id}`) ?? fallback;
  const selected = new Set(selection);
  let copied = 0;
  // Compiled before the transaction opens, because it is a read of the
  // SOURCE, which this import never writes to. The rows it produces
  // are written inside; the quest log and the story arc are single columns
  // on campaigns rather than rows, so they go after, alongside the house
  // rules, for the same reason: one write each, not a loop.
  const storyboard = selected.has("storyboard")
    ? compileBoard(listBeats(sourceId))
    : null;

  db.transaction(() => {
    if (selected.has("locations")) {
      for (const row of allRows(
        `SELECT * FROM locations WHERE campaign_id = ? ORDER BY created_at`,
        sourceId,
      )) {
        const id = trackId("locations", row.id);
        db.prepare(
          `INSERT INTO locations
             (id, campaign_id, name, layout_description, connections_json, visited,
              is_current, map_image_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
        ).run(
          id,
          campaignId,
          nameFor("locations", String(row.id), String(row.name)),
          row.layout_description ?? "",
          row.connections_json ?? "[]",
          // A prepared place has not been visited and is nobody's current
          // location: the party has not been there yet. Copying `visited`
          // or `is_current` across would tell the campaign it has already
          // travelled, and two current locations is a state the engine has
          // no meaning for.
          row.map_image_json ?? null,
          now,
          now,
        );
        copied += 1;
      }
    }

    if (selected.has("lore")) {
      for (const row of allRows(
        `SELECT * FROM lore_entries WHERE campaign_id = ? ORDER BY created_at`,
        sourceId,
      )) {
        db.prepare(
          `INSERT INTO lore_entries
             (id, campaign_id, category, title, body, tags_json, pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          trackId("lore", row.id),
          campaignId,
          row.category,
          nameFor("lore", String(row.id), String(row.title)),
          row.body,
          row.tags_json ?? "[]",
          row.pinned ?? 0,
          now,
          now,
        );
        copied += 1;
      }
    }

    if (selected.has("tables")) {
      for (const row of allRows(
        `SELECT * FROM roll_tables WHERE campaign_id = ?`,
        sourceId,
      )) {
        db.prepare(
          `INSERT INTO roll_tables
             (id, campaign_id, name, entries_json, created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          trackId("tables", row.id),
          campaignId,
          nameFor("tables", String(row.id), String(row.name)),
          row.entries_json ?? "[]",
          row.created_by_user_id,
          now,
          now,
        );
        copied += 1;
      }
    }

    if (selected.has("encounters")) {
      for (const row of allRows(
        `SELECT * FROM encounter_templates WHERE campaign_id = ?`,
        sourceId,
      )) {
        db.prepare(
          `INSERT INTO encounter_templates
             (id, campaign_id, name, enemies_json, battlefield, map_json, notes,
              created_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          trackId("encounters", row.id),
          campaignId,
          nameFor("encounters", String(row.id), String(row.name)),
          row.enemies_json ?? "[]",
          row.battlefield ?? "",
          row.map_json ?? "{}",
          row.notes ?? "",
          row.created_by_user_id,
          now,
          now,
        );
        copied += 1;
      }
    }

    if (selected.has("npcs")) {
      for (const row of allRows(`SELECT * FROM npcs WHERE campaign_id = ?`, sourceId)) {
        db.prepare(
          `INSERT INTO npcs
             (id, campaign_id, name, attitude, trait, location, last_shift_turn,
              aliases_json, personality_json, goals_json, relations_json, bonds_json,
              pressure_json, arc_cast_id, portrait_url, archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, '', ?, 0, ?, ?)`,
        ).run(
          trackId("npcs", row.id),
          campaignId,
          nameFor("npcs", String(row.id), String(row.name)),
          row.attitude ?? "indifferent",
          row.trait ?? "",
          row.location ?? "",
          row.aliases_json ?? "[]",
          // These three default to '' rather than '{}' on the column, and
          // src/lib/dm/npc-logic.ts reads '' as untracked; matching the
          // column keeps a copied NPC identical to a fresh one.
          row.personality_json ?? "",
          row.goals_json ?? "",
          // NPC-to-NPC relations are keyed by NAME, not by id
          // (src/lib/dm/npc-logic.ts), so a cast imported together arrives
          // with its feuds intact and a relation naming somebody left behind
          // simply reads as a link to an NPC nobody has written yet, which
          // the forge shows as such. Phase 3 dropped these along with the
          // bonds; that was wrong, and this is the fix.
          row.relations_json ?? "[]",
          // Bonds ARE keyed by character id, and those ids do not exist at
          // the target, so they start empty. The arc cast link goes for the
          // same reason.
          "[]",
          row.pressure_json ?? "",
          // The face travels as a path, like a prepared map's backdrop: it
          // points at a file in public/uploads both campaigns can read.
          row.portrait_url ?? "",
          now,
          now,
        );
        copied += 1;
      }
    }

    if (selected.has("maps")) {
      // Prepared maps carry no tokens and no fog, so a copy is the row and
      // nothing else. The backdrop path travels as-is: it points at a file
      // in public/uploads that both campaigns can read, and duplicating the
      // image would cost megabytes to show the same picture.
      for (const row of allRows(`SELECT * FROM prepared_maps WHERE campaign_id = ?`, sourceId)) {
        db.prepare(
          `INSERT INTO prepared_maps
             (id, campaign_id, name, notes, tags_json, width, height, terrain, ambient,
              theme, lights_json, seed, backdrop_path, backdrop_transform_json,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          trackId("maps", row.id),
          campaignId,
          nameFor("maps", String(row.id), String(row.name)),
          row.notes ?? "",
          row.tags_json ?? "[]",
          row.width,
          row.height,
          row.terrain,
          row.ambient ?? "bright",
          row.theme ?? "field",
          row.lights_json ?? "[]",
          row.seed ?? 0,
          row.backdrop_path ?? "",
          row.backdrop_transform_json ?? "{}",
          now,
          now,
        );
        copied += 1;
      }
    }

    // The storyboard is the one kind that is COMPILED rather than copied:
    // one board becomes lore entries, quests, prepared encounters, DM-only
    // notes and a story arc (src/lib/workshop/board-compile.ts). Nothing new
    // is built at the campaign end to receive it, which is the test of
    // whether the node kinds were chosen correctly.
    if (storyboard) {
      copied += writeStoryboardRows(campaignId, campaign.ownerUserId, storyboard, now);
    }

    if (selected.has("overworld")) {
      const [map] = allRows(
        `SELECT * FROM overworld_maps WHERE campaign_id = ?`,
        sourceId,
      );
      if (map) {
        const anchors = keepsOverworldAnchors(selection)
          ? remapAnchors(String(map.anchors_json ?? "{}"), idMap)
          : "{}";
        db.prepare(
          `INSERT INTO overworld_maps
             (campaign_id, seed, width, height, terrain, anchors_json, pins_json,
              party_xy_json, params_json, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)
           ON CONFLICT(campaign_id) DO UPDATE SET
             seed = excluded.seed, width = excluded.width, height = excluded.height,
             terrain = excluded.terrain, anchors_json = excluded.anchors_json,
             pins_json = excluded.pins_json, party_xy_json = '',
             params_json = excluded.params_json, notes = excluded.notes,
             updated_at = excluded.updated_at`,
        ).run(
          campaignId,
          map.seed,
          map.width,
          map.height,
          map.terrain,
          anchors,
          map.pins_json ?? "[]",
          // The party marker is where the DM stood them at the source,
          // which says nothing about a campaign that has not started.
          map.params_json ?? "",
          map.notes ?? "",
          now,
          now,
        );
        copied += 1;
      }
    }
  })();

  // ---- after the transaction ----

  if (storyboard) {
    copied += writeStoryboardColumns(campaign, storyboard, now);
  }
  if (selected.has("houseRules")) {
    const incoming = getHouseRulesText(sourceId);
    if (incoming.trim()) {
      setHouseRules(
        campaignId,
        mergeHouseRules(incoming, getHouseRulesText(campaignId), houseRulesMode),
      );
      copied += 1;
    }
    // The variant flags travel with the prose: they are the same decision.
    updateGameSettings(campaignId, { variantRules: source.gameSettings.variantRules });
  }

  if (selected.has("lore")) {
    void embedPendingLore(campaignId).catch(() => {
      // A missing vector only means keyword fallback for that entry.
    });
  }

  return { plan, copied, idMap };
}

// Anchors are {locationId: {x, y}}. Ids that did not travel are dropped
// rather than kept pointing at a place the campaign has never heard of;
// src/lib/db/overworld.ts re-places any location without an anchor lazily.
function remapAnchors(anchorsJson: string, idMap: ImportIdMap): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(anchorsJson) as Record<string, unknown>;
  } catch {
    return "{}";
  }
  const remapped: Record<string, unknown> = {};
  for (const [oldId, xy] of Object.entries(parsed ?? {})) {
    const newId = idMap.get(`locations:${oldId}`);
    if (newId) {
      remapped[newId] = xy;
    }
  }
  return JSON.stringify(remapped);
}

export { IMPORT_KINDS };
