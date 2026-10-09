import { LIMITS, linkFingerprint, type WorldLink } from "@/lib/worldforge/model";

// Links brought in again by a second import of the same world (a WorldForge
// file, or another workshop copied over), merged with the links already
// here (docs/workshop-rulebook-audit-pr169.md F15). Each imported link
// remembers which source link it is and how that link read when it came in
// (WorldLink.importedFrom, importedAs), so:
//
//   - a source link not seen before is added;
//   - one that changed at the source (its truth, its rank, its direction,
//     its label) and was not touched here is updated to match;
//   - one changed here and not at the source keeps the local edit;
//   - one changed on both sides keeps the local edit and is reported as a
//     conflict to review;
//   - one the source dropped is removed if nobody changed it here, and
//     reported if somebody did.
//
// A link imported before links carried their source is matched by its ends
// and label, and the source's reading wins (nobody can tell it was edited).
// Pure: the callers write the document.

export type LinkMerge = { links: WorldLink[]; added: number; updated: number; removed: number; conflicts: string[] };

const keyOf = (link: Pick<WorldLink, "from" | "to" | "label">) => `${link.from}|${link.to}|${link.label.toLowerCase()}`;

export function mergeImportedLinks(
  own: WorldLink[],
  incoming: WorldLink[],
  source: string,
  nameOf: (ref: string) => string = (ref) => ref,
): LinkMerge {
  const links = own.map((link) => ({ ...link }));
  const conflicts: string[] = [];
  let added = 0;
  let updated = 0;
  let removed = 0;
  const describe = (link: WorldLink) => `${nameOf(link.from)} ${link.label} ${nameOf(link.to)}`;
  const seen = new Set<string>();
  for (const theirs of incoming) {
    const from = `${source}:${theirs.id}`;
    seen.add(from);
    const print = linkFingerprint(theirs);
    const mine =
      links.find((link) => link.importedFrom === from) ??
      links.find((link) => !link.importedFrom && keyOf(link) === keyOf(theirs));
    if (!mine) {
      if (links.length >= LIMITS.links) continue;
      links.push({ ...theirs, id: links.some((link) => link.id === theirs.id) ? `${theirs.id}-${links.length}` : theirs.id, importedFrom: from, importedAs: print });
      added += 1;
      continue;
    }
    const local = linkFingerprint(mine);
    const untouched = !mine.importedAs || local === mine.importedAs;
    if (local === print) {
      Object.assign(mine, { importedFrom: from, importedAs: print });
    } else if (untouched) {
      Object.assign(mine, {
        from: theirs.from,
        to: theirs.to,
        label: theirs.label,
        veracity: theirs.veracity,
        oneway: theirs.oneway,
        rank: theirs.rank,
        importedFrom: from,
        importedAs: print,
      });
      updated += 1;
    } else if (mine.importedAs !== print) {
      // Changed here and at the source: the local edit stands, said aloud.
      conflicts.push(`${describe(mine)}: changed here and in the import (which says ${theirs.veracity}${theirs.rank ? `, ${theirs.rank}` : ""}${theirs.oneway ? ", one way" : ""}); yours was kept.`);
      Object.assign(mine, { importedFrom: from });
    }
  }
  // What the source no longer has.
  const kept: WorldLink[] = [];
  for (const link of links) {
    if (link.importedFrom?.startsWith(`${source}:`) && !seen.has(link.importedFrom)) {
      if (!link.importedAs || linkFingerprint(link) === link.importedAs) {
        removed += 1;
        continue;
      }
      conflicts.push(`${describe(link)}: gone from the import, but changed here; yours was kept.`);
    }
    kept.push(link);
  }
  return { links: kept, added, updated, removed, conflicts };
}
