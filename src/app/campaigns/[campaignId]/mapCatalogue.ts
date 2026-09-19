import type { ObjectEntry, TileEntry } from "@/lib/battlemap/render/painted";
import { GENRES, SKIN_ROLES, type SkinChar } from "@/lib/battlemap/skins";

// How the two pickers order the painted catalogue: the stamp picker's sets and
// the tileset panel's materials. Apart from the components so it runs under
// Node (scripts/test-map-editor.mjs).

export const SET_LABELS: Record<string, string> = {
  arcane: "Arcane",
  barracks: "Barracks",
  camp: "Camp",
  cave: "Cave",
  crypt: "Crypt",
  cyberpunk: "Cyberpunk",
  desert: "Desert",
  dungeon: "Dungeon",
  field: "Field",
  forest: "Forest",
  forge: "Forge",
  frozen: "Frozen",
  garden: "Garden",
  graveyard: "Graveyard",
  horror: "Horror",
  kitchen: "Kitchen",
  lab: "Laboratory",
  library: "Library",
  market: "Market",
  mine: "Mine",
  mystery: "Mystery",
  prison: "Prison",
  river: "River",
  ruin: "Ruin",
  sewer: "Sewer",
  ship: "Ship",
  steampunk: "Steampunk",
  swamp: "Swamp",
  tavern: "Tavern",
  temple: "Temple",
  throne: "Throne room",
  volcanic: "Volcanic",
  wasteland: "Wasteland",
};

export function setLabel(set: string): string {
  return SET_LABELS[set] ?? set.replace(/(^|-)([a-z])/g, (_m, dash: string, letter: string) => (dash ? " " : "") + letter.toUpperCase());
}

export type StampGroup = { set: string; label: string; objects: ObjectEntry[]; own: boolean };

// Pure, so scripts/test-map-editor.mjs can hold it to its promises: every
// object appears under each of its sets, the map's own sets lead, and a search
// matches the label, the id or the set's name.
export function groupStamps(objects: readonly ObjectEntry[], ownSets: readonly string[], query: string): StampGroup[] {
  const needle = query.trim().toLowerCase();
  const bySet = new Map<string, ObjectEntry[]>();
  for (const object of objects) {
    for (const set of object.sets) {
      const hit =
        !needle ||
        (object.label ?? "").toLowerCase().includes(needle) ||
        object.id.includes(needle) ||
        setLabel(set).toLowerCase().includes(needle);
      if (!hit) {
        continue;
      }
      const list = bySet.get(set) ?? [];
      list.push(object);
      bySet.set(set, list);
    }
  }
  const groups = [...bySet.entries()].map(([set, list]) => ({
    set,
    label: setLabel(set),
    objects: [...list].sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id)),
    own: ownSets.includes(set),
  }));
  return groups.sort((a, b) => Number(b.own) - Number(a.own) || a.label.localeCompare(b.label));
}

export type MaterialGroup = { group: string; tiles: TileEntry[] };

// The materials that may paint one terrain character (3.11): the campaign's
// own setting first, then the fantasy set every setting can wear, then the
// other settings'. Within a group, the ones made for the map's theme lead.
export function materialChoices(
  tiles: readonly TileEntry[],
  char: SkinChar,
  genre: string | null | undefined,
  theme: string,
  query: string,
): MaterialGroup[] {
  const setting = (genre || "").toLowerCase().replace(/-/g, "_");
  const own = GENRES.includes(setting) ? setting : null;
  const needle = query.trim().toLowerCase();
  const allowed = tiles.filter(
    (tile) =>
      SKIN_ROLES[char].categories.includes(tile.category ?? "") &&
      (!needle || (tile.label ?? "").toLowerCase().includes(needle) || tile.id.includes(needle)),
  );
  const order = (list: TileEntry[]) =>
    [...list].sort(
      (a, b) =>
        Number(b.themes?.includes(theme) ?? false) - Number(a.themes?.includes(theme) ?? false) ||
        (a.label ?? a.id).localeCompare(b.label ?? b.id),
    );
  const groups: MaterialGroup[] = [];
  if (own) {
    groups.push({ group: "This setting", tiles: order(allowed.filter((tile) => tile.genre === own)) });
  }
  groups.push({ group: own ? "Fantasy" : "This setting", tiles: order(allowed.filter((tile) => !tile.genre)) });
  groups.push({ group: "Other settings", tiles: order(allowed.filter((tile) => tile.genre && tile.genre !== own)) });
  return groups.filter((entry) => entry.tiles.length > 0);
}
