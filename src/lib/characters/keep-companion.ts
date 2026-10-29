import {
  createCharacter,
  getCharacter,
  keepsLibraryLevel,
  syncProgressToLibrary,
  type LibraryCharacter,
} from "@/lib/db/characters";
import { linkSheetToLibrary } from "@/lib/db/sheets";
import { createSheetSchema, type CharacterSheet } from "@/lib/schemas/sheet";

// "Save to my characters" on a companion's card. A companion built by hand is
// kept in its builder's library from the start (companions/create); one the
// GM wrote in lived only in its campaign, so a player who wanted them in the
// next one had to build them again ("Duplicate" copies the world and no
// sheets). Saving files the sheet as an ally the GM plays, ready for "Bring
// to a campaign", and ties the sheet to it so a later save, or the campaign's
// end, writes their progress back.
//
//   - kept:   no entry yet; one is made in the keeper's library and linked.
//   - saved:  the keeper's own entry; its progress is written back to it.
//   - copied: someone else keeps the linked entry; this keeper gets a copy
//             of their own, and the sheet stays tied to the first.
export type KeptCompanion = {
  character: LibraryCharacter;
  how: "kept" | "saved" | "copied";
  // The library's level, when a lower table left it alone (issue #36).
  keptLevel: number | null;
  sheet: CharacterSheet;
};

export type KeepRefusal = { error: string; status: number };

export function keepCompanion(sheet: CharacterSheet, userId: string): KeptCompanion | KeepRefusal {
  if (!sheet.isCompanion || sheet.companionKind !== "party" || sheet.summon) {
    return {
      error: `${sheet.name} is not a lasting companion. Only a party companion can be kept in your characters.`,
      status: 400,
    };
  }
  const linked = sheet.libraryCharacterId ? getCharacter(sheet.libraryCharacterId) : null;
  if (linked && linked.userId === userId) {
    const saved = syncProgressToLibrary(sheet.id);
    if (!saved) {
      return { error: `Could not save ${sheet.name} to your characters.`, status: 500 };
    }
    return {
      character: saved,
      how: "saved",
      keptLevel: keepsLibraryLevel(sheet.level, linked.level) ? linked.level : null,
      sheet,
    };
  }
  const parsed = createSheetSchema.safeParse(sheet);
  if (!parsed.success) {
    return { error: `${sheet.name}'s sheet could not be filed in your characters.`, status: 500 };
  }
  // The voice the GM plays them from rides as the backstory, which is what a
  // library companion brought to a table is played from.
  const input = { ...parsed.data, backstory: parsed.data.backstory || sheet.personality.slice(0, 2_000) };
  const character = createCharacter(userId, sheet.level, input, "companion", "", sheet.xp);
  if (linked) {
    return { character, how: "copied", keptLevel: null, sheet };
  }
  return { character, how: "kept", keptLevel: null, sheet: linkSheetToLibrary(sheet.id, character.id) ?? sheet };
}
