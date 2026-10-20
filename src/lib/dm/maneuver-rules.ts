// What each Battle Master maneuver costs of the turn and where it is taken
// (issue 233). Before this pc_attack accepted any known maneuver on a swing
// and charged only the Superiority Die, so a Parry or a Rally rode an attack
// and Feinting Attack cost no bonus action.
//
// The 2014 texts (PHB; TCoE for Ambush, Bait and Switch, Brace, Commanding
// Presence, Grappling Strike, Quick Toss and Tactical Assessment):
//
//   swing        rides a weapon attack, the die on the hit (Precision: on the
//                roll): Disarming, Distracting, Goading, Lunging, Menacing,
//                Precision, Pushing, Sweeping, Trip.
//   feint        "use a bonus action on your turn to feint, choosing one
//                creature within 5 feet": advantage on the next attack roll
//                against it this turn, the die on that attack's hit.
//   bonus_swing  Quick Toss: "As a bonus action, ... make a ranged attack with
//                a weapon that has the thrown property".
//   grapple      Grappling Strike: "Immediately after you hit a creature with
//                a melee attack on your turn, ... try to grapple the target as
//                a bonus action", the die added to the Athletics check.
//   ally_move    Maneuvering Attack: on the hit, a friendly creature "can use
//                its reaction to move up to half its speed".
//   reaction     Parry, Riposte, Brace: the fighter's reaction (use_reaction).
//   command      Commander's Strike: "forgo one of your attacks and use a
//                bonus action"; the ally attacks with its reaction.
//   rally        "On your turn, you can use a bonus action": temporary hit
//                points equal to the die + Charisma modifier.
//   check        a check, initiative or a move, not an attack: Ambush, Bait
//                and Switch, Commanding Presence, Evasive Footwork, Tactical
//                Assessment.
//
// No database: the attack plan, the reaction tool, the Hand and the tests
// read one table.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeat } from "@/lib/srd/feat-effects";
import { classLevelFor } from "@/lib/srd/multiclass";
import type { ToolError } from "@/lib/dm/tool-errors";
import { isNamed } from "@/lib/srd/feature-names";

export type ManeuverUse =
  | "swing"
  | "feint"
  | "bonus_swing"
  | "grapple"
  | "ally_move"
  | "reaction"
  | "command"
  | "rally"
  | "check";

const USES: Array<[string, ManeuverUse]> = [
  ["feinting attack", "feint"],
  ["quick toss", "bonus_swing"],
  ["grappling strike", "grapple"],
  ["maneuvering attack", "ally_move"],
  ["parry", "reaction"],
  ["riposte", "reaction"],
  ["brace", "reaction"],
  ["commander's strike", "command"],
  ["rally", "rally"],
  ["ambush", "check"],
  ["bait and switch", "check"],
  ["commanding presence", "check"],
  ["evasive footwork", "check"],
  ["tactical assessment", "check"],
];

// How the maneuver a whole name ("Parry", "Maneuver: Parry") refers to is
// taken. The rest are swings, as every maneuver that rides an attack is:
// whether the sheet knows the one named is pickManeuver's to check.
export function maneuverUse(name: string): ManeuverUse {
  return USES.find(([entry]) => isNamed(name, entry))?.[1] ?? "swing";
}

// The words a pc_attack call gets for a maneuver that is not part of a
// swing, or null when it is.
export function offSwingRefusal(name: string): ToolError | null {
  const shown = name.trim();
  switch (maneuverUse(name)) {
    case "reaction":
      return { error: `${shown} is a reaction, not part of a swing: use_reaction with feature "${shown}" when its trigger comes (Parry: a melee hit on them; Riposte: a melee miss on them; Brace: a creature moving into their reach). Nothing was spent.`, retry: true };
    case "command":
      return { error: `Commander's Strike forgoes one of the fighter's attacks and uses their bonus action: use_resource "Superiority Dice" with variant "commander's strike" and the ally's targetCharacterId; the ally then attacks with use_reaction. Nothing was spent.`, retry: true };
    case "rally":
      return { error: `Rally is a bonus action, not part of a swing: use_resource "Superiority Dice" with variant "rally" and the ally's targetCharacterId. Nothing was spent.`, retry: true };
    case "check":
      return { error: `${shown} rides a check, initiative or a move, not an attack roll: use_resource "Superiority Dice" with variant "${shown}" and add the die where its text says. Nothing was spent.`, retry: true };
    default:
      return null;
  }
}

// The turn-scoped marks the maneuvers leave between two calls.
// Grappling Strike's hit: the grapple may follow as a bonus action with the
// die named in the mark ("grappling strike (1d8)").
export const GRAPPLING_STRIKE = "grappling strike";
// Maneuvering Attack's hit: an ally may move with its reaction.
export const MANEUVERED = "maneuvering attack";
// Commander's Strike: the ally named attacks with its reaction.
export const COMMANDED = "commander's strike";
// The die a reaction attack adds on its hit ("superiority strike (1d8)"),
// spent by that hit (condition-effects.ts).
export const SUPERIORITY_STRIKE = "superiority strike";

// The die carried in a mark's name ("grappling strike (1d10)" -> "1d10").
export function markedDie(condition: string): string | null {
  return /\((\d+d\d+)\)/.exec(condition)?.[1] ?? null;
}

// Battle Master superiority die by fighter level.
export function superiorityDie(level: number): string {
  if (level >= 18) return "d12";
  if (level >= 10) return "d10";
  return "d8";
}

// The size of the character's Superiority Dice. Multiclass: it grows with
// FIGHTER levels. Martial Adept's die is a d6 without a Battle Master's own.
export function maneuverDieFor(sheet: CharacterSheet): string {
  const fighter = classLevelFor(sheet, "fighter");
  return fighter ? superiorityDie(fighter) : holdsFeat(sheet, "Martial Adept") ? "d6" : superiorityDie(sheet.level);
}
