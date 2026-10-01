// The board's token menu (TokenHud.tsx) asks the same questions the Hand's
// cards ask before it composes a sentence: may this character act at all
// (canAct), is the action or the Attack action still there (spendAction,
// spendAttack), can they cast in this state (casterStateProblem), and do they
// hold a spell. A refused sigil carries the engine's sentence instead of
// filling the box with an action the engine will refuse.
//
// Pure; scripts/test-hand-engine.mjs drives it.
import { casterStateProblem } from "@/lib/dm/cast-rules";
import { effectiveSpeed } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { attackGate, costGate, standingGate, type Gate, type HandTurn } from "@/lib/battlemap/hand-core";
import { spellNames } from "@/lib/battlemap/hand-spells";
import { attacksAllowed } from "@/lib/battlemap/hand";
import { turnFromEncounter, type FloorView } from "@/lib/battlemap/hand-table";

export type HudGateId = "attack" | "cast" | "dodge" | "dash" | "disengage" | "help";

const first = (...gates: Gate[]): string | null => gates.find((gate) => gate !== null)?.reason ?? null;

export function hudGates(sheet: CharacterSheet, turn: HandTurn): Record<HudGateId, string | null> {
  const action = (name: string) => first(standingGate(sheet, turn, "action"), costGate("action", turn, sheet, name));
  const casting = casterStateProblem(sheet);
  return {
    attack: first(standingGate(sheet, turn, "attack"), attackGate(turn, attacksAllowed(sheet), sheet)),
    cast: spellNames(sheet).length
      ? first(standingGate(sheet, turn, "cast"), casting ? { reason: casting, spent: false } : null)
      : `${sheet.name} has no spells to cast.`,
    dodge: action("Dodge"),
    dash:
      action("Dash") ??
      (effectiveSpeed(sheet.conditions, sheet.speed) === 0 ? "Your speed is 0, so a Dash goes nowhere." : null),
    disengage: action("Disengage"),
    help: action("Help"),
  };
}

// The gates for the board's own player, read from the encounter the way the
// Hand reads it (hand-table.ts turnFromEncounter).
export function boardHudGates(
  sheet: CharacterSheet,
  encounter: Parameters<typeof turnFromEncounter>[0],
  floor: FloorView,
): Record<HudGateId, string | null> {
  return hudGates(sheet, turnFromEncounter(encounter, sheet, floor));
}
