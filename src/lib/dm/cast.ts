import { listNpcs } from "@/lib/db/npcs";
import { publishEphemeral } from "@/lib/events";

// The cast as every seat may see it (docs/vtt-parity-implementation-plan.md
// 8.1): names and faces, nothing of what they want or think. The snapshot
// carries it and cast_updated refreshes it whenever the DM changes a
// person, so a player's transcript can put a face beside a line.

export type CastMember = { id: string; name: string; portraitUrl: string; hasVoice: boolean };

export function publicCast(campaignId: string): CastMember[] {
  return listNpcs(campaignId)
    .filter((npc) => !npc.archived)
    .map((npc) => ({ id: npc.id, name: npc.name, portraitUrl: npc.portraitUrl, hasVoice: npc.voice !== null }));
}

export function publishCast(campaignId: string) {
  publishEphemeral(campaignId, "cast_updated", { cast: publicCast(campaignId) });
}
