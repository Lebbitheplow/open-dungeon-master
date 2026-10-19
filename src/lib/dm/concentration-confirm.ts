import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { MessageIntent } from "@/lib/dm/intent-logic";
import { findSpellByName } from "@/lib/content";
import { bundledSpellFacts } from "@/lib/srd/spell-facts";
import { spellNames } from "@/lib/battlemap/hand-spells";
import { spellsNamedIn, type ConcentrationSwap } from "@/lib/dm/concentration-confirm-logic";
import { textKey } from "@/lib/language/text-logic";

// The cast an action would make that ends the character's running
// concentration spell, or null (issue 252). Read before anything is posted
// (src/app/api/campaigns/[campaignId]/actions/route.ts): a card names its
// spell; a typed action is read for the character's own spells by name.
// Recasting the spell already held is not a swap (the cast guard keeps it
// running). A typed action that already says the running spell goes is
// asked too: what it says is in the table's language, and the question is
// one click, the same at every table.
export function concentrationSwapFor(
  sheet: Pick<CharacterSheet, "id" | "concentratingOn" | "spellcasting">,
  action: { intent: MessageIntent | null; content: string; kind: string },
  authors: string[],
): ConcentrationSwap | null {
  const current = (sheet.concentratingOn ?? "").trim();
  if (!current || action.kind !== "do") {
    return null;
  }
  // The pack's row (or a homebrew spell's), else the bundled SRD facts, as
  // the spell book's marks read it: a server without the content pack still
  // knows Spirit Guardians needs concentration.
  const concentrates = (name: string) => {
    const row = findSpellByName(name, authors);
    return row ? row.concentration === true : bundledSpellFacts(name)?.concentration === true;
  };
  const same = (name: string) => textKey(name) === textKey(current);
  if (action.intent) {
    const spell = action.intent.card === "spell" ? (action.intent.spell ?? "").trim() : "";
    return spell && !same(spell) && concentrates(spell) ? { characterId: sheet.id, current, next: spell } : null;
  }
  const named = spellsNamedIn(action.content, spellNames(sheet as CharacterSheet)).filter((name) => !same(name));
  const next = named.find(concentrates);
  return next ? { characterId: sheet.id, current, next } : null;
}
