import { packSubclassExtras } from "@/lib/content/archetype-tables";
import { listHomebrew, tableAuthors } from "@/lib/db/homebrew";
import { extraSubclassOf, mergeExtras, type SubclassExtras } from "@/lib/srd/subclass-tables";

// The subclasses the bundled tables do not carry, for the feature grants
// (src/lib/srd/subclass-tables.ts): the content pack's prose archetypes,
// read once, and the workshop subclasses of whoever runs the table, read
// per call so an edit in the workshop reaches the next write of the sheet.

// For these authors: their workshop subclasses first, then the pack's.
export function subclassExtrasFor(userIds: string[]): SubclassExtras {
  const own: SubclassExtras = {};
  for (const entry of [...new Set(userIds)].flatMap((userId) => listHomebrew(userId, "archetype"))) {
    const classId = String(entry.data.classSlug ?? "").toLowerCase();
    const table = extraSubclassOf({ name: entry.name, source: "homebrew", data: entry.data });
    if (classId && table) {
      (own[classId] ??= []).push(table);
    }
  }
  return mergeExtras(own, packSubclassExtras());
}

// For a sheet at a table: the workshop of whoever runs it. Outside a
// campaign (a library character) the owner's own.
export function subclassExtrasForTable(campaignId: string | null | undefined, ownerUserId: string): SubclassExtras {
  return subclassExtrasFor(campaignId ? tableAuthors(campaignId) : [ownerUserId]);
}
