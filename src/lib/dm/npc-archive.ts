import { listNpcs, setNpcArchived } from "@/lib/db/npcs";
import { findArchivedToRestore } from "@/lib/dm/npc-archive-logic";

// The DB/IO rim around npc-archive-logic.ts. Archiving itself happens at
// chapter close, in the same loop that ticks the pressure counters
// (src/lib/dm/npc-agency.ts); this is the other half, run per turn so a
// restore is never a turn late.

export function restoreMentionedNpcs(campaignId: string, text: string): string[] {
  if (!text.trim()) {
    return [];
  }
  const archived = listNpcs(campaignId)
    .filter((npc) => npc.archived)
    .map((npc) => ({
      id: npc.id,
      name: npc.name,
      aliases: npc.aliases,
      ignored: npc.agency.pressure.ignored,
      engaged: npc.agency.pressure.engaged,
      archived: true,
    }));
  if (!archived.length) {
    return [];
  }
  const restored = findArchivedToRestore(text, archived);
  for (const npcId of restored) {
    setNpcArchived(npcId, false);
  }
  return restored;
}
