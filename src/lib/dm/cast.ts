import { listNpcs } from "@/lib/db/npcs";
import { publishEphemeral } from "@/lib/events";

// The cast as every seat may see it (docs/vtt-parity-implementation-plan.md
// 8.1): names and faces, nothing of what they want or think. The snapshot
// carries it and cast_updated refreshes it whenever the DM changes a
// person, so a player's transcript can put a face beside a line.

// `aliases` are the other names they answer to, so a line tagged "Marla"
// finds Marla Venn (src/lib/dm/speech.ts).
export type CastMember = { id: string; name: string; portraitUrl: string; hasVoice: boolean; aliases?: string[] };

export function publicCast(campaignId: string): CastMember[] {
  return listNpcs(campaignId)
    .filter((npc) => !npc.archived)
    .map((npc) => ({ id: npc.id, name: npc.name, portraitUrl: npc.portraitUrl, hasVoice: npc.voice !== null, aliases: npc.aliases }));
}

export function publishCast(campaignId: string) {
  publishEphemeral(campaignId, "cast_updated", { cast: publicCast(campaignId) });
}
