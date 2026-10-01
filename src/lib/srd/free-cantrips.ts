// Cantrips a character knows from their race rather than their class: the
// high elf's one wizard cantrip, the tiefling's Thaumaturgy, the drow's
// Dancing Lights. The class's cantrip count leaves them out (SRD 5.1: a
// racial trait's spell is known on top of the class's), so a level-up must
// too, on the server and in the dialog alike.
//
// Creation already did (src/lib/srd/legality/spells.ts passes the racial pick
// and innateCantripsFor as free). A level-up counted only the race's
// cantripChoice, so a tiefling warlock whose list held Thaumaturgy was
// refused her fourth-level cantrip (U:UB3), and the dialog counted neither
// (U:UB2).
//
// Pure and import-light so the level-up route (src/app/api/campaigns/
// [campaignId]/sheet/route.ts) and the dialog
// (src/app/campaigns/[campaignId]/LevelUpDialog.tsx) share it.
import { innateCantripsFor } from "@/lib/srd/racial-grants";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type FreeCantripSheet = Pick<CharacterSheet, "race" | "level" | "spellcasting"> & {
  racialChoices?: { cantrip?: string } | null;
};

const lower = (name: string) => name.trim().toLowerCase();

// Every cantrip name the sheet holds, across the per-class lists.
function cantripsHeld(sheet: FreeCantripSheet): string[] {
  const casting = sheet.spellcasting;
  if (!casting) {
    return [];
  }
  return [...(casting.cantrips ?? []), ...(casting.casters ?? []).flatMap((caster) => caster.cantrips ?? [])];
}

// How many of the cantrips the sheet holds are free. `racialChoiceCount` is
// the race's cantripChoice count (a homebrew race's too, which only the
// server's content lookup knows): a sheet written before the pick was
// recorded by name still gets its racial cantrip left out of the count.
export function freeCantripCount(sheet: FreeCantripSheet, racialChoiceCount: number): number {
  const held = new Set(cantripsHeld(sheet).map(lower));
  const pick = sheet.racialChoices?.cantrip ?? "";
  const namedPick = pick && held.has(lower(pick)) ? 1 : 0;
  const innate = innateCantripsFor(sheet.race, sheet.level).filter(
    (name) => held.has(lower(name)) && lower(name) !== lower(pick),
  ).length;
  return Math.max(racialChoiceCount, namedPick) + innate;
}
