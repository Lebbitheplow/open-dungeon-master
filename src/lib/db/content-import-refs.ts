import { getDatabase, parseJson } from "@/lib/db/core";
import { copiesFrom } from "@/lib/db/content-origins";
import { textKey } from "@/lib/language/text-logic";

// The references a campaign import's copies make to each other by NAME, or
// by the source's row ids, pointed at what they became at the target
// (workshop import audit F04). Split from src/lib/db/content-import.ts to
// keep it under the project's 500-line cap.
//
// A copied row that collides with a target row of its name is numbered
// ("Gems (2)"). Everything that named it by name kept the old name, and so
// named the TARGET's row: a roll table's "@table: Gems" rolled the target's
// own Gems, a place's connection led to the target's place, an NPC stood in
// the target's place and kept their feud with the target's NPC. A map pin
// kept the source's lore id and opened nothing. Now each follows the copy,
// this import's or an earlier one's, and a roll-table row whose record
// stayed behind is named in the outcome.

type Rec = Record<string, unknown>;

const TABLE_OF = { tables: "roll_tables", npcs: "npcs", lore: "lore_entries", locations: "locations" } as const;
type NamedKind = keyof typeof TABLE_OF;
const LABEL_OF = { tables: "name", npcs: "name", lore: "title", locations: "name" } as const;
const ROW_REF: Record<string, NamedKind> = { table: "tables", npc: "npcs", lore: "lore" };
const NOUN: Record<NamedKind, string> = { tables: "table", npcs: "NPC", lore: "lore entry", locations: "place" };

function nameOf(kind: NamedKind, id: string): string | null {
  const row = getDatabase().prepare(`SELECT ${LABEL_OF[kind]} AS name FROM ${TABLE_OF[kind]} WHERE id = ?`).get(id) as { name: string } | undefined;
  return row?.name ?? null;
}

function hasNamed(kind: NamedKind, campaignId: string, name: string): boolean {
  const rows = getDatabase().prepare(`SELECT ${LABEL_OF[kind]} AS name FROM ${TABLE_OF[kind]} WHERE campaign_id = ?`).all(campaignId) as Array<{ name: string }>;
  return rows.some((row) => textKey(row.name) === textKey(name));
}

export function remapImportedRefs(input: {
  sourceId: string;
  campaignId: string;
  // `kind:sourceRowId` -> the row this import wrote.
  idMap: Map<string, string>;
}): { notes: string[]; unbound: number } {
  const { sourceId, campaignId, idMap } = input;
  const db = getDatabase();
  // Every copy at the target of a source row, this import's and earlier ones'.
  const copies = new Map([...copiesFrom(campaignId, sourceId), ...idMap]);
  // The source's name for a record -> the name its copy has here.
  const names: Record<NamedKind, Map<string, string>> = { tables: new Map(), npcs: new Map(), lore: new Map(), locations: new Map() };
  for (const [key, targetId] of copies) {
    const kind = key.slice(0, key.indexOf(":")) as NamedKind;
    if (!(kind in TABLE_OF)) continue;
    const from = nameOf(kind, key.slice(key.indexOf(":") + 1));
    const to = nameOf(kind, targetId);
    if (from !== null && to !== null && !names[kind].has(textKey(from))) names[kind].set(textKey(from), to);
  }
  const written = (kind: string) => [...idMap].filter(([key]) => key.startsWith(`${kind}:`)).map(([, id]) => id);
  const notes = new Set<string>();
  let unbound = 0;

  // Roll tables: a row that is another table, an NPC or a lore entry.
  for (const id of written("tables")) {
    const row = db.prepare(`SELECT name, entries_json FROM roll_tables WHERE id = ?`).get(id) as { name: string; entries_json: string } | undefined;
    if (!row) continue;
    let changed = false;
    const entries = parseJson<Rec[]>(row.entries_json, []).map((entry) => {
      const ref = entry?.ref as { kind?: unknown; name?: unknown } | undefined;
      const kind = typeof ref?.kind === "string" ? ROW_REF[ref.kind] : undefined;
      if (!kind || typeof ref?.name !== "string") return entry;
      const to = names[kind].get(textKey(ref.name));
      if (to !== undefined) {
        if (to === ref.name) return entry;
        changed = true;
        return { ...entry, text: to, ref: { ...ref, name: to } };
      }
      // What it names stayed behind at the source: say what it reads now.
      if (hasNamed(kind, sourceId, ref.name)) {
        notes.add(
          hasNamed(kind, campaignId, ref.name)
            ? `${row.name}: its row for the ${NOUN[kind]} ${ref.name} now names this campaign's own ${ref.name}, since the source's stayed behind.`
            : `${row.name}: its row for the ${NOUN[kind]} ${ref.name} names nothing here, since that ${NOUN[kind]} stayed behind.`,
        );
      }
      return entry;
    });
    if (changed) db.prepare(`UPDATE roll_tables SET entries_json = ? WHERE id = ?`).run(JSON.stringify(entries), id);
  }

  // Places: the places a path leads to.
  for (const id of written("locations")) {
    const row = db.prepare(`SELECT connections_json FROM locations WHERE id = ?`).get(id) as { connections_json: string } | undefined;
    if (!row) continue;
    const connections = parseJson<unknown[]>(row.connections_json, []);
    const next = connections.map((name) => (typeof name === "string" ? (names.locations.get(textKey(name)) ?? name) : name));
    if (next.some((name, index) => name !== connections[index])) {
      db.prepare(`UPDATE locations SET connections_json = ? WHERE id = ?`).run(JSON.stringify(next), id);
    }
  }

  // The Cast: where each stands, and whom their relations name.
  for (const id of written("npcs")) {
    const row = db.prepare(`SELECT location, relations_json FROM npcs WHERE id = ?`).get(id) as { location: string; relations_json: string } | undefined;
    if (!row) continue;
    const location = row.location ? (names.locations.get(textKey(row.location)) ?? row.location) : row.location;
    let touched = location !== row.location;
    const relations = parseJson<unknown[]>(row.relations_json, []);
    const nextRelations = Array.isArray(relations)
      ? relations.map((relation) => {
          const npcName = (relation as { npcName?: unknown } | null)?.npcName;
          const to = typeof npcName === "string" ? names.npcs.get(textKey(npcName)) : undefined;
          if (to === undefined || to === npcName) return relation;
          touched = true;
          return { ...(relation as Rec), npcName: to };
        })
      : relations;
    if (touched) db.prepare(`UPDATE npcs SET location = ?, relations_json = ? WHERE id = ?`).run(location, JSON.stringify(nextRelations), id);
  }

  // Map pins: the lore entry, NPC or table each opens, by its copy's id. A
  // pin whose row did not come keeps its words and loses its link.
  const pinKind: Record<string, string> = { lore: "lore", npc: "npcs", table: "tables" };
  for (const id of written("maps")) {
    const row = db.prepare(`SELECT labels_json FROM prepared_maps WHERE id = ?`).get(id) as { labels_json: string } | undefined;
    if (!row) continue;
    let changed = false;
    const labels = parseJson<Rec[]>(row.labels_json, []).map((label) => {
      const ref = label?.ref as { kind?: unknown; id?: unknown } | undefined;
      const kind = typeof ref?.kind === "string" ? pinKind[ref.kind] : undefined;
      if (!kind || typeof ref?.id !== "string") return label;
      const to = copies.get(`${kind}:${ref.id}`);
      changed = true;
      if (to) return { ...label, ref: { ...ref, id: to } };
      unbound += 1;
      const bare = { ...label };
      delete bare.ref;
      return bare;
    });
    if (changed) db.prepare(`UPDATE prepared_maps SET labels_json = ? WHERE id = ?`).run(JSON.stringify(labels), id);
  }

  return { notes: [...notes], unbound };
}

// For the preview: how many of the source's roll-table rows name an NPC, a
// lore entry or another table that will not be at the target, so the DM
// hears it before the button, not after.
export function tableRowsLeftBehind(
  sourceId: string,
  arriving: (kind: NamedKind, sourceRowId: string) => boolean,
): number {
  const db = getDatabase();
  const rows = (kind: NamedKind) =>
    db.prepare(`SELECT id, ${LABEL_OF[kind]} AS name FROM ${TABLE_OF[kind]} WHERE campaign_id = ?`).all(sourceId) as Array<{ id: string; name: string }>;
  const sources = { tables: rows("tables"), npcs: rows("npcs"), lore: rows("lore") };
  let left = 0;
  for (const table of db.prepare(`SELECT entries_json FROM roll_tables WHERE campaign_id = ?`).all(sourceId) as Array<{ entries_json: string }>) {
    for (const entry of parseJson<Rec[]>(table.entries_json, [])) {
      const ref = entry?.ref as { kind?: unknown; name?: unknown } | undefined;
      const kind = typeof ref?.kind === "string" ? ROW_REF[ref.kind] : undefined;
      if (!kind || kind === "locations" || typeof ref?.name !== "string") continue;
      const named = sources[kind].filter((row) => textKey(row.name) === textKey(ref.name as string));
      if (named.length && !named.some((row) => arriving(kind, row.id))) left += 1;
    }
  }
  return left;
}

// The source rows of the kinds an import takes, by kind, for the preview's
// look at what they name.
export function importRowsOf(
  sourceId: string,
  chosen: readonly string[],
): { npcs: string[]; encounters: string[]; tables: string[]; maps: string[]; shops: string[] } {
  const ids = (kind: string, table: string) =>
    chosen.includes(kind)
      ? (getDatabase().prepare(`SELECT id FROM ${table} WHERE campaign_id = ?`).all(sourceId) as Array<{ id: string }>).map((row) => row.id)
      : [];
  return {
    npcs: ids("npcs", "npcs"),
    encounters: ids("encounters", "encounter_templates"),
    tables: ids("tables", "roll_tables"),
    maps: ids("maps", "prepared_maps"),
    shops: ids("shops", "shops"),
  };
}
