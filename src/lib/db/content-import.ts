import { getDatabase, parseJson } from "@/lib/db/core";
import { getCampaignById, updateGameSettings, type Campaign } from "@/lib/db/campaigns";
import { embedPendingLore } from "@/lib/db/lore";
import { listBeats } from "@/lib/db/workshop-beats";
import { compileBoard, summarizeCompile, type CompiledBoard } from "@/lib/workshop/board-compile";
import {
  writeStoryboardColumns,
  writeStoryboardRows,
  type BoardResolver,
} from "@/lib/db/workshop-storyboard";
import { getHouseRulesText, setHouseRules } from "@/lib/db/rules";
import { mergeHouseRules } from "@/lib/rulesets/logic";
import { arcRoom } from "@/lib/dm/arc-logic";
import { copiesFrom, recordOrigin, type OriginKind } from "@/lib/db/content-origins";
import {
  copyFactions,
  copyKind,
  copyOneRow,
  copyOverworld,
  type CopyContext,
  type RowKind,
} from "@/lib/db/content-copy";
import { getCommonWorkshop } from "@/lib/db/workshop-common";
import { normalizeStock } from "@/lib/db/shops";
import {
  IMPORT_KINDS,
  LINK_KINDS,
  emptyExisting,
  emptySource,
  planImport,
  type AgainMode,
  type ArcMode,
  type BoardFacts,
  type ImportExisting,
  type ImportKind,
  type ImportPlan,
  type ImportSource,
  type LinkKind,
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
//
// The row copies themselves are src/lib/db/content-copy.ts (every column,
// references remapped), and every copy records where it came from
// (src/lib/db/content-origins.ts), which is what lets a second import keep
// what the first one brought rather than numbering a duplicate.

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
  // The map a place stands on rides along, so the planner can say which
  // places would arrive without it.
  source.locations = allRows(
    `SELECT id, name, prepared_map_id FROM locations WHERE campaign_id = ? ORDER BY created_at`,
    sourceId,
  ).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    ...(row.prepared_map_id ? { mapId: String(row.prepared_map_id) } : {}),
  }));
  // The roster refs ride along so the planner can warn about homebrew slugs,
  // which are user-scoped and do not travel (src/lib/workshop/import.ts),
  // and the map the fight is drawn on, for the same reason as a place's.
  source.encounters = allRows(
    `SELECT id, name, enemies_json, map_json FROM encounter_templates WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
    sourceId,
  ).map((row) => {
    const mapId = parseJson<{ mapId?: unknown }>(String(row.map_json ?? ""), {}).mapId;
    return {
      id: String(row.id),
      name: String(row.name),
      monsters: (parseJson(String(row.enemies_json ?? ""), []) as Array<{ monster?: unknown }>).map(
        (entry) => String(entry?.monster ?? ""),
      ),
      ...(typeof mapId === "string" && mapId ? { mapId } : {}),
    };
  });
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
  // A shop's place and keeper ride along so the planner can say which
  // shops would arrive unplaced or unkept, and its shelf's size for the
  // preview (#171). The shelf counted is the one a copy starts with.
  source.shops = allRows(
    `SELECT id, name, location_id, keeper_npc_id, stock_json, prepared_stock_json FROM shops WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`,
    sourceId,
  ).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    ...(row.location_id ? { placeId: String(row.location_id) } : {}),
    ...(row.keeper_npc_id ? { keeperId: String(row.keeper_npc_id) } : {}),
    lines: normalizeStock(parseJson(String(row.prepared_stock_json || row.stock_json || "[]"), [])).length,
  }));

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
  existing.shops = names(`SELECT name FROM shops WHERE campaign_id = ?`);
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

const ROW_KIND_SET = new Set<string>(["maps", "locations", "lore", "tables", "encounters", "npcs", "shops"]);

// Live copies at the target of the source's rows, per import kind, for the
// planner's "already here" (src/lib/db/content-origins.ts).
function alreadyHereBy(copies: Map<string, string>): Partial<Record<ImportKind, string[]>> {
  const here: Partial<Record<ImportKind, string[]>> = {};
  for (const key of copies.keys()) {
    const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    if (ROW_KIND_SET.has(kind)) {
      (here[kind as ImportKind] ??= []).push(id);
    }
  }
  return here;
}

const LINK_TABLES: Record<LinkKind, string> = {
  npcs: "npcs",
  maps: "prepared_maps",
  encounters: "encounter_templates",
  locations: "locations",
};

// The links the compile will actually use, by kind. A link on a hook or a
// secret, or a map on a scene that is not a fight or a place, has nowhere
// to land in a campaign and is counted separately for the preview.
function usedLinks(compiled: CompiledBoard): Record<LinkKind, string[]> {
  const used: Record<LinkKind, string[]> = { npcs: [], maps: [], encounters: [], locations: [] };
  for (const entry of compiled.lore) {
    if (entry.links.locationId) used.locations.push(entry.links.locationId);
    if (entry.links.locationId && entry.links.mapId) used.maps.push(entry.links.mapId);
  }
  for (const entry of compiled.encounters) {
    if (entry.encounterId) used.encounters.push(entry.encounterId);
    if (entry.mapId) used.maps.push(entry.mapId);
  }
  for (const card of [...compiled.arcPlan, ...compiled.moments]) {
    if (card.links.npcId) used.npcs.push(card.links.npcId);
    if (card.links.locationId) used.locations.push(card.links.locationId);
    if (card.links.encounterId) used.encounters.push(card.links.encounterId);
  }
  return used;
}

function boardFactsFor(source: Campaign, compiled: CompiledBoard, common: Campaign | null): BoardFacts {
  const links = usedLinks(compiled);
  const inCommon = (kind: LinkKind) =>
    common
      ? [...new Set(links[kind])].filter((id) =>
          Boolean(
            getDatabase()
              .prepare(`SELECT 1 FROM ${LINK_TABLES[kind]} WHERE id = ? AND campaign_id = ?`)
              .get(id, common.id),
          ),
        )
      : [];
  return {
    links,
    common: common
      ? {
          title: common.title,
          links: Object.fromEntries(LINK_KINDS.map((kind) => [kind, inCommon(kind)])) as Record<LinkKind, string[]>,
        }
      : null,
    beats: compiled.arcBeats,
    moments: compiled.moments.length,
    arcProblem: summarizeCompile(compiled, false).arcRefusal,
  };
}

export type ImportOptions = { again?: AgainMode; arcMode?: ArcMode };

export function planContentImport(
  sourceId: string,
  campaignId: string,
  selection: readonly ImportKind[],
  options: ImportOptions = {},
): ImportPlan {
  const source = getCampaignById(sourceId);
  const target = getCampaignById(campaignId);
  const hasBoard = selection.includes("storyboard") && source;
  const common = source && source.kind === "workshop" ? getCommonWorkshop(source) : null;
  const commonHere = common ? alreadyHereBy(copiesFrom(campaignId, common.id)) : {};
  const arc = target?.storyArc ?? null;
  return planImport({
    selection,
    source: readImportSource(sourceId),
    existing: readTargetExisting(campaignId),
    targetHasHouseRules: Boolean(getHouseRulesText(campaignId).trim()),
    targetArc: arc ? { beats: arc.beats.map((beat) => beat.text), acts: arc.acts, ...arcRoom(arc) } : null,
    arcMode: options.arcMode,
    alreadyHere: alreadyHereBy(copiesFrom(campaignId, sourceId)),
    again: options.again,
    commonHere,
    board: hasBoard ? boardFactsFor(source, compileBoard(listBeats(sourceId)), common) : null,
  });
}

// Every row that travelled, as `kind:oldId` -> newId. Storyboard links, the
// region map's anchors and a workshop clone's cards are all rewritten
// through it (src/lib/db/campaign-clone.ts).
export type ImportIdMap = Map<string, string>;

export type ImportOutcome = {
  plan: ImportPlan;
  copied: number;
  idMap: ImportIdMap;
  // Rows an earlier import brought, kept rather than copied again.
  kept: number;
  // References that had nothing to land on and were cleared (#153).
  unbound: number;
  // Beats the board added to the campaign's arc.
  beatsAdded: number;
};

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
  again?: AgainMode;
  arcMode?: ArcMode;
}): ImportOutcome | { error: string } {
  const { sourceId, campaignId, selection, houseRulesMode } = input;
  const again = input.again ?? "skip";
  const source = getCampaignById(sourceId);
  const campaign = getCampaignById(campaignId);
  if (!source || !campaign) {
    return { error: "Not found." };
  }
  if (source.id === campaign.id) {
    return { error: "Nothing can import into itself." };
  }

  const plan = planContentImport(sourceId, campaignId, selection, { again, arcMode: input.arcMode });
  if (plan.empty) {
    return { plan, copied: 0, idMap: new Map(), kept: plan.kept, unbound: 0, beatsAdded: 0 };
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  // Ids change on copy, so anything that points at a row by id has to be
  // rewritten through this map rather than carried across verbatim.
  const idMap: ImportIdMap = new Map();
  const counts = { copied: 0, kept: 0, unbound: 0 };
  const finalNames = new Map<string, string>(
    plan.items.map((item) => [`${item.kind}:${item.sourceId}`, item.finalName]),
  );
  // Names taken at the target per kind, read when a row the planner did not
  // name (a linked fight, a shared record) first needs one.
  const taken = new Map<RowKind, Set<string>>();
  const takenFor = (kind: RowKind) => {
    const label = kind === "lore" ? "title" : "name";
    const table = { maps: "prepared_maps", locations: "locations", lore: "lore_entries", tables: "roll_tables", encounters: "encounter_templates", npcs: "npcs", shops: "shops" }[kind];
    let set = taken.get(kind);
    if (!set) {
      set = new Set(allRows(`SELECT ${label} AS name FROM ${table} WHERE campaign_id = ?`, campaignId).map((row) => String(row.name).trim().toLowerCase()));
      taken.set(kind, set);
    }
    return set;
  };

  // One context per place rows come from: the source, and the source's
  // shared workshop when a card picks something there (#159).
  const contextFor = (originId: string, earlier: Map<string, string>, keep: boolean): CopyContext => ({
    sourceId: originId,
    campaignId,
    now,
    nameFor: (kind, id, fallback) => finalNames.get(`${kind}:${id}`) ?? fallback,
    track: (kind: OriginKind, sourceRowId: string) => {
      const id = crypto.randomUUID();
      idMap.set(`${kind}:${sourceRowId}`, id);
      recordOrigin(campaignId, kind, id, originId, sourceRowId);
      return id;
    },
    resolve: (kind, sourceRowId) => idMap.get(`${kind}:${sourceRowId}`) ?? earlier.get(`${kind}:${sourceRowId}`) ?? null,
    kept: (kind, sourceRowId) => keep && earlier.has(`${kind}:${sourceRowId}`),
    counts,
  });
  const earlier = copiesFrom(campaignId, sourceId);
  const main = contextFor(sourceId, earlier, again === "skip");
  const common = source.kind === "workshop" ? getCommonWorkshop(source) : null;
  // A shared record is always reused once the campaign has it: bringing the
  // same recurring NPC in with every chapter is exactly what the shared
  // workshop exists to prevent.
  const shared = common ? contextFor(common.id, copiesFrom(campaignId, common.id), true) : null;
  if (shared) {
    shared.bring = (kind, id) =>
      ROW_KIND_SET.has(kind) ? copyOneRow(shared, kind as RowKind, id, takenFor(kind as RowKind)) : null;
  }
  const selected = new Set(selection);
  // Compiled before the transaction opens, because it is a read of the
  // SOURCE, which this import never writes to.
  const storyboard = selected.has("storyboard") ? compileBoard(listBeats(sourceId)) : null;
  const resolver: BoardResolver = {
    link: (kind, id) =>
      main.resolve(kind, id) ??
      // A fight card keeps the fight its author picked even when the
      // encounters were not ticked (#156); copyOneRow is scoped to the
      // source, so an id that is not one of its fights copies nothing.
      (kind === "encounters" ? copyOneRow(main, "encounters", id, takenFor("encounters")) : null) ??
      (shared ? shared.resolve(kind, id) ?? copyOneRow(shared, kind, id, takenFor(kind)) : null),
    compiled: (kind, cardId) => (again === "skip" ? earlier.get(`${kind}:${cardId}`) ?? null : null),
    record: (kind, rowId, cardId) => recordOrigin(campaignId, kind, rowId, sourceId, cardId),
  };
  let fights: ReturnType<typeof writeStoryboardRows>["fights"] = new Map();

  db.transaction(() => {
    // Maps first: places and fights bind to them by id, and the binding is
    // rewritten through the copy only if the copy already exists.
    if (selected.has("maps")) {
      copyKind(main, "maps");
    }
    if (selected.has("locations")) {
      copyKind(main, "locations");
    }
    if (selected.has("lore")) {
      copyKind(main, "lore");
    }
    if (selected.has("tables")) {
      copyKind(main, "tables");
    }
    if (selected.has("encounters")) {
      copyKind(main, "encounters");
    }
    if (selected.has("npcs")) {
      // Factions ride with the cast (docs/vtt-parity-implementation-plan.md
      // section 6), renumbered, with each member's link remapped.
      copyFactions(main);
      copyKind(main, "npcs");
    }
    // After the places and the cast, so a shop finds its place and keeper
    // when they travel with it (#171).
    if (selected.has("shops")) {
      copyKind(main, "shops");
    }
    // The storyboard is the one kind that is COMPILED rather than copied:
    // one board becomes lore entries, quests, prepared encounters, DM-only
    // notes and a story arc (src/lib/workshop/board-compile.ts).
    if (storyboard) {
      const rows = writeStoryboardRows(campaignId, campaign.ownerUserId, storyboard, now, resolver);
      counts.copied += rows.written;
      fights = rows.fights;
    }
    if (selected.has("overworld")) {
      copyOverworld(main, true);
    }
  })();

  // ---- after the transaction ----

  let beatsAdded = 0;
  if (storyboard) {
    const columns = writeStoryboardColumns(getCampaignById(campaignId) ?? campaign, storyboard, now, {
      resolver,
      fights,
      arcMode: input.arcMode ?? "leave",
      title: source.title,
    });
    counts.copied += columns.written;
    beatsAdded = columns.beatsAdded;
  }
  if (selected.has("houseRules")) {
    const incoming = getHouseRulesText(sourceId);
    if (incoming.trim()) {
      setHouseRules(
        campaignId,
        mergeHouseRules(incoming, getHouseRulesText(campaignId), houseRulesMode),
      );
      counts.copied += 1;
    }
    // The variant flags travel with the prose: they are the same decision.
    updateGameSettings(campaignId, { variantRules: source.gameSettings.variantRules });
  }

  if (selected.has("lore") || storyboard) {
    void embedPendingLore(campaignId).catch(() => {
      // A missing vector only means keyword fallback for that entry.
    });
  }

  return { plan, copied: counts.copied, idMap, kept: counts.kept, unbound: counts.unbound, beatsAdded };
}

export { IMPORT_KINDS };
