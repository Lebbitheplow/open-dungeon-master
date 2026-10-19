import { getDatabase } from "@/lib/db/core";
import { serializeMapAddonView, type MapAddonView } from "@/lib/addons/map-view";

// The addon_view_json column on prepared_maps and battle_maps
// (src/lib/addons/map-view.ts). Kept out of the two map modules, which are
// at their size, the way setPreparedMapSkin keeps the skin beside its table:
// written by its own statement after the row exists, normalized on the way
// in (the map modules parse it on the way out).

type MapTable = "prepared_maps" | "battle_maps";

export function writeMapAddonView(table: MapTable, mapId: string, view: MapAddonView | null): void {
  getDatabase().prepare(`UPDATE ${table} SET addon_view_json = ? WHERE id = ?`).run(serializeMapAddonView(view), mapId);
}
