import type { CharacterSheet } from "@/lib/schemas/sheet";

export function ownedCharacters(sheets: CharacterSheet[], userId: string): CharacterSheet[] {
  return sheets.filter((sheet) => sheet.userId === userId && !sheet.isCompanion);
}

export function selectedCharacter(sheets: CharacterSheet[], userId: string, selectedId = ""): CharacterSheet | null {
  const own = ownedCharacters(sheets, userId);
  return own.find((sheet) => sheet.id === selectedId) ?? own[0] ?? null;
}

// Viewing another sheet does not hand that character the initiative turn.
export function initiativeCharacter(sheets: CharacterSheet[], userId: string, characterId?: string | null): CharacterSheet | null {
  return ownedCharacters(sheets, userId).find((sheet) => sheet.id === characterId) ?? null;
}

export function resolveActionCharacter({ sheets, userId, selectedId, characterId, initiativeId, reaction = false, multiCharacter = "off" }: {
  sheets: CharacterSheet[];
  userId: string;
  selectedId?: string;
  characterId?: string;
  initiativeId?: string | null;
  reaction?: boolean;
  multiCharacter?: "off" | "one_active" | "all_active";
}): { sheet: CharacterSheet } | { error: string; status: number } {
  const selected = selectedCharacter(sheets, userId, selectedId);
  const expected = initiativeCharacter(sheets, userId, initiativeId);
  const sheet = characterId ? initiativeCharacter(sheets, userId, characterId) : (!reaction && expected) || selected;
  if (!sheet) return { error: "That is not one of your characters.", status: 404 };
  if (multiCharacter !== "all_active" && sheet.id !== selected?.id) {
    return { error: "Select that character before acting as them.", status: 409 };
  }
  if (!reaction && initiativeId && sheet.id !== initiativeId) {
    return { error: "Wait for that character's turn in the initiative order. Use OOC for table talk.", status: 409 };
  }
  return { sheet };
}
