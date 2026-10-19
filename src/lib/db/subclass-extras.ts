import { packSubclassExtras } from "@/lib/content/archetype-tables";
import { listHomebrew, tableAuthors } from "@/lib/db/homebrew";
import { subclassNamed } from "@/lib/srd/subclass-name";
import { extraSubclassOf, mergeExtras, type SubclassExtras } from "@/lib/srd/subclass-tables";

// The subclasses the bundled tables do not carry, for the feature grants
// (src/lib/srd/subclass-tables.ts): the content pack's prose archetypes,
// read once, and the workshop subclasses of whoever runs the table, read
// per call so an edit in the workshop reaches the next write of the sheet.

// For these authors: their workshop subclasses first, then the pack's.
export function subclassExtrasFor(userIds: string[]): SubclassExtras {
  const own: SubclassExtras = {};
  for (const entry of [...new Set(userIds)].flatMap((userId) => listHomebrew(userId, "archetype", { archived: true }))) {
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

// The table's subclasses its sheets hold, for the campaign snapshot: the
// browser reads a workshop subclass's feature text and always-prepared
// spells from these as the server does (src/lib/srd/features.ts
// registerBrowserSubclassExtras). Only the ones in play, so the snapshot
// stays small.
export function subclassExtrasAtTable(
  campaignId: string,
  sheets: Array<{ class: string; subclass?: string; classes?: Array<{ id: string; subclass?: string }> }>,
): SubclassExtras {
  const held = sheets.flatMap((sheet) =>
    sheet.classes?.length ? sheet.classes : [{ id: sheet.class, subclass: sheet.subclass }],
  );
  const wanted = held.filter((entry) => (entry.subclass ?? "").trim());
  if (!wanted.length) {
    return {};
  }
  const all = subclassExtrasFor(tableAuthors(campaignId));
  const out: SubclassExtras = {};
  for (const entry of wanted) {
    // By the id as the sheet holds it, as every other reader of these looks
    // it up (src/lib/srd/features.ts classFeaturesFor).
    const classId = entry.id;
    const table = (all[classId] ?? []).find((candidate) => subclassNamed(entry.subclass ?? "", candidate.name));
    if (table && !(out[classId] ?? []).includes(table)) {
      (out[classId] ??= []).push(table);
    }
  }
  return out;
}
