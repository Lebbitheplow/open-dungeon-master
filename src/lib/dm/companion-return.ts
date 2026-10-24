import { adaptSheetToLevel } from "@/lib/characters/adapt";
import { admitSheet } from "@/lib/characters/admit";
import type { Campaign } from "@/lib/db/campaigns";
import { deleteCalendarEvent } from "@/lib/db/calendar-events";
import { departedSheet, saveConscience, type DepartedSheet } from "@/lib/db/companion-conscience";
import { CONTENT } from "@/lib/dm/conscience-logic";
import { clearDeparture, companionDeparture, listDepartures } from "@/lib/db/companion-departures";
import { departedCompanion, forgetDepartedSheet } from "@/lib/db/companion-npcs";
import { deleteEncounterTemplate } from "@/lib/db/encounter-templates";
import type { EnemyStats } from "@/lib/bestiary/statblock";
import { sheetStatBlock } from "@/lib/dm/companion-statblock";
import type { Gone } from "@/lib/dm/departure-logic";
import { textKey } from "@/lib/language/text-logic";
import { levelForXp, XP_THRESHOLDS } from "@/lib/srd";
import { createSheetSchema, type CreateSheetInput } from "@/lib/schemas/sheet";

// A lasting companion written back into the story after a dismissal (#503
// Phase 0.4): the sheet they left with, kept on the row behind them, taken to
// the level the table plays at now by the same code a library companion
// comes through (src/lib/characters/adapt.ts, as companions/create does), and
// through the door every stored character comes through. Before this the DM's
// add_companion built a stranger with their name: a new class roll, a new
// kit, nothing they had learned.
//
// One who left by their own conscience (issue 503 Phase 3) shadowed the
// party while away: the experience it earned since is counted on their
// record (src/lib/db/companion-departures.ts), and taken up here, whichever
// way they come back: to rejoin (returningCompanion) or to fight
// (returningCombatant).
//
// Null when the name is nobody who left, or their sheet no longer passes
// (a rule changed, a homebrew row was deleted): the DM's own build stands.

export type Returning = { input: CreateSheetInput; level: number; leftAtLevel: number; npcId: string };

// The level a departed companion comes back at: the experience it left
// with (at least what its level needs) plus what the party earned since.
export function shadowLevel(departed: Pick<DepartedSheet, "level" | "xp">, gone: Pick<Gone, "xpSince">): number {
  const floor = XP_THRESHOLDS[Math.max(0, Math.min(19, departed.level - 1))] ?? 0;
  return Math.max(departed.level, Math.min(20, levelForXp(Math.max(departed.xp, floor) + gone.xpSince)));
}

export function returningCompanion(campaign: Campaign, name: string, level: number): Returning | null {
  const found = departedCompanion(campaign.id, name);
  if (!found) {
    return null;
  }
  const parsed = createSheetSchema.safeParse(found.departed.sheet);
  if (!parsed.success) {
    return null;
  }
  // Away by their own choice, they kept pace with the party; the DM's level
  // stands only for a companion the story sent off.
  const gone = companionDeparture(found.npc.id).gone;
  const at = gone ? shadowLevel(found.departed, gone) : level;
  const admitted = admitSheet({
    door: "stored",
    level: at,
    sheet: adaptSheetToLevel(parsed.data, found.departed.level, at),
    userId: campaign.ownerUserId,
    campaign,
  });
  if (!admitted.ok) {
    return null;
  }
  return { input: admitted.sheet, level: at, leftAtLevel: found.departed.level, npcId: found.npc.id };
}

// Once they are back, the live sheet is who they are: the copy goes, and the
// next dismissal writes a new one. Whatever their leaving left waiting (the
// prepared fight of their return, its calendar cue) goes with it.
export function settleReturn(campaign: Campaign, returning: Returning) {
  const gone = companionDeparture(returning.npcId).gone;
  if (gone?.templateId) {
    deleteEncounterTemplate(gone.templateId);
  }
  if (gone?.eventId) {
    deleteCalendarEvent(campaign.id, gone.eventId);
  }
  // One who left by their conscience and is taken back starts afresh: what
  // they saw before is behind them, and their standing alone sets their rung.
  if (gone) {
    saveConscience(returning.npcId, CONTENT);
  }
  clearDeparture(returning.npcId);
  forgetDepartedSheet(returning.npcId);
}

export type ReturningCombatant = { npcId: string; name: string; slug: string; level: number; stats: EnemyStats; cr: number };

// The fighter a departed companion comes back as (issue 503 Phase 3). The
// one place it is built, so Phase 6 swaps it here: once a sheet can sit on
// the enemy side of the initiative order (resolveCombatant()), this
// re-instantiates their own sheet, at the same shadow level, on that side.
// Until then they fight as a converted stat block: their kept sheet, taken
// to the level they shadowed the party to, read by the bestiary's own
// procedure (src/lib/dm/companion-statblock.ts: AC, hit points, their best
// weapon and Extra Attack, their spells as a monster's spellcasting, rated
// by derive-cr with a round of their best spell and the support handicap).
export function returningCombatant(campaign: Pick<Campaign, "id">, npcId: string, name: string): ReturningCombatant | null {
  const departed = departedSheet(npcId);
  const gone = companionDeparture(npcId).gone;
  if (!departed || !gone) {
    return null;
  }
  const parsed = createSheetSchema.safeParse(departed.sheet);
  if (!parsed.success) {
    return null;
  }
  const level = shadowLevel(departed, gone);
  const input = adaptSheetToLevel(parsed.data, departed.level, level);
  const { stats, rating } = sheetStatBlock({ ...input, name, level, alignment: input.alignment });
  void campaign;
  return { npcId, name, slug: `companion:${npcId}`, level, stats, cr: rating.cr };
}

// Every departed companion whose return is cued as a fight and has not run,
// by name key: who start_encounter fights as themselves when the roster
// names them (src/lib/dm/encounter-spawn.ts resolveEnemyRequests).
export function returningByName(campaignId: string): Map<string, ReturningCombatant> {
  const found = new Map<string, ReturningCombatant>();
  for (const entry of listDepartures(campaignId)) {
    const gone = entry.departure.gone;
    if (gone?.cued !== "fight" || gone.returned) {
      continue;
    }
    const combatant = returningCombatant({ id: campaignId }, entry.npcId, entry.name);
    if (combatant) {
      found.set(textKey(entry.name), combatant);
    }
  }
  return found;
}
