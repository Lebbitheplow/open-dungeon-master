import { resolveMonster } from "@/lib/bestiary/index";
import { getEntryDetail } from "@/lib/content/index";
import { getCampaignById } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { getEncounterTemplate } from "@/lib/db/encounter-templates";
import { getHomebrew, tableAuthors } from "@/lib/db/homebrew";
import { getPreparedMap, type PreparedMap } from "@/lib/db/prepared-maps";
import { TERRAIN } from "@/lib/battlemap/types";
import { rosterSize } from "@/lib/dm/encounter-template-logic";
import { parseRef, type Binding, type WorldDoc } from "@/lib/worldforge/model";

// A World entry's links to playable records, read (audit finding WF-17).
// A binding stores the ref the rest of the app uses for the record
// (src/lib/worldforge/model.ts Binding); here it is resolved the way play
// resolves it, against the authors of the table (src/lib/db/homebrew.ts
// tableAuthors), so a link is good exactly when the record is usable here.

export type BoundRecord = {
  kind: Binding["kind"];
  ref: string;
  // What the record is called, and a short line about it ("CR 2", "Your
  // own item"). Empty when the record cannot be found.
  name: string;
  detail: string;
  // The author's own record: its homebrew id, for opening it in its tool.
  // "" for a rulebook record.
  ownId: string;
  found: boolean;
  // A battle map's playable ground, as drawn or imported: walls, doors or
  // low walls inside its edge, and lights placed on it. A picture laid
  // under the grid is only a picture (src/lib/worldforge/model.ts MapRole):
  // until someone draws the walls, nothing claims the map has them.
  geometry?: MapGeometry;
  // A prepared encounter's battle map, when it is drawn on one.
  mapId?: string;
};

export type MapGeometry = { walls: boolean; lights: number; picture: boolean };

// What a prepared map's ground holds. The rim of a blank map is the
// library's own (src/lib/dm/map-library.ts blankTerrain), so only a wall
// inside it counts as one somebody drew.
export function mapGeometry(map: Pick<PreparedMap, "terrain" | "width" | "height" | "lights" | "zones" | "backdrop" | "overlayPath">): MapGeometry {
  const solid = new Set<string>([TERRAIN.wall, TERRAIN.door, TERRAIN.lowwall]);
  let walls = false;
  for (let y = 1; y < map.height - 1 && !walls; y += 1) {
    for (let x = 1; x < map.width - 1; x += 1) {
      if (solid.has(map.terrain[y * map.width + x])) {
        walls = true;
        break;
      }
    }
  }
  return { walls, lights: map.lights.length + map.zones.length, picture: Boolean(map.backdrop || map.overlayPath) };
}

// The words for a map's ground, the same wherever it is listed.
export function geometryWords(geometry: MapGeometry): string {
  if (!geometry.walls && !geometry.lights) return geometry.picture ? "a picture only: no walls or light drawn yet" : "no walls or light drawn yet";
  const lights = geometry.lights ? `${geometry.lights} light${geometry.lights === 1 ? "" : "s"}` : "no light placed";
  return `${geometry.walls ? "walls drawn" : "no walls drawn"}, ${lights}`;
}

const HOMEBREW = "homebrew:";

export function resolveBinding(campaignId: string, binding: Binding): BoundRecord {
  if (binding.kind === "map" || binding.kind === "encounter") return resolvePlaceBinding(campaignId, binding);
  const ownId = binding.ref.startsWith(HOMEBREW) && !binding.ref.startsWith(`${HOMEBREW}@`) ? binding.ref.slice(HOMEBREW.length) : "";
  const missing: BoundRecord = { ...binding, name: "", detail: "", ownId, found: false };
  const campaign = getCampaignById(campaignId);
  if (!campaign) return missing;
  const authors = tableAuthors(campaignId);
  if (binding.kind === "monster") {
    const monster = resolveMonster(binding.ref, campaign.gameSettings, { userIds: authors });
    // A homebrew ref is that row or nothing; a rulebook slug is its entry.
    if (!monster || (ownId && monster.slug !== binding.ref)) return missing;
    const cr = (monster.stats as { cr?: unknown }).cr;
    return { ...binding, name: monster.reskinName ?? monster.baseName, detail: cr === undefined || cr === null ? "" : `CR ${String(cr)}`, ownId, found: true };
  }
  if (ownId) {
    for (const author of authors) {
      const item = getHomebrew(author, ownId);
      if (item && item.kind === "item") return { ...binding, name: item.name, detail: "Your own item", ownId, found: true };
    }
    return missing;
  }
  try {
    const item = getEntryDetail("items", binding.ref);
    return item ? { ...binding, name: item.name, detail: "From the rulebook", ownId, found: true } : missing;
  } catch {
    // No content pack on this server: a rulebook item cannot be read.
    return missing;
  }
}

// A place's battle map or encounter: a row of this same campaign, by id.
// A ref from somewhere else (another campaign's row, a bundle's "@map:#2"
// that never landed) finds nothing here.
function resolvePlaceBinding(campaignId: string, binding: Binding): BoundRecord {
  const missing: BoundRecord = { ...binding, name: "", detail: "", ownId: binding.ref, found: false };
  if (binding.ref.startsWith("@")) return { ...missing, ownId: "" };
  if (binding.kind === "map") {
    const map = getPreparedMap(campaignId, binding.ref);
    if (!map) return missing;
    const geometry = mapGeometry(map);
    return { ...binding, name: map.name, detail: `${map.width} by ${map.height} squares, ${geometryWords(geometry)}`, ownId: map.id, found: true, geometry };
  }
  const template = getEncounterTemplate(binding.ref);
  if (!template || template.campaignId !== campaignId) return missing;
  const foes = rosterSize(template.enemies);
  const map = template.map.mapId ? getPreparedMap(campaignId, template.map.mapId) : null;
  return {
    ...binding,
    name: template.name,
    detail: `${foes} ${foes === 1 ? "foe" : "foes"}${map ? `, on ${map.name}` : ""}`,
    ownId: template.id,
    found: true,
    ...(map ? { mapId: map.id } : {}),
  };
}

// The World entries that link to one record, for the record's own tool:
// "used by" and the way back to each entry.
// The caller hands over the campaign's document (src/lib/db/world-forge.ts
// getWorldDoc), which reads this module.
export function entriesBoundTo(campaignId: string, doc: WorldDoc, kind: Binding["kind"], ref: string): Array<{ ref: string; name: string }> {
  const out: Array<{ ref: string; name: string }> = [];
  for (const [entryRef, entry] of Object.entries(doc.entries)) {
    if (!entry.bindings.some((binding) => binding.kind === kind && binding.ref === ref)) continue;
    const parsed = parseRef(entryRef);
    if (!parsed) continue;
    const table = parsed.shelf === "npc" ? "npcs" : parsed.shelf === "location" ? "locations" : parsed.shelf === "faction" ? "factions" : "lore_entries";
    const column = parsed.shelf === "lore" ? "title" : "name";
    const row = getDatabase().prepare(`SELECT ${column} AS name FROM ${table} WHERE id = ? AND campaign_id = ?`).get(parsed.id, campaignId) as { name?: string } | undefined;
    if (row?.name) out.push({ ref: entryRef, name: row.name });
  }
  return out;
}
