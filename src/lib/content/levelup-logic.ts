// Level Up content in an SRD 5.1 game (issue #570, "Rules and content"; the
// decision is on the issue: a 5.1 campaign never gets Level Up's version of
// an SRD entry, and content that needs rules the engine does not have is not
// offered for play, though search can still show it, labeled with what it
// needs).
//
// Level Up Advanced 5e rewrites hundreds of SRD entries under the same name
// (its Goblin, its Fireball). Those twins never reach a 5.1 table: the SRD
// row answers the name. Its entries with no SRD twin come in, except those
// built on its own tracks and dice, which a 5.1 table has nowhere to keep:
// strife, fatigue, rattled, expertise dice, exertion and maneuvers. Those
// wait for the Level Up add-on the decision describes; until then the
// builder, the Hand, shops and the encounter roster do not offer them, and
// the reference, the rules desk and the workshop show them labeled.
//
// A "while bloodied" trigger and a ley line are labeled but still offered:
// the board already shows when a creature is bloodied, and a ley line is a
// rider the GM places on a spell that otherwise plays.

import { LEVEL_UP_DOCUMENTS, NEED_LABELS, type Need } from "@/lib/content/needs-logic";
import { textKey } from "@/lib/language/text-logic";

export { LEVEL_UP_DOCUMENTS };

// The SRD's own documents in the pack: Open5e's v1 SRD and its v2 2014 rows.
export const SRD_DOCUMENTS = new Set(["wotc-srd", "srd-2014"]);

// The Level Up rules a 5.1 table has no track or die for.
export const UNPLAYED_NEEDS: ReadonlySet<Need> = new Set<Need>(["strife", "fatigue", "rattled", "expertise dice", "exertion", "maneuvers"]);

// Whether a row is Level Up's version of an SRD entry: a Level Up document's
// row whose name an SRD row of the same table also prints.
export function isLevelUpTwin(row: { documentSlug: string; name: string }, srdNames: ReadonlySet<string>): boolean {
  return LEVEL_UP_DOCUMENTS.has(row.documentSlug) && srdNames.has(textKey(row.name));
}

// Whether an entry with these needs may be offered for play at a 5.1 table.
export function offeredInPlay(needs: readonly Need[]): boolean {
  return !needs.some((need) => UNPLAYED_NEEDS.has(need));
}

// The words a table reads beside such an entry: what it uses, whose rules
// they are, and what that means at this table.
export function needsLabel(needs: readonly Need[]): string | null {
  if (!needs.length) {
    return null;
  }
  return `Uses ${listOf(needs)}`;
}

// "strife", "strife and fatigue", "strife, fatigue and rattled".
function listOf(needs: readonly Need[]): string {
  const names = needs.map((need) => NEED_LABELS[need]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
}

export function needsNote(needs: readonly Need[]): string | null {
  if (!needs.length) {
    return null;
  }
  const unplayed = needs.filter((need) => UNPLAYED_NEEDS.has(need));
  const levelUp = needs.filter((need) => need !== "ley lines");
  const parts: string[] = [];
  if (levelUp.length) {
    parts.push(`Level Up Advanced 5e's ${listOf(levelUp)} ${levelUp.length > 1 ? "are rules" : "is a rule"} this game does not play.`);
  }
  if (needs.includes("ley lines")) {
    parts.push("Ley lines are from Deep Magic: the GM decides where they run.");
  }
  parts.push(
    unplayed.length
      ? "It is not offered for play here; the GM can still read it, or copy it into the workshop and change it."
      : "The GM plays that part.",
  );
  return parts.join(" ");
}
