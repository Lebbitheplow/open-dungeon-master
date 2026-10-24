import { adaptSheetToLevel } from "@/lib/characters/adapt";
import { admitSheet } from "@/lib/characters/admit";
import type { Campaign } from "@/lib/db/campaigns";
import { departedCompanion, forgetDepartedSheet } from "@/lib/db/companion-npcs";
import { createSheetSchema, type CreateSheetInput } from "@/lib/schemas/sheet";

// A lasting companion written back into the story after a dismissal (#503
// Phase 0.4): the sheet they left with, kept on the row behind them, taken to
// the level the table plays at now by the same code a library companion
// comes through (src/lib/characters/adapt.ts, as companions/create does), and
// through the door every stored character comes through. Before this the DM's
// add_companion built a stranger with their name: a new class roll, a new
// kit, nothing they had learned.
//
// Null when the name is nobody who left, or their sheet no longer passes
// (a rule changed, a homebrew row was deleted): the DM's own build stands.

export type Returning = { input: CreateSheetInput; level: number; leftAtLevel: number; npcId: string };

export function returningCompanion(campaign: Campaign, name: string, level: number): Returning | null {
  const found = departedCompanion(campaign.id, name);
  if (!found) {
    return null;
  }
  const parsed = createSheetSchema.safeParse(found.departed.sheet);
  if (!parsed.success) {
    return null;
  }
  const admitted = admitSheet({
    door: "stored",
    level,
    sheet: adaptSheetToLevel(parsed.data, found.departed.level, level),
    userId: campaign.ownerUserId,
    campaign,
  });
  if (!admitted.ok) {
    return null;
  }
  return { input: admitted.sheet, level, leftAtLevel: found.departed.level, npcId: found.npc.id };
}

// Once they are back, the live sheet is who they are: the copy goes, and the
// next dismissal writes a new one.
export function settleReturn(returning: Returning) {
  forgetDepartedSheet(returning.npcId);
}
