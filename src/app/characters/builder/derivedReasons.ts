// The numbers the server derives for a new character (hit points, armor
// class, coin), each with the one line that says where it comes from. The
// builder shows them; it never lets them be typed, because the server works
// them out again from the same choices when the character is saved.
import { fixedDieValue, type HpMethod } from "@/lib/srd/hit-points";
import { describeWealthDice, startingWealthDice } from "@/lib/srd/starting-wealth";
import type { PurseView } from "./EquipmentSection";
import type { TableRulesState } from "./useTableRules";

export type DerivedLine = { value: string; reason: string };

export function hitPointsLine(input: {
  hitDie: number;
  level: number;
  maxHp: number;
  range: { min: number; max: number };
  method: HpMethod;
  // A stored character keeps the hit points it came home with.
  kept: boolean;
  // Built in the library, where no table has chosen a method yet.
  atTable: boolean;
}): DerivedLine {
  const { hitDie, level, maxHp, range, method } = input;
  if (input.kept) {
    return {
      value: String(maxHp),
      reason: "Kept from the stored character while its level and Constitution stand.",
    };
  }
  const first = `1st level is the d${hitDie}'s maximum plus Constitution`;
  if (level <= 1) {
    return { value: String(maxHp), reason: `${first}.` };
  }
  if (method === "rolled") {
    return {
      value: `${range.min} to ${range.max}`,
      reason: `${first}; the server rolls a d${hitDie} for each later level when you save (every level adds at least 1).`,
    };
  }
  const later =
    method === "max"
      ? `each later level the die's highest face, ${hitDie}`
      : `each later level the table's average, ${fixedDieValue(hitDie)}`;
  return {
    value: String(maxHp),
    reason: `${first}; ${later}, plus Constitution (at least 1).${input.atTable ? "" : " A table that rolls or maximises hit points works them its own way when this character joins."}`,
  };
}

export function armorClassLine(ac: number, parts: string[] | undefined): DerivedLine {
  return {
    value: String(ac),
    reason: parts?.length
      ? `From what is worn: ${parts.join(" + ")}.`
      : "10 plus Dexterity with nothing worn.",
  };
}

// The purse as the gear step and the review show it.
export function purseViewFor(input: {
  purse: { gold: number; copper: number; spentCopper: number; problems: string[]; method: string };
  keepsStoredGear: boolean;
  backgroundName: string;
  backgroundPurse: number;
  classId: string;
  className: string;
  table: TableRulesState;
}): PurseView {
  const { purse, table } = input;
  const spent = purse.spentCopper ? ` Bought: ${formatCopper(purse.spentCopper)}.` : "";
  const rolledTable = !input.keepsStoredGear && purse.method === "rolled";
  const dice = describeWealthDice(startingWealthDice(input.classId));
  const source = input.keepsStoredGear
    ? `The coin this character already carries; gear added now is paid from it.${spent}`
    : rolledTable
      ? table.wealth
        ? `This table rolls a ${input.className}'s starting wealth in place of the class kit, and every item is bought from it.${spent}`
        : `This table rolls a ${input.className}'s starting wealth (${dice}) in place of the class kit. Roll it, then buy your gear.`
      : `The ${input.backgroundName} background's purse of ${input.backgroundPurse} gp. The class and background kit is free; anything more is bought from the purse.${spent}`;
  return {
    gold: purse.gold,
    copper: purse.copper,
    source,
    problem: purse.problems[0] ?? null,
    wealth: rolledTable
      ? {
          dice,
          rolled: table.wealth ? { faces: table.wealth.faces, gold: table.wealth.gold } : null,
          busy: table.wealthBusy,
          error: table.wealthError,
          onRoll: table.rollWealth,
        }
      : null,
  };
}

function formatCopper(copper: number): string {
  const gold = Math.floor(copper / 100);
  const rest = copper % 100;
  return [gold ? `${gold} gp` : "", rest ? `${rest} cp` : ""].filter(Boolean).join(" ") || "0 gp";
}
