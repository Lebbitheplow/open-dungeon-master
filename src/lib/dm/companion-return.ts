import { adaptSheetToLevel } from "@/lib/characters/adapt";
import { admitSheet } from "@/lib/characters/admit";
import type { Campaign } from "@/lib/db/campaigns";
import { deleteCalendarEvent } from "@/lib/db/calendar-events";
import { departedSheet, saveConscience, type DepartedSheet } from "@/lib/db/companion-conscience";
import { CONTENT } from "@/lib/dm/conscience-logic";
import { clearDeparture, companionDeparture, listDepartures, saveDeparture } from "@/lib/db/companion-departures";
import { companionNpcFor, departedCompanion, forgetDepartedSheet } from "@/lib/db/companion-npcs";
import { deleteEncounterTemplate } from "@/lib/db/encounter-templates";
import type { EnemyStats } from "@/lib/bestiary/statblock";
import { applyWear, sheetStatBlock, slotPools } from "@/lib/dm/companion-statblock";
import { createSheet, markSheetAsCompanion, patchSheet } from "@/lib/db/sheets";
import { createCompanionUser } from "@/lib/db/users";
import { setNpcAttitude } from "@/lib/db/npcs";
import { publishPersisted } from "@/lib/events";
import { isWorn, wearSteps, type Wear } from "@/lib/dm/return-wear-logic";
import type { Gone } from "@/lib/dm/departure-logic";
import { textKey } from "@/lib/language/text-logic";
import { levelForXp, XP_THRESHOLDS } from "@/lib/srd";
import { createSheetSchema, type CharacterSheet, type CreateSheetInput } from "@/lib/schemas/sheet";

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
// (fieldReturning, rated by returningCombatant).
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

export type ReturningCombatant = {
  npcId: string;
  name: string;
  level: number;
  // The block it is rated as (companion-statblock.ts), what a fight that
  // names it is budgeted on: never a block it fights as.
  stats: EnemyStats;
  cr: number;
  // The hit points it arrives with: its maximum, or fewer when it comes worn.
  currentHp: number;
  wear: Wear | null;
};

// The sheet a departed companion comes back with: the one it left with, at
// the level it shadowed the party to, rested (whole, every slot back).
function returningSheet(npcId: string, name: string) {
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
  return { sheet: rested({ ...input, name, level }), gone, level, departed };
}

// Whole, with every slot back, as after a long rest.
function rested<T extends Pick<CharacterSheet, "maxHp"> & { spellcasting?: CharacterSheet["spellcasting"] }>(sheet: T): T & { currentHp: number } {
  const casting = sheet.spellcasting;
  return {
    ...sheet,
    currentHp: sheet.maxHp,
    spellcasting: casting
      ? {
          ...casting,
          slots: Object.fromEntries(Object.entries(casting.slots).map(([key, slot]) => [key, { ...slot, used: 0 }])),
          ...(casting.pact ? { pact: { ...casting.pact, used: 0 } } : {}),
        }
      : casting,
  };
}

// What a departed companion comes back as (issue 503 Phase 3), rated: its
// kept sheet at the level it shadowed the party to, read by the bestiary's
// own procedure (src/lib/dm/companion-statblock.ts). Worn (its current hit
// points lowered, its slots spent: return-wear-logic.ts), it is rated as it
// stands. `wear` defaults to the one its return was cued with
// (src/lib/dm/companion-revenge.ts). It fights as that same sheet, fielded
// by fieldReturning on the foes' side.
export function returningCombatant(
  campaign: Pick<Campaign, "id">,
  npcId: string,
  name: string,
  wear: Wear | null = companionDeparture(npcId).gone?.wear ?? null,
): ReturningCombatant | null {
  const back = returningSheet(npcId, name);
  if (!back) {
    return null;
  }
  void campaign;
  const worn = isWorn(wear) ? applyWear(back.sheet, wear) : back.sheet;
  const { stats, rating } = sheetStatBlock(worn, { asItStands: isWorn(wear) });
  return { npcId, name, level: back.level, stats, cr: rating.cr, currentHp: worn.currentHp, wear: isWorn(wear) ? wear : null };
}

// What the return planner (departure-logic.ts planReturn) needs to wear a
// companion whole past the table's ceiling: every wear from the gentlest to
// the floor, and its rating at each, through the same path.
export function returnWear(campaign: Pick<Campaign, "id">, npcId: string, name: string): { maxHp: number; steps: Wear[]; rate: (wear: Wear) => number } | null {
  const back = returningSheet(npcId, name);
  if (!back) {
    return null;
  }
  return {
    maxHp: back.sheet.maxHp,
    steps: wearSteps(back.sheet.maxHp, slotPools(back.sheet)),
    rate: (wear) => returningCombatant(campaign, npcId, name, wear)?.cr ?? Number.POSITIVE_INFINITY,
  };
}

// The departed companion as a character at the table again, for the fight
// of its return (issue 503 Phase 6): the sheet it left with, taken to its
// shadow level through the door every stored character comes through,
// rested, then worn as its return was cued, under a bot user of its own and
// relinked to the row behind it (hostile now). Nobody commands it: the
// caller puts it on the foes' side (src/lib/dm/sheet-foes.ts), where the DM
// plays it. Its record says the return has run, and its prepared fight is
// spent. Null when the sheet no longer passes.
export function fieldReturning(campaign: Campaign, npcId: string, name: string): CharacterSheet | null {
  const back = returningSheet(npcId, name);
  if (!back) {
    return null;
  }
  const admitted = admitSheet({ door: "stored", level: back.level, sheet: back.sheet, userId: campaign.ownerUserId, campaign });
  if (!admitted.ok) {
    return null;
  }
  const bot = createCompanionUser(name);
  const created = createSheet(campaign.id, bot.id, back.level, admitted.sheet);
  const personality = (back.departed.sheet as { personality?: unknown }).personality;
  const marked = markSheetAsCompanion(created.id, "party", typeof personality === "string" ? personality : "") ?? created;
  const wear = back.gone.wear;
  const whole = rested(marked);
  const worn = isWorn(wear) ? applyWear(whole, wear) : whole;
  const sheet =
    patchSheet(marked.id, {
      currentHp: worn.currentHp,
      tempHp: 0,
      conditions: [],
      conditionMeta: {},
      deathSaves: null,
      ...(worn.spellcasting ? { spellcasting: worn.spellcasting } : {}),
    }) ?? marked;
  const npc = companionNpcFor(sheet);
  if (npc) {
    setNpcAttitude(npc.id, "hostile", "");
  }
  if (back.gone.templateId) {
    deleteEncounterTemplate(back.gone.templateId);
  }
  saveDeparture(npcId, { ...companionDeparture(npcId), gone: { ...back.gone, returned: true, templateId: "" } });
  publishPersisted(campaign.id, "sheet_updated", { sheet });
  return sheet;
}

// Every departed companion whose return is cued as a fight and has not run,
// by name key: who start_encounter fields as their own sheet when the
// roster names them (src/lib/dm/encounter-spawn.ts resolveEnemyRequests).
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
