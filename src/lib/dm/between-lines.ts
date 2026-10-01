// What the narrator reads about each character's life off the battlefield:
// the diseases, madness and poisons the engine holds (src/lib/dm/afflictions.ts)
// and the lifestyle and downtime progress (src/lib/dm/lifestyle.ts). An
// incubating disease or a poison waiting for midnight has no condition on the
// sheet yet, so without these lines the model could not know it is there.

import { getClock } from "@/lib/db/clock";
import { liveAfflictions } from "@/lib/dm/afflictions";
import { lifestyleLine } from "@/lib/dm/lifestyle";
import { DISEASES, type DiseaseId } from "@/lib/srd/afflictions";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const hoursUntil = (at: number, now: number) => Math.max(1, Math.round((at - now) / 60));

// One line per affliction for the GAME STATE block.
export function afflictionLines(campaignId: string, sheet: Pick<CharacterSheet, "id" | "conditions">): string[] {
  const now = getClock(campaignId).instant;
  return liveAfflictions(campaignId, sheet).map((entry) => {
    if (entry.kind === "disease") {
      const disease = DISEASES[entry.id as DiseaseId];
      if (entry.onsetAt !== undefined) {
        return `infected with ${disease?.name ?? entry.id}, symptoms in ${hoursUntil(entry.onsetAt, now)} h`;
      }
      if (entry.id === "cackle_fever") {
        return `Cackle Fever (DC ${entry.dc ?? 13}, ${entry.fails ?? 0} of 3 failed rest saves)`;
      }
      if (entry.id === "sight_rot") {
        return `Sight Rot (-${entry.penalty ?? 1}, ${entry.doses ?? 0} of 3 Eyebright doses)`;
      }
      return disease?.name ?? entry.id;
    }
    if (entry.kind === "madness") {
      return entry.flaw
        ? `indefinite madness, flaw: ${entry.flaw}`
        : `${entry.id}-term madness (${entry.conditions.join(", ")}${entry.endsAt ? `, ${hoursUntil(entry.endsAt, now)} h left` : ""})`;
    }
    return `${entry.id.replace(/_/g, " ")}${entry.nextAt ? `, next save in ${hoursUntil(entry.nextAt, now)} h` : ""}`;
  });
}

// Every character's lines, keyed by sheet id; a character with nothing to
// say is left out.
export function betweenLinesBySheet(
  campaignId: string,
  sheets: Array<Pick<CharacterSheet, "id" | "conditions">>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const sheet of sheets) {
    const living = lifestyleLine(campaignId, sheet.id);
    const lines = [...afflictionLines(campaignId, sheet), ...(living ? [living] : [])];
    if (lines.length) {
      out.set(sheet.id, lines);
    }
  }
  return out;
}
