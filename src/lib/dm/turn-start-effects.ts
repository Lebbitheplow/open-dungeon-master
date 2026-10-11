// What the turns now starting bring, as the initiative pointer moves
// (src/lib/dm/encounter-tools.ts advancePointer): the turns that begin are
// marked for the effects that wait on their end, a character walked past
// has theirs start and end at once, Holy Nimbus burns, a character whose
// flight ended comes down, and each enemy whose turn starts regenerates and
// refills its legendary actions. The lines go to the table as one note.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishWithSeq } from "@/lib/events";
import { holyNimbusTurnStart } from "@/lib/dm/combat-features";
import { refillLegendaryForTurn } from "@/lib/dm/legendary-tools";
import { landTheFlightless } from "@/lib/dm/map-tools";
import { regenerationTurnStart } from "@/lib/dm/regeneration-turn";
import { beginTurns, endTurns } from "@/lib/dm/turn-end";

export function turnStartEffects(
  campaign: Campaign,
  encounter: Encounter,
  starting: string[],
  enemiesById: Map<string, EncounterEnemy>,
  // What ended with the turn the pointer left, posted first.
  endedLines: string[],
) {
  // What waits on the end of the turns now starting is marked; a character
  // walked past (down, skipped) has theirs start and end in this move.
  beginTurns(campaign, encounter.id, starting);
  const walkedPast = starting.slice(0, -1).filter((id) => !enemiesById.has(id));
  const passedEnd = endTurns(campaign, encounter.id, walkedPast);
  // A legendary creature's own turn refills its legendary actions, a
  // recharge ability rolls its d6, and Regeneration heals. The pointer never
  // rests on an enemy, so the turn that is starting is read from the ones it
  // walked past.
  const turnStartLines: string[] = [
    ...endedLines,
    ...passedEnd.lines,
    // Holy Nimbus burns the enemies whose turns start in its light
    // (src/lib/dm/combat-features.ts).
    ...holyNimbusTurnStart(campaign, encounter, starting),
    // A character aloft whose flight has ended comes down.
    ...landTheFlightless(campaign, encounter.id),
  ];
  for (const id of starting) {
    const enemy = enemiesById.get(id);
    if (enemy?.status === "alive") {
      // A troll down at 0 rises or dies as its turn starts (regeneration-turn.ts).
      turnStartLines.push(...regenerationTurnStart(campaign, encounter, enemy));
      turnStartLines.push(...refillLegendaryForTurn(encounter, enemy));
    }
  }
  if (turnStartLines.length) {
    const seq = allocateSeq(campaign.id);
    const message = insertCampaignMessage({
      campaignId: campaign.id,
      seq,
      authorType: "system",
      glyph: "cue-bell",
      content: turnStartLines.join(" "),
    });
    publishWithSeq(campaign.id, seq, "message_added", { message });
  }
}
