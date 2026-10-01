// The take_action branches with checks of their own: Hide (a Stealth check
// against the watchers' passive Perception), Help (an ally's check, or an
// attack against a creature beside the helper) and the Grapple and Shove
// contests. Split from action-tools.ts, which prices the action and calls
// these with the `spend` that pays for it once nothing refuses.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { sizeForRace } from "@/lib/srd";
import { sizeRank, watchfulPassivePerception } from "@/lib/bestiary/statblock";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { addSheetCondition, rollEnemyContest } from "@/lib/dm/action-common";
import { handsBusy } from "@/lib/dm/cast-rules";
import { tilesBetween, wallBetween } from "@/lib/dm/attack-spatial";
import { seenClearlyDespiteTraits } from "@/lib/dm/hide-traits";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { resolveEnemyRef, publishEncounter } from "@/lib/dm/enemy-damage";
import { HELP_FOR_A_CHECK, HELPED } from "@/lib/dm/help-logic";
import { pushTokenAway } from "@/lib/dm/map-tools";
import { resolveSheetRef } from "@/lib/dm/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Successfully hidden: attacks from here have advantage, and the first one
// spends it (src/lib/dm/condition-logic.ts).
export const HIDDEN = "hidden";

// What take_action passes down: the arguments these branches read.
export type ActionArgs = {
  action: string;
  targetEnemyId?: string;
  targetCharacterId?: string;
  shove?: "prone" | "push";
};

export type Spend = (flags?: Partial<Pick<TurnBudget, "dashed" | "disengaged">>) => void;

export function hide(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  encounter: ReturnType<typeof getActiveEncounter>,
  spend: Spend,
  costs: Record<string, unknown>,
): Record<string, unknown> {
  // Out of a fight there is no one's passive Perception to compare with and
  // no turn to spend; the Stealth check and whoever is watching are the
  // table's (request_roll, check_notice).
  if (!encounter) {
    return {
      error: `There is no fight, so ${sheet.name} hides with a Stealth check against whoever is watching: call request_roll kind=skill_check skill=stealth, and check_notice for the watchers. Nothing was spent.`,
    };
  }
  // Nobody hides from a creature that sees them clearly. On a mapped
  // fight that is read from the board: a sight line with no cover and
  // no darkness between is a clear view.
  // Naturally Stealthy and Mask of the Wild answer some watchers (hide-traits.ts).
  const watcher = seenClearlyDespiteTraits(campaign, encounter.id, sheet);
  if (watcher) {
    return {
      error: `${sheet.name} cannot hide: ${watcher} sees them clearly. They move out of its sight, behind cover or into darkness first, then hide.`,
    };
  }
  spend();
  // A Stealth check like any other (src/lib/dm/contest-roll.ts): noisy
  // armor, Reliable Talent, a held inspiration die, Guidance.
  const stealth = rollCharacterCheck(campaign, sheet, { skill: "stealth" }, `${sheet.name}: Stealth to hide`);
  if (stealth.rollId) {
    turn.rollIds.push(stealth.rollId);
  }
  // Compared against the sharpest living enemy's real passive Perception
  // rather than left to judgement.
  const watchers = listEnemies(encounter.id).filter((enemy) => enemy.status === "alive");
  const sharpest = watchers.reduce(
    // A Keen sense adds its advantage: +5 (statblock.ts watchfulPassivePerception).
    (best, enemy) => Math.max(best, watchfulPassivePerception(enemy.stats)),
    0,
  );
  const hidden = !stealth.autoFailed && stealth.total >= sharpest;
  if (hidden) {
    addSheetCondition(campaign, getSheetById(sheet.id) ?? sheet, HIDDEN, { rounds: 10 });
  }
  return {
    ok: true,
    action: "Hide",
    ...costs,
    stealth: stealth.total,
    ...(watchers.length ? { vsPassivePerception: sharpest } : {}),
    hidden,
    ...(stealth.notes.length ? { notes: stealth.notes } : {}),
    note: hidden
      ? `${sheet.name} is hidden. Their next attack has advantage and reveals them; the server applies both.`
      : `${sheet.name} stays in plain sight: ${stealth.total} does not beat a passive Perception of ${sharpest}.`,
  };
}

export function help(
  campaign: Campaign,
  sheet: CharacterSheet,
  encounter: ReturnType<typeof getActiveEncounter>,
  args: ActionArgs,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  spend: Spend,
): Record<string, unknown> {
  const target = args.targetCharacterId
    ? resolveSheetRef(args.targetCharacterId, sheets, sheetsById)
    : null;
  if (!target || target.id === sheet.id) {
    return {
      error: "Help goes to another character: pass their targetCharacterId.",
    };
  }
  // Help on an attack is against one creature within 5 feet of the helper
  // (SRD 5.1); the ally's first attack against it has advantage.
  const foe = args.targetEnemyId && encounter ? resolveEnemyRef(encounter.id, args.targetEnemyId) : null;
  if (args.targetEnemyId && (!foe || foe.status !== "alive")) {
    return { error: "Help on an attack needs a living targetEnemyId from GAME STATE." };
  }
  if (foe && encounter) {
    const apart = tilesBetween(encounter.id, sheet.id, foe.id);
    if (apart !== null && (apart > 1 || wallBetween(encounter.id, sheet.id, foe.id))) {
      return {
        error: `${sheet.name} is ${apart * 5} ft from ${foe.displayName}; Help on an attack is against a creature within 5 ft of the helper. They move next to it first, or help an ability check instead.`,
      };
    }
  }
  spend();
  const fresh = getSheetById(target.id) ?? target;
  addSheetCondition(campaign, fresh, HELPED, { untilTurnOf: sheet.id }, foe ? foe.id : HELP_FOR_A_CHECK);
  return {
    ok: true,
    action: "Help",
    applied: foe
      ? `${fresh.name} has advantage on their next attack against ${foe.displayName} before ${sheet.name}'s next turn; the server spends it on that roll.`
      : `${fresh.name} has advantage on their next ability check before ${sheet.name}'s next turn; the server spends it on that roll.`,
  };
}

export function contest(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  encounter: ReturnType<typeof getActiveEncounter>,
  args: ActionArgs,
  spend: Spend,
  costs: Record<string, unknown>,
): Record<string, unknown> {
  const action = args.action as "grapple" | "shove";
  if (!encounter) {
    return { error: `${action} needs an active encounter and a target.` };
  }
  const enemy = args.targetEnemyId ? resolveEnemyRef(encounter.id, args.targetEnemyId) : null;
  if (!enemy || enemy.status !== "alive") {
    return { error: `${action} needs a living targetEnemyId from GAME STATE.` };
  }
  // SRD: the target can be at most one size larger than the attacker.
  if (sizeRank(enemy.stats.size) > sizeRank(sizeForRace(sheet.race)) + 1) {
    return {
      error: `${enemy.displayName} is ${enemy.stats.size}: too large for ${sheet.name} (${sizeForRace(sheet.race)}) to ${action}. A creature can only ${action} a target at most one size larger than itself.`,
    };
  }
  // SRD 5.1, Grappling: "Using at least one free hand" (cast-rules.ts handsBusy).
  if (action === "grapple" && handsBusy(sheet) >= 2) {
    return {
      error: `${sheet.name} has no free hand: a weapon and a shield (or two weapons) fill both. A grapple takes at least one free hand; unequip one on the sheet first. Nothing was spent.`,
    };
  }
  // Hands on the target: it has to be within reach, with no wall between.
  const apart = tilesBetween(encounter.id, sheet.id, enemy.id);
  if (apart !== null && (apart > 1 || wallBetween(encounter.id, sheet.id, enemy.id))) {
    return {
      error: `${sheet.name} is ${apart * 5} ft from ${enemy.displayName}; a ${action} needs the target within 5 ft. They move their token next to it first.`,
    };
  }
  spend();
  // SRD contest: the attacker's Athletics, a check like any other
  // (src/lib/dm/contest-roll.ts), against the target's better of Athletics
  // (STR) and Acrobatics (DEX).
  const mine = rollCharacterCheck(campaign, sheet, { skill: "athletics" }, `${sheet.name}: Athletics to ${action} ${enemy.displayName}`);
  if (mine.rollId) {
    turn.rollIds.push(mine.rollId);
  }
  const theirs = rollEnemyContest(campaign, turn, enemy, "either", `${enemy.displayName}: contest against the ${action}`);
  const contested = `${mine.total} vs ${theirs}`;

  // Ties go to the defender, per the SRD contest rule.
  const won = !mine.autoFailed && mine.total > theirs;
  if (!won) {
    return {
      ok: true,
      action,
      ...costs,
      contest: contested,
      success: false,
      note: `${enemy.displayName} resists; narrate the failed ${action}.`,
    };
  }
  const condition = action === "grapple" ? "grappled" : "prone";
  if (action === "shove" && args.shove === "push") {
    // Five feet straight away from the shover, when the square is free.
    const pushed = pushTokenAway(campaign, encounter.id, sheet.id, enemy.id);
    return {
      ok: true,
      action,
      ...costs,
      contest: contested,
      success: true,
      applied: pushed.moved
        ? `${enemy.displayName} is shoved 5 feet back to (${pushed.at.x},${pushed.at.y}). The server moved its token; the push provokes nothing.`
        : `${enemy.displayName} is shoved but has nowhere to go: ${pushed.reason}. It stays where it is.`,
    };
  }
  if (enemy.stats.conditionImmune.toLowerCase().includes(condition)) {
    return {
      ok: true,
      action,
      ...costs,
      contest: contested,
      success: false,
      note: `${enemy.displayName} cannot be ${condition}; it is immune. Narrate the attempt failing against its nature.`,
    };
  }
  patchEnemyConditions(
    enemy.id,
    [...enemy.conditions, condition],
    {
      ...enemy.conditionMeta,
      // Who holds the grapple, so it can end when they are incapacitated
      // or move away (src/lib/dm/set-condition.ts releaseGrapplesHeldBy,
      // src/lib/dm/grapple.ts), and so the grappled creature can escape.
      [condition]: condition === "grappled" ? { source: sheet.id } : {},
    },
  );
  publishEncounter(campaign.id);
  return {
    ok: true,
    action,
    ...costs,
    contest: contested,
    success: true,
    applied: `${enemy.displayName} is ${condition}. The server applied the condition and its mechanics.${
      condition === "grappled" ? " It can try to escape with its action (take_action escape with its enemyId)." : ""
    }`,
  };
}
