// The features that move an action to the bonus action, and the monk's ki
// techniques. Before this, take_action always charged the action, so a
// rogue's Cunning Action Disengage after an attack was refused and a monk's
// Patient Defense burned a ki point for nothing: the engine said "already
// used their action" and the model narrated the feature anyway.
//
// SRD 5.1:
//   - Cunning Action (rogue 2): Dash, Disengage or Hide as a bonus action.
//   - Vanish (ranger 14): Hide as a bonus action.
//   - Nimble Escape (a goblin's trait, on a character of that lineage):
//     Disengage or Hide as a bonus action.
//   - Ki (monk 2), 1 point each: Flurry of Blows (right after the Attack
//     action, two unarmed strikes as a bonus action), Patient Defense (Dodge
//     as a bonus action), Step of the Wind (Disengage or Dash as a bonus
//     action).
//
// Called by take_action (src/lib/dm/action-tools.ts) and by use_resource
// on the ki counter (src/lib/dm/resource-tools.ts); both doors land in the
// same state.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import { classLevelFor } from "@/lib/srd/multiclass";
import { authoredFlurryStrikes } from "@/lib/srd/authored-economy";
import { spendAction } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import { DODGING } from "@/lib/dm/condition-logic";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { QUICKENED } from "@/lib/dm/cast-rules";
import { chosenOptions } from "@/lib/srd/options";

// The pure half (which feature routes what to the bonus action) lives in
// bonus-routes.ts, so the Hand can ask it too.
import { holdsFeature as holds, kiLeft } from "@/lib/dm/bonus-routes";
export { bonusRouteFor, kiLeft, noBonusRoute, type BonusRoute, type MoveAction } from "@/lib/dm/bonus-routes";

// The resources patch that spends `points` ki, or an error when the
// counter cannot cover it.
export function kiSpend(
  sheet: CharacterSheet,
  points: number,
  feature: string,
): { resources: FullPatchSheetInput["resources"] } | { error: string } {
  const ki = sheet.resources?.ki;
  const left = kiLeft(sheet);
  if (!ki || left === null) {
    return { error: `${sheet.name} has no ki points, so ${feature} is not theirs to use.` };
  }
  if (left < points) {
    return {
      error: `${sheet.name} has ${left}/${ki.max} ki points left; ${feature} costs ${points}. It is not available until a rest.`,
    };
  }
  return { resources: { ...sheet.resources, ki: { max: ki.max, used: ki.used + points } } };
}

// ---- the ki techniques, through use_resource ----

export type KiTechnique = "flurry" | "patient defense" | "step of the wind";

// Which technique a use_resource variant names, or null for a plain spend.
export function kiTechnique(variant: string | undefined): KiTechnique | null {
  const text = (variant ?? "").toLowerCase();
  if (/flurry/.test(text)) {
    return "flurry";
  }
  if (/patient|defen[cs]e|dodge/.test(text)) {
    return "patient defense";
  }
  if (/step|wind|dash|disengage/.test(text)) {
    return "step of the wind";
  }
  return null;
}

// A ki technique, checked and charged: the bonus action, the point of ki
// and the effect. The turn budget is stored here, since nothing after the
// return refuses; the caller patches the sheet with `patch`.
export function spendKiTechnique(
  campaign: Campaign,
  sheet: CharacterSheet,
  technique: KiTechnique,
  variant: string | undefined,
): { patch: FullPatchSheetInput; result: Record<string, unknown> } | { error: string } {
  const name =
    technique === "flurry" ? "Flurry of Blows" : technique === "patient defense" ? "Patient Defense" : "Step of the Wind";
  if (classLevelFor(sheet, "monk") < 2 && !holds(sheet, name.toLowerCase())) {
    return { error: `${name} is a monk's ki technique from 2nd level; ${sheet.name} does not have it.` };
  }
  const encounter = getActiveEncounter(campaign.id);
  const inFight = encounter !== null && (encounter.kind ?? "fight") === "fight";
  const allowed = canAct({ sheet, encounter, kind: "bonus" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }
  const budget = inFight
    ? budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionExtraActions(sheet.conditions))
    : null;
  if (technique === "flurry") {
    if (!budget || !encounter) {
      return { error: `Flurry of Blows is made in a fight, right after the Attack action on ${sheet.name}'s own turn.` };
    }
    if (budget.attacksMade < 1 || budget.castThisAction) {
      return {
        error: `Flurry of Blows comes immediately after the Attack action; ${sheet.name} has not taken the Attack action this turn. Attack first, then spend the ki.`,
      };
    }
  }
  const spent = kiSpend(sheet, 1, name);
  if ("error" in spent) {
    return spent;
  }
  let flags: { dashed?: boolean; disengaged?: boolean; flurryStrikes?: number } = {};
  const dash = technique === "step of the wind" && /dash/i.test(variant ?? "");
  if (technique === "flurry") {
    // Intoxicated Frenzy (Drunken Master 17) raises it to five.
    flags = { flurryStrikes: authoredFlurryStrikes(sheet) ?? 2 };
  } else if (technique === "step of the wind") {
    flags = dash ? { dashed: true } : { disengaged: true };
  }
  if (budget && encounter) {
    const price = spendAction(budget, "bonus", name, sheet.name);
    if (!price.ok) {
      return { error: price.error };
    }
    storeBudget(encounter, { ...price.budget, ...flags });
  }
  const patch: FullPatchSheetInput = { resources: spent.resources };
  let applied: string;
  if (technique === "patient defense") {
    if (!sheet.conditions.some((entry) => entry.toLowerCase() === DODGING)) {
      patch.conditions = [...sheet.conditions, DODGING];
      patch.conditionMeta = { ...sheet.conditionMeta, [DODGING]: { untilTurnOf: sheet.id } };
    }
    applied = `${sheet.name} takes the Dodge action as a bonus action: attacks against them roll at disadvantage until their next turn, and they have advantage on Dexterity saves. The server applies it.`;
  } else if (technique === "flurry") {
    applied = `${sheet.name} has ${flags.flurryStrikes === 2 ? "two" : flags.flurryStrikes} Flurry of Blows strikes this turn: resolve each with pc_attack using weapon "unarmed strike". The server spends them.`;
  } else {
    applied = dash
      ? `${sheet.name} Dashes as a bonus action: their movement is doubled this turn, and their jump distance too.`
      : `${sheet.name} Disengages as a bonus action: leaving an enemy's reach provokes nothing this turn, and their jump distance is doubled.`;
  }
  return {
    patch,
    result: {
      ok: true,
      technique: name,
      cost: budget ? "1 ki and their bonus action" : "1 ki",
      applied,
    },
  };
}

// Quickened Spell (sorcerer Metamagic, SRD 5.1): 2 sorcery points change a
// spell's casting time of one action to one bonus action for that casting.
// The points are spent here and the turn is marked; the next spell of one
// action this turn is charged to the bonus action (cast-rules.ts,
// turnCharge), with the bonus action spell rule that follows from it.
export function spendQuickenedSpell(
  campaign: Campaign,
  sheet: CharacterSheet,
  state: { max: number; used: number },
): { patch: FullPatchSheetInput; result: Record<string, unknown> } | { error: string } {
  const known = chosenOptions(sheet.features, "metamagic").some((name) => name.trim().toLowerCase() === "quickened spell");
  if (!known) {
    return { error: `${sheet.name} has not learned the Quickened Spell Metamagic option. Nothing was spent.` };
  }
  const encounter = getActiveEncounter(campaign.id);
  const inFight = encounter !== null && (encounter.kind ?? "fight") === "fight";
  const budget = inFight
    ? budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionExtraActions(sheet.conditions))
    : null;
  if (!budget || !encounter) {
    return {
      error: inFight
        ? `Quickened Spell is used as ${sheet.name} casts on their own turn, and it is not their turn. Nothing was spent.`
        : `Quickened Spell changes a casting time inside a fight's turn; out of a fight the spell is simply cast. Nothing was spent.`,
    };
  }
  if (budget.oncePerTurn.includes(QUICKENED)) {
    return { error: `${sheet.name} has already quickened a spell this turn that has not been cast yet. Nothing more was spent.` };
  }
  if (budget.bonusUsed) {
    return { error: `${sheet.name} has already used their bonus action this turn, so a quickened spell has no bonus action to take. Nothing was spent.` };
  }
  const left = state.max - state.used;
  if (left < 2) {
    return { error: `Quickened Spell costs 2 sorcery points and ${sheet.name} has ${left}. Nothing was spent.` };
  }
  storeBudget(encounter, { ...budget, oncePerTurn: [...budget.oncePerTurn, QUICKENED] });
  return {
    patch: { resources: { ...sheet.resources, sorcery_points: { max: state.max, used: state.used + 2 } } },
    result: {
      ok: true,
      resource: "Sorcery Points",
      spent: 2,
      left: `${left - 2}/${state.max}`,
      applied: `Quickened Spell: the next spell ${sheet.name} casts this turn with a casting time of one action takes their bonus action instead. Beside it, their only other spell this turn is a cantrip of one action.`,
    },
  };
}
