import { listCastNpcs, type Npc } from "@/lib/db/npcs";
import { departedSheet } from "@/lib/db/companion-conscience";
import { characterPlaceholder } from "@/lib/placeholders";
import { publishEphemeral } from "@/lib/events";

// The cast as every seat may see it (docs/vtt-parity-implementation-plan.md
// 8.1): names and faces, nothing of what they want or think. The snapshot
// carries it and cast_updated refreshes it whenever the DM changes a
// person, so a player's transcript can put a face beside a line.

// `aliases` are the other names they answer to, so a line tagged "Marla"
// finds Marla Venn (src/lib/dm/speech.ts).
// `plate` is the stand-in face for a companion who left the party: the
// painted plate for the class and ancestry their sheet had, which their
// lines showed while they travelled with the party and had no portrait.
// The row behind them speaks their parting line, and without it that line
// showed a letter (issue 660). Worked out here from the sheet kept on the
// departure record, never written onto the row, so a portrait the row has
// or is painted later comes first (castFaces, src/lib/speaker-faces.ts).
export type CastMember = { id: string; name: string; portraitUrl: string; hasVoice: boolean; aliases?: string[]; plate?: string };

export function publicCast(campaignId: string): CastMember[] {
  // A companion in the party shows as a party member, not as cast.
  return listCastNpcs(campaignId)
    .filter((npc) => !npc.archived)
    .map((npc) => {
      // Sent beside a portrait too, so an upload that cannot be reached
      // gives way to it, as a character's portrait does (speakerFaces).
      const plate = departedPlate(npc);
      return { id: npc.id, name: npc.name, portraitUrl: npc.portraitUrl, hasVoice: npc.voice !== null, aliases: npc.aliases, ...(plate ? { plate } : {}) };
    });
}

function departedPlate(npc: Npc): string {
  if (!npc.companionSheetId) {
    return "";
  }
  const sheet = departedSheet(npc.id)?.sheet;
  if (!sheet) {
    return "";
  }
  const word = (value: unknown) => (typeof value === "string" ? value : undefined);
  return characterPlaceholder({ race: word(sheet.race) ?? "", class: word(sheet.class), gender: word(sheet.gender) });
}

export function publishCast(campaignId: string) {
  publishEphemeral(campaignId, "cast_updated", { cast: publicCast(campaignId) });
}
