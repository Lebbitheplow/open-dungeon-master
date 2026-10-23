import { getDatabase, parseJson } from "@/lib/db/core";
import { textKey } from "@/lib/language/text-logic";

// The places a campaign's (or a workshop's) prep names a hand-built monster
// or a Homebrew item by NAME, rewritten under a new name in one pass: a Cast
// member's stat block, a prepared fight's roster, a roll-table row that is a
// monster or an item, a shop's shelf line.
//
// Three callers: a bundle whose monsters or items arrived renamed beside the
// importer's own (src/lib/db/workshop-bundle-shelf.ts), a campaign import
// that brought another author's monster or item in under a new name
// (src/lib/db/import-monsters.ts), and a rename in the author's own Homebrew
// or bestiary (src/lib/db/homebrew-rename.ts). Before this the first only
// rewrote stat blocks and rosters, and the others nothing, so a table row or
// a shelf line went on naming the old entry, or a different one of that name.

// Old name (any spelling textKey folds together) to the new one.
export type PrepRenames = { monster?: Map<string, string>; item?: Map<string, string> };

export function prepRenames(pairs: Array<{ kind: "monster" | "item"; from: string; to: string }>): PrepRenames {
  const out: PrepRenames = {};
  for (const pair of pairs) {
    if (textKey(pair.from) === textKey(pair.to) && pair.from === pair.to) continue;
    (out[pair.kind] ??= new Map()).set(textKey(pair.from), pair.to);
  }
  return out;
}

const renamed = (map: Map<string, string> | undefined, name: unknown): string | null =>
  typeof name === "string" && map ? (map.get(textKey(name)) ?? null) : null;

// The rows an import just wrote, when only those may change: the target's
// own rows that name a monster of that name meant their own.
export type PrepRows = { npcs?: string[]; encounters?: string[]; tables?: string[]; shops?: string[]; maps?: string[] };

// Rewrites one campaign's prep; returns how many rows changed.
export function renamePrepRefs(campaignId: string, renames: PrepRenames, only?: PrepRows): number {
  const { monster, item } = renames;
  if (!monster?.size && !item?.size) {
    return 0;
  }
  const db = getDatabase();
  const allowed = (kind: keyof PrepRows, id: string) => !only || (only[kind] ?? []).includes(id);
  let changed = 0;
  if (monster?.size) {
    // Matched in code: SQLite's lower() folds ASCII only.
    const npcs = (db.prepare(`SELECT id, stat_block FROM npcs WHERE campaign_id = ? AND stat_block <> ''`).all(campaignId) as Array<{ id: string; stat_block: string }>).filter((row) => allowed("npcs", row.id));
    for (const npc of npcs) {
      const to = renamed(monster, npc.stat_block);
      if (to) {
        db.prepare(`UPDATE npcs SET stat_block = ? WHERE id = ?`).run(to, npc.id);
        changed += 1;
      }
    }
    const fights = (db.prepare(`SELECT id, enemies_json FROM encounter_templates WHERE campaign_id = ?`).all(campaignId) as Array<{ id: string; enemies_json: string }>).filter((row) => allowed("encounters", row.id));
    for (const fight of fights) {
      let touched = false;
      const enemies = parseJson<unknown[]>(fight.enemies_json, []).map((enemy) => {
        const to = renamed(monster, typeof enemy === "string" ? enemy : (enemy as { monster?: unknown } | null)?.monster);
        if (!to) return enemy;
        touched = true;
        return typeof enemy === "string" ? to : { ...(enemy as Record<string, unknown>), monster: to };
      });
      if (touched) {
        db.prepare(`UPDATE encounter_templates SET enemies_json = ? WHERE id = ?`).run(JSON.stringify(enemies), fight.id);
        changed += 1;
      }
    }
  }
  if (monster?.size) {
    // A map pin that opens a monster names it.
    const maps = (db.prepare(`SELECT id, labels_json FROM prepared_maps WHERE campaign_id = ?`).all(campaignId) as Array<{ id: string; labels_json: string }>).filter((row) => allowed("maps", row.id));
    for (const map of maps) {
      let touched = false;
      const labels = parseJson<Array<Record<string, unknown>>>(map.labels_json, []).map((label) => {
        const ref = label?.ref as { kind?: unknown; id?: unknown } | undefined;
        const to = ref?.kind === "monster" ? renamed(monster, ref.id) : null;
        if (!to || !ref) return label;
        touched = true;
        return { ...label, ref: { ...ref, id: to } };
      });
      if (touched) {
        db.prepare(`UPDATE prepared_maps SET labels_json = ? WHERE id = ?`).run(JSON.stringify(labels), map.id);
        changed += 1;
      }
    }
  }
  const tables = (db.prepare(`SELECT id, entries_json FROM roll_tables WHERE campaign_id = ?`).all(campaignId) as Array<{ id: string; entries_json: string }>).filter((row) => allowed("tables", row.id));
  for (const table of tables) {
    let touched = false;
    const entries = parseJson<Array<Record<string, unknown>>>(table.entries_json, []).map((entry) => {
      const ref = entry?.ref as { kind?: unknown; name?: unknown } | undefined;
      const map = ref?.kind === "monster" ? monster : ref?.kind === "item" ? item : undefined;
      const to = renamed(map, ref?.name);
      if (!to || !ref) return entry;
      touched = true;
      // A row that is a thing reads as its name (roll-table-logic.ts parseRowText).
      return { ...entry, text: to, ref: { ...ref, name: to } };
    });
    if (touched) {
      db.prepare(`UPDATE roll_tables SET entries_json = ? WHERE id = ?`).run(JSON.stringify(entries), table.id);
      changed += 1;
    }
  }
  if (item?.size) {
    const shops = (db.prepare(`SELECT id, stock_json, prepared_stock_json FROM shops WHERE campaign_id = ?`).all(campaignId) as Array<{ id: string; stock_json: string; prepared_stock_json: string | null }>).filter((row) => allowed("shops", row.id));
    for (const shop of shops) {
      let touched = false;
      const shelf = (json: string | null) =>
        json
          ? JSON.stringify(
              parseJson<Array<Record<string, unknown>>>(json, []).map((line) => {
                const to = renamed(item, line?.itemName);
                if (!to) return line;
                touched = true;
                return { ...line, itemName: to };
              }),
            )
          : json;
      const stock = shelf(shop.stock_json);
      const prepared = shelf(shop.prepared_stock_json);
      if (touched) {
        db.prepare(`UPDATE shops SET stock_json = ?, prepared_stock_json = ? WHERE id = ?`).run(stock, prepared, shop.id);
        changed += 1;
      }
    }
  }
  return changed;
}
