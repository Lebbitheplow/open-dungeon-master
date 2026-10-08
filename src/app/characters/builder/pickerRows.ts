// One row per name in a picker, the way a player expects: the pack files
// the same SRD entry under more than one document, so a browse shows Fire
// Bolt twice. Pure, so scripts/test-adventuring-gear.mjs can drive it.
//
// Where a name is filed twice under different kinds (Spell Scroll and
// Potion of Healing are a magic item in one document and priced gear in
// another), the mundane row is the one kept: that is the row the server
// prices a purchase by (src/lib/characters/catalog.ts, "a name the pack
// lists as mundane gear is mundane"), so a pick and its price check read
// the same row. Otherwise the first row wins, as before.
export function uniqueByName<T extends { name: string; kind?: string }>(rows: T[]): T[] {
  const kept = new Map<string, T>();
  const order: string[] = [];
  for (const entry of rows) {
    const key = entry.name.trim().toLowerCase();
    const held = kept.get(key);
    if (!held) {
      kept.set(key, entry);
      order.push(key);
    } else if (held.kind === "magic_item" && entry.kind && entry.kind !== "magic_item") {
      kept.set(key, entry);
    }
  }
  return order.map((key) => kept.get(key)!);
}
