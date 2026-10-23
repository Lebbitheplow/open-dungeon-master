import { getDatabase, parseJson } from "@/lib/db/core";
import { portableStatBlock } from "@/lib/db/workshop-bundle-shelf";

// References inside a bundle's rows that name another row or a monster by
// this server's id, written so another server can read them and read back
// on arrival. Split from src/lib/db/workshop-bundle-export.ts and
// workshop-bundle.ts to keep both under the project's 500-line cap.
//
//   - A prepared fight's roster row that names one of the author's own
//     monsters as "homebrew:<id>" travels as the monster's name, as a Cast
//     member's stat block already did. Kept as the id, the fight fielded
//     nothing for anyone but its author.
//   - A map pin that opens a lore entry, an NPC or a roll table points at
//     that row's place in the bundle ("#3"), and at the row it became on
//     arrival; a pin that opens a monster names it. Kept as the ids, every
//     pin pointed at a row that does not exist on the other side.

type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// Every string in a value, however deep: the words of a JSON column whose
// keys are not words anybody wrote.
export function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (isRec(value)) return Object.values(value).flatMap(stringsIn);
  return [];
}

export function portableRoster(enemies: unknown[]): unknown[] {
  return enemies.map((row) => {
    if (typeof row === "string") return row.trim().startsWith("homebrew:") ? portableStatBlock(row.trim()) || row : row;
    if (isRec(row) && typeof row.monster === "string" && row.monster.trim().startsWith("homebrew:")) {
      return { ...row, monster: portableStatBlock(row.monster.trim()) || row.monster };
    }
    return row;
  });
}

const LABEL_KINDS = { lore: "lore", npc: "npc", table: "table" } as const;

// A map's pins as a bundle carries them. `index` gives a row's place in the
// bundle's own list of its kind; a pin whose row does not travel keeps its
// words and loses its link.
export function portableLabels(labels: unknown[], index: Record<keyof typeof LABEL_KINDS, Map<string, number>>): unknown[] {
  return labels.map((label) => {
    if (!isRec(label) || !isRec(label.ref)) return label;
    const ref = label.ref;
    if (ref.kind === "monster" && typeof ref.id === "string") {
      const id = ref.id.trim().startsWith("homebrew:") ? portableStatBlock(ref.id.trim()) : ref.id;
      return id ? { ...label, ref: { kind: "monster", id } } : withoutRef(label);
    }
    const kind = typeof ref.kind === "string" && ref.kind in LABEL_KINDS ? (ref.kind as keyof typeof LABEL_KINDS) : null;
    const at = kind && typeof ref.id === "string" ? index[kind].get(ref.id) : undefined;
    return kind && at !== undefined ? { ...label, ref: { kind, id: `#${at}` } } : withoutRef(label);
  });
}

function withoutRef(label: Rec): Rec {
  const bare = { ...label };
  delete bare.ref;
  return bare;
}

// On arrival: each map's "#<index>" pins pointed at the rows they became.
// A pin from an older bundle (another server's id) or one whose row did not
// come loses its link and keeps its words.
export function landLabels(workshopId: string, mapIds: string[], ids: { lore: string[]; npc: string[]; table: string[] }): number {
  const db = getDatabase();
  let dropped = 0;
  for (const mapId of new Set(mapIds)) {
    const row = db.prepare(`SELECT labels_json FROM prepared_maps WHERE id = ? AND campaign_id = ?`).get(mapId, workshopId) as { labels_json: string } | undefined;
    if (!row) continue;
    let changed = false;
    const labels = parseJson<unknown[]>(row.labels_json, []).map((label) => {
      if (!isRec(label) || !isRec(label.ref) || label.ref.kind === "monster") return label;
      const kind = typeof label.ref.kind === "string" && label.ref.kind in LABEL_KINDS ? (label.ref.kind as keyof typeof LABEL_KINDS) : null;
      const match = typeof label.ref.id === "string" ? /^#(\d+)$/.exec(label.ref.id) : null;
      const id = kind && match ? ids[kind][Number(match[1])] : undefined;
      changed = true;
      if (id) return { ...label, ref: { kind, id } };
      dropped += 1;
      return withoutRef(label);
    });
    if (changed) db.prepare(`UPDATE prepared_maps SET labels_json = ? WHERE id = ?`).run(JSON.stringify(labels), mapId);
  }
  return dropped;
}
