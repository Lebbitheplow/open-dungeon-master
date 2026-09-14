import { listDmBeats } from "@/lib/db/dm-beats";
import { listLoreEntries } from "@/lib/db/lore";
import { listNpcs } from "@/lib/db/npcs";
import { listNotesVisibleTo } from "@/lib/db/notes";
import { loreBacklinks, type LoreMention } from "@/lib/dm/world-lore-logic";

// "Mentioned in" for one entry (docs/vtt-parity-implementation-plan.md
// section 5.4): every other entry, the cast's own words, the DM's beats
// and the table's notes that [[link]] it by name. The DM seat sees beats;
// a player sees only what they could open anyway.

export function backlinksFor(
  campaignId: string,
  entryId: string,
  viewer: { userId: string; steersStory: boolean },
): LoreMention[] {
  const entries = listLoreEntries(campaignId);
  const target = entries.find((entry) => entry.id === entryId);
  if (!target) {
    return [];
  }
  const sources: Array<{ kind: LoreMention["kind"]; id: string; name: string; text: string }> = [];
  for (const entry of entries) {
    if (entry.id === entryId) {
      continue;
    }
    if (!viewer.steersStory && (entry.visibility === "dm" || (entry.audience && !entry.audience.includes(viewer.userId)))) {
      continue;
    }
    sources.push({ kind: "lore", id: entry.id, name: entry.title, text: entry.body });
  }
  if (viewer.steersStory) {
    for (const npc of listNpcs(campaignId)) {
      const agency = npc.agency as { goals?: Record<string, unknown>; relations?: Array<{ note?: string }> };
      const goals = Object.values(agency.goals ?? {})
        .map((goal) => (typeof goal === "string" ? goal : typeof goal === "object" && goal && "text" in goal ? String((goal as { text: unknown }).text) : ""))
        .join(" ");
      const notes = (agency.relations ?? []).map((relation) => relation.note ?? "").join(" ");
      sources.push({ kind: "npc", id: npc.id, name: npc.name, text: `${npc.trait} ${goals} ${notes}` });
    }
    for (const beat of listDmBeats(campaignId, 200)) {
      sources.push({ kind: "beat", id: beat.id, name: beat.body.slice(0, 60), text: beat.body });
    }
  }
  for (const note of listNotesVisibleTo(campaignId, viewer.userId, viewer.steersStory)) {
    sources.push({ kind: "note", id: note.id, name: note.title || note.body.slice(0, 60), text: `${note.title} ${note.body}` });
  }
  return loreBacklinks(target.title, sources);
}
