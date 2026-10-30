// Whether a feat a character holds still works for them right now. SRD 5.1
// Feats: "If you ever lose a feat's prerequisite, you can't use that feat
// until you regain the prerequisite. For example, the Grappler feat requires
// you to have a Strength of 13 or higher. If your Strength is reduced below
// 13 somehow ... you can't benefit from the Grappler feat until your Strength
// is restored." A rider the engine runs for a feat asks here first, with the
// scores the character has now (a drain lowers them, a belt or potion raises
// them). Pure.
import type { Ability, CharacterSheet } from "@/lib/schemas/sheet";
import { checkPrerequisite } from "@/lib/srd/legality/features";
import { textKey } from "@/lib/language/text-logic";

// The SRD's prerequisite for each feat the engine runs a rider for, so the
// rule holds on a table without the content pack. Grappler is the SRD's one
// feat.
const SRD_FEAT_PREREQUISITES: Record<string, string> = {
  grappler: "Strength 13 or higher",
};

// Whether the sheet lists the feat, by its whole name.
export function holdsFeat(sheet: Pick<CharacterSheet, "feats">, feat: string): boolean {
  const key = textKey(feat);
  return (sheet.feats ?? []).some((held) => textKey(held) === key);
}

// True when the sheet holds the feat and its prerequisite holds at these
// scores. What play cannot take away (a race, the ability to cast) is not
// asked again here; the feat was checked for it when it was taken.
export function featUsable(
  sheet: Pick<CharacterSheet, "feats" | "race" | "proficiencies">,
  feat: string,
  scores: Record<Ability, number>,
): boolean {
  if (!holdsFeat(sheet, feat)) {
    return false;
  }
  const prerequisite = SRD_FEAT_PREREQUISITES[textKey(feat)];
  if (!prerequisite) {
    return true;
  }
  const check = checkPrerequisite(prerequisite, {
    abilities: scores,
    armor: sheet.proficiencies?.armor ?? [],
    casts: true,
    raceId: sheet.race,
    raceName: sheet.race,
  });
  return check.state !== "unmet";
}
