import type { Campaign } from "@/lib/db/campaigns";
import { departureNote, departureOpenings } from "@/lib/dm/departure";
import { fightingParty } from "@/lib/dm/party-budget";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The party splitting up (issue 563): move_party naming who goes, the rest
// staying behind. Nothing tracks two places at once; the party's place is
// where the story follows (the ones who went), and the split is a moment,
// not a state. It is one of the moments a companion holding a plan to slip
// away takes (src/lib/dm/departure.ts departureOpenings), beside its own turn
// in a fight and the night watch.
//
// Returns what the DM is told, "" when the call moved the whole party.

function names(sheets: readonly CharacterSheet[]): string {
  const list = sheets.map((sheet) => sheet.name);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : (list[0] ?? "");
}

export function partySplit(campaign: Campaign, refs: unknown, place: string): string {
  if (!Array.isArray(refs) || !refs.length) {
    return "";
  }
  const wanted = refs.filter((ref): ref is string => typeof ref === "string").map((ref) => ref.trim());
  // Who travels with the party: its fielded, living characters and the
  // companions with them (party-budget.ts). A summoned creature goes with
  // whoever called it.
  const party = fightingParty(campaign).filter((sheet) => !sheet.summon);
  const going = party.filter((sheet) => wanted.some((ref) => ref === sheet.id || textKey(ref) === textKey(sheet.name)));
  const staying = party.filter((sheet) => !going.includes(sheet));
  if (!going.length || !staying.length) {
    return "";
  }
  const slipped = departureOpenings(campaign, "split").map(departureNote).filter(Boolean);
  return [
    `The party has split up: ${names(going)} went to ${place}, and ${names(staying)} stayed behind. The scene follows those who went; move_party again when it turns to the others or the party comes back together.`,
    ...slipped,
  ].join(" ");
}
