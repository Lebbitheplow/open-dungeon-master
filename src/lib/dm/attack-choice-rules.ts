// Who may declare Open Hand Technique and Hurl Through Hell on an attack, and
// the words the engine writes for them. Pure: the sheet in, a verdict out, so
// the player's Hand asks the same question pc_attack does before offering the
// option (src/lib/battlemap/hand-class.ts). The effects themselves are
// resolved on the hit by src/lib/dm/attack-onhit.ts, which re-exports these.

import { classLevelOf, holdsFeature } from "@/lib/srd/trait-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// ---- Open Hand Technique ----

export const OPEN_HAND_CHOICES = ["prone", "push", "no reactions"] as const;
export type OpenHandChoice = (typeof OPEN_HAND_CHOICES)[number];
// The reactions Open Hand Technique takes away (a condition-effects row
// with noReactions).
export const OPEN_HAND_REELING = "no reactions (open hand)";

// The refusal for an Open Hand rider on an attack that is not one of Flurry
// of Blows' strikes.
export const OPEN_HAND_NOT_FLURRY =
  'Open Hand Technique rides a hit of Flurry of Blows, and this attack is not one of its strikes. Spend the ki with use_resource Ki variant "flurry of blows" after the Attack action, then make the unarmed strikes with openHand.';

export function hasOpenHandTechnique(sheet: CharacterSheet): boolean {
  return (
    holdsFeature(sheet, "open hand technique") ||
    (classLevelOf(sheet, "monk") >= 3 && /open hand/i.test(sheet.subclass ?? ""))
  );
}

// ---- Hurl Through Hell ----

export const HURLED = "hurled through hell";
export const HURL_THROUGH_HELL = "hurl_through_hell";

export function hurlProblem(sheet: CharacterSheet, asked: boolean | undefined): string | null {
  if (!asked) {
    return null;
  }
  if (!holdsFeature(sheet, "hurl through hell") && !(classLevelOf(sheet, "warlock") >= 14 && /fiend/i.test(sheet.subclass ?? ""))) {
    return `${sheet.name} does not have Hurl Through Hell (The Fiend's 14th level feature); attack without hurlThroughHell.`;
  }
  const state = sheet.resources?.[HURL_THROUGH_HELL];
  if (!state || state.max - state.used <= 0) {
    return `${sheet.name} has used Hurl Through Hell; it comes back on a long rest. Attack without hurlThroughHell.`;
  }
  return null;
}
