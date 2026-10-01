// Which features move an action to the bonus action (SRD 5.1: Cunning
// Action, Vanish, Nimble Escape, and a monk's Step of the Wind and Patient
// Defense for 1 ki), as pure functions of the sheet.
//
// Split out of src/lib/dm/bonus-actions.ts (which re-exports all of it and
// keeps the spending) so the Hand can ask the same question take_action asks
// without importing a module that reaches the database.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { classLevelFor } from "@/lib/srd/multiclass";
import { authoredBonusRoute } from "@/lib/srd/authored-economy";

export type MoveAction = "dodge" | "dash" | "disengage" | "hide";

// A way to take an action as the bonus action: the feature's name and what
// it costs in ki.
export type BonusRoute = { feature: string; ki: number };

export function holdsFeature(sheet: Pick<CharacterSheet, "features" | "feats">, name: string): boolean {
  const wanted = name.toLowerCase();
  return [...sheet.features.map((feature) => feature.name), ...(sheet.feats ?? [])].some((entry) =>
    entry.toLowerCase().includes(wanted),
  );
}

// Ki points left on the sheet's counter, or null for a character with none.
export function kiLeft(sheet: Pick<CharacterSheet, "resources">): number | null {
  const ki = sheet.resources?.ki;
  return ki ? Math.max(0, ki.max - ki.used) : null;
}

// The feature that lets this character take `action` as a bonus action,
// free ones first, or null when nothing does.
export function bonusRouteFor(sheet: CharacterSheet, action: MoveAction): BonusRoute | null {
  const rogue = classLevelFor(sheet, "rogue");
  const ranger = classLevelFor(sheet, "ranger");
  const monk = classLevelFor(sheet, "monk");
  if (action !== "dodge" && (rogue >= 2 || holdsFeature(sheet, "cunning action"))) {
    return { feature: "Cunning Action", ki: 0 };
  }
  if (action === "hide" && (ranger >= 14 || holdsFeature(sheet, "vanish"))) {
    return { feature: "Vanish", ki: 0 };
  }
  if ((action === "hide" || action === "disengage") && holdsFeature(sheet, "nimble escape")) {
    return { feature: "Nimble Escape", ki: 0 };
  }
  // Expeditious Retreat (the spell): the Dash as a bonus action while it lasts.
  if (action === "dash" && sheet.conditions.some((entry) => entry.trim().toLowerCase() === EXPEDITIOUS_RETREAT)) {
    return { feature: "Expeditious Retreat", ki: 0 };
  }
  const monkish = monk >= 2 || kiLeft(sheet) !== null;
  if (monkish && (action === "dash" || action === "disengage")) {
    return { feature: "Step of the Wind", ki: 1 };
  }
  if (monkish && action === "dodge") {
    return { feature: "Patient Defense", ki: 1 };
  }
  // The authored subclass routes (a raging eagle totem's Dash):
  // src/lib/srd/authored-effects.ts.
  return authoredBonusRoute(sheet, action);
}

export const EXPEDITIOUS_RETREAT = "expeditious retreat";

// Fast Hands (Thief 3): Cunning Action's bonus action also Uses an Object.
export function hasFastHands(sheet: CharacterSheet): boolean {
  return holdsFeature(sheet, "fast hands") || (classLevelFor(sheet, "rogue") >= 3 && /thief/i.test(sheet.subclass ?? ""));
}

// Thief's Reflexes (Thief 17): two turns in the first round of a fight.
export function holdsThiefsReflexes(sheet: CharacterSheet): boolean {
  return holdsFeature(sheet, "thief's reflexes") || (classLevelFor(sheet, "rogue") >= 17 && /thief/i.test(sheet.subclass ?? ""));
}

// The sentence a refused bonus-action move carries.
export function noBonusRoute(sheet: CharacterSheet, action: MoveAction): string {
  const which =
    action === "dodge"
      ? "Patient Defense (a monk's ki)"
      : action === "hide"
        ? "Cunning Action, Vanish or Nimble Escape"
        : action === "dash"
          ? "Cunning Action, Step of the Wind or Expeditious Retreat"
          : "Cunning Action or Step of the Wind";
  return `${sheet.name} has no feature that makes ${action === "dodge" ? "a Dodge" : `a ${action[0].toUpperCase()}${action.slice(1)}`} a bonus action (that takes ${which}). They can take it with their action instead.`;
}
