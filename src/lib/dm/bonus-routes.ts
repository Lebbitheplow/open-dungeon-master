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
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

export type MoveAction = "dodge" | "dash" | "disengage" | "hide";

// A way to take an action as the bonus action: the feature's name, what it
// costs in ki, and the limited-use counter it spends one use of, when it has
// one (src/lib/srd/class-resources.ts).
export type BonusRoute = { feature: string; ki: number; counter?: string };

// The genre classes' counted routes (src/lib/classes/resources.json): the
// grifter's Vanish, 3 a long rest, and the horror Adrenaline Surge.
const VANISH_COUNTER = "mystery_vanish";
const ADRENALINE_SURGE = "horror_adrenaline_surge";

export function holdsFeature(sheet: Pick<CharacterSheet, "features" | "feats">, name: string): boolean {
  const wanted = textKey(name);
  return [...sheet.features.map((feature) => feature.name), ...(sheet.feats ?? [])].some((entry) =>
    textKey(entry).includes(wanted),
  );
}

// Uses left on a counter the sheet holds, or null when it holds none.
export function usesLeft(sheet: Pick<CharacterSheet, "resources">, id: string): number | null {
  const counter = sheet.resources?.[id];
  return counter ? Math.max(0, counter.max - counter.used) : null;
}

// Ki points left on the sheet's counter, or null for a character with none.
export function kiLeft(sheet: Pick<CharacterSheet, "resources">): number | null {
  const ki = sheet.resources?.ki;
  return ki ? Math.max(0, ki.max - ki.used) : null;
}

// The feature that lets this character take `action` as a bonus action,
// free ones first, or null when nothing does.
// `context.allyDown`: an ally at the table lies at 0 hit points (Under Fire,
// the trauma doc's Combat Medevac: "when moving toward a downed ally").
export function bonusRouteFor(sheet: CharacterSheet, action: MoveAction, context: { allyDown?: boolean } = {}): BonusRoute | null {
  const rogue = classLevelFor(sheet, "rogue");
  const ranger = classLevelFor(sheet, "ranger");
  const monk = classLevelFor(sheet, "monk");
  if (action !== "dodge" && (rogue >= 2 || holdsFeature(sheet, "cunning action"))) {
    return { feature: "Cunning Action", ki: 0 };
  }
  if (action === "hide" && (ranger >= 14 || holdsFeature(sheet, "vanish"))) {
    return { feature: "Vanish", ki: 0, ...(ranger < 14 && usesLeft(sheet, VANISH_COUNTER) !== null ? { counter: VANISH_COUNTER } : {}) };
  }
  if ((action === "hide" || action === "disengage") && holdsFeature(sheet, "nimble escape")) {
    return { feature: "Nimble Escape", ki: 0 };
  }
  if (action !== "dodge" && holdsFeature(sheet, "adrenaline surge") && usesLeft(sheet, ADRENALINE_SURGE) !== null) {
    return { feature: "Adrenaline Surge", ki: 0, counter: ADRENALINE_SURGE };
  }
  if ((action === "dash" || action === "disengage") && context.allyDown && holdsFeature(sheet, "under fire")) {
    return { feature: "Under Fire", ki: 0 };
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
export function noBonusRoute(sheet: CharacterSheet, action: MoveAction): ToolError {
  const which =
    action === "dodge"
      ? "Patient Defense (a monk's ki)"
      : action === "hide"
        ? "Cunning Action, Vanish or Nimble Escape"
        : action === "dash"
          ? "Cunning Action, Step of the Wind or Expeditious Retreat"
          : "Cunning Action or Step of the Wind";
  return { error: `${sheet.name} has no feature that makes ${action === "dodge" ? "a Dodge" : `a ${action[0].toUpperCase()}${action.slice(1)}`} a bonus action (that takes ${which}). They can take it with their action instead.`, refused: "rules" };
}
