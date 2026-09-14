import type { Campaign } from "@/lib/db/campaigns";
import { listMembers } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The characters in play (docs/vtt-parity-implementation-plan.md 11.3).
// With one character active per player, a player's other characters wait
// off the board: they are not staged into fights or placed on the map. All
// of them field when the table says so, and companions always do.
export function fieldedSheets(campaign: Campaign, sheets: CharacterSheet[] = listSheets(campaign.id)): CharacterSheet[] {
  if (campaign.gameSettings.multiCharacter !== "one_active") {
    return sheets;
  }
  const active = new Map<string, string>();
  for (const member of listMembers(campaign.id)) {
    active.set(member.userId, member.activeCharacterId);
  }
  const firstByUser = new Map<string, string>();
  for (const sheet of sheets) {
    if (!sheet.isCompanion && !firstByUser.has(sheet.userId)) {
      firstByUser.set(sheet.userId, sheet.id);
    }
  }
  return sheets.filter((sheet) => {
    if (sheet.isCompanion) {
      return true;
    }
    const chosen = active.get(sheet.userId) || firstByUser.get(sheet.userId);
    return !chosen || chosen === sheet.id;
  });
}

// Benched: made by this user, not the one they are playing.
export function benchedSheetIds(campaign: Campaign, sheets: CharacterSheet[]): Set<string> {
  const fielded = new Set(fieldedSheets(campaign, sheets).map((sheet) => sheet.id));
  return new Set(sheets.filter((sheet) => !fielded.has(sheet.id)).map((sheet) => sheet.id));
}
