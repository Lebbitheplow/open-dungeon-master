import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import {
  getActiveEncounter,
  listEnemies,
  patchEnemyConditions,
  saveEncounter,
  type Encounter,
} from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import type { DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { combatRiders } from "@/lib/srd/feature-effects";
import { passivePerceptionFor, saveModFor } from "@/lib/bestiary/statblock";
import {
  budgetApplies,
  freshBudget,
  spendAction,
  type ActionKind,
  type TurnBudget,
} from "@/lib/dm/action-budget";

import { resolveEnemyRef, publishEncounter } from "@/lib/dm/enemy-damage";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { DODGING } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The rest of a 5e turn: the actions that are not attacks or spells, plus
// reactions. Dodge, Dash, Disengage, Hide, Help, Grapple, and Shove all had
// no representation at all before this, so the model narrated them freely
// with no mechanical consequence; grapples in particular were pure fiction.
//
// Each one lands as real state: Dodge writes a condition the attack engine
// reads, Grapple and Shove run the SRD contested check through the real dice
// engine, Dash flags the doubled movement the battle map honors.
//
// This module must not be imported by encounter-tools (the import points the
// other way); it imports the enemy helpers and the sheet layer only.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const ACTION_TOOL_NAMES = ["take_action", "use_reaction"] as const;

// A held Help die works like a held Bardic Inspiration die: a condition on
// the recipient the next d20 roll consumes.
export const HELPED = "helped";
// Successfully hidden: attacks from here have advantage, and the first one
// spends it (src/lib/dm/condition-logic.ts).
export const HIDDEN = "hidden";

export const actionTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "take_action",
      description:
        "A character takes one of the standard 5e actions that is not an attack or a spell: Dodge, Dash, Disengage, Hide, Help, Grapple, or Shove. The server spends the action from their turn, rolls any contest the action calls for, and applies the real effect (Dodge makes attacks against them roll at disadvantage, a won Grapple applies grappled, a won Shove knocks prone or pushes). Call this BEFORE narrating the action; narrate exactly what it reports.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          action: {
            type: "string",
            enum: ["dodge", "dash", "disengage", "hide", "help", "grapple", "shove"],
          },
          targetEnemyId: {
            type: "string",
            description: "Grapple and Shove: the exact enemyId being seized or pushed.",
          },
          targetCharacterId: {
            type: "string",
            description: "Help: the exact characterId of the ally being helped.",
          },
          shove: {
            type: "string",
            enum: ["prone", "push"],
            description: "Shove only: knock the target prone (default) or push it 5 feet back.",
          },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "use_reaction",
      description:
        "A character spends their reaction on a feature that interrupts someone else's turn: Shield (+5 AC), Uncanny Dodge (halve the damage of one hit), Deflect Missiles, Cutting Words, or a Protection style shield block. The server checks they still have their reaction and applies the effect. One reaction per round, refreshed at the start of their turn.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          feature: {
            type: "string",
            description: "What they react with, e.g. 'Shield', 'Uncanny Dodge', 'Cutting Words'.",
          },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "feature"],
      },
    },
  },
];

const takeActionSchema = z.object({
  characterId: z.string(),
  action: z.enum(["dodge", "dash", "disengage", "hide", "help", "grapple", "shove"]),
  targetEnemyId: z.string().optional(),
  targetCharacterId: z.string().optional(),
  shove: z.enum(["prone", "push"]).optional(),
  reason: z.string().optional(),
});

const useReactionSchema = z.object({
  characterId: z.string(),
  feature: z.string().max(80),
  reason: z.string().optional(),
});

// ---- budget plumbing ----

// The combatant the initiative pointer is currently on, or null out of
// combat. Budgets only bind the character whose turn it actually is: a
// character acting off-turn (a reaction, a lead correction, anything out of
// initiative) is never refused for a spent action it does not owe.
export function currentCombatantId(encounter: Encounter | null): string | null {
  if (!encounter || !encounter.orderReady) {
    return null;
  }
  const entry = encounter.order[encounter.turnIndex];
  if (!entry) {
    return null;
  }
  return entry.kind === "pc" ? entry.characterId : entry.enemyId;
}

// The live budget for a combatant, created on first use of their turn.
// Returns null when they are not the one acting, which every caller treats
// as "no economy to enforce".
export function budgetFor(
  encounter: Encounter | null,
  ownerId: string,
  attacksAllowed: number,
): TurnBudget | null {
  if (!encounter || currentCombatantId(encounter) !== ownerId) {
    return null;
  }
  if (budgetApplies(encounter.turnBudget, ownerId, encounter.round)) {
    // attacksAllowed can change mid-turn (a level-up, a lead correction);
    // the higher of the two is the fair reading.
    return {
      ...encounter.turnBudget,
      attacksAllowed: Math.max(encounter.turnBudget.attacksAllowed, attacksAllowed),
    };
  }
  return freshBudget({ ownerId, round: encounter.round, attacksAllowed });
}

export function storeBudget(encounter: Encounter, budget: TurnBudget) {
  encounter.turnBudget = budget;
  saveEncounter(encounter);
}

// Attacks the Attack action grants this character: 1 plus Extra Attack.
export function attacksAllowedFor(sheet: CharacterSheet): number {
  return 1 + combatRiders(sheet).extraAttacks;
}

// ---- take_action ----

// Which slot of the turn each action costs. Hide and Disengage can be bonus
// actions for some classes (Cunning Action, Step of the Wind); the server
// takes the action slot and lets the model say otherwise via the feature
// guidance rather than guessing.
const ACTION_COST: Record<string, ActionKind> = {
  dodge: "action",
  dash: "action",
  disengage: "action",
  hide: "action",
  help: "action",
  grapple: "action",
  shove: "action",
};

function publishRoll(campaignId: string, roll: ReturnType<typeof insertRoll>) {
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll, source: "digital" });
}

// Adds a condition to a sheet without disturbing the ones already there.
function addSheetCondition(
  campaign: Campaign,
  sheet: CharacterSheet,
  condition: string,
  rounds: number,
) {
  if (sheet.conditions.some((entry) => entry.toLowerCase() === condition)) {
    return;
  }
  const updated = patchSheet(sheet.id, {
    conditions: [...sheet.conditions, condition],
    conditionMeta: { ...sheet.conditionMeta, [condition]: { rounds } },
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

export function handleTakeAction(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof takeActionSchema>;
  try {
    args = takeActionSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: take_action needs characterId and a known action." };
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  if (sheet.currentHp <= 0) {
    return { error: `${sheet.name} is at 0 HP and takes no actions.` };
  }

  const encounter = getActiveEncounter(campaign.id);
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet));
  if (budget && encounter) {
    const spend = spendAction(budget, ACTION_COST[args.action], args.action, sheet.name);
    if (!spend.ok) {
      return { error: spend.error };
    }
    storeBudget(encounter, spend.budget);
  }

  const derived = computeSheetDerived(sheet);

  switch (args.action) {
    case "dodge": {
      // Until their next turn, attacks against them have disadvantage and
      // they have advantage on DEX saves. One round covers both.
      addSheetCondition(campaign, sheet, DODGING, 1);
      return {
        ok: true,
        action: "Dodge",
        applied: `${sheet.name} is dodging: every attack against them rolls at disadvantage until their next turn, and they have advantage on Dexterity saves. The server applies it.`,
      };
    }
    case "dash": {
      if (encounter && budget) {
        storeBudget(encounter, { ...encounter.turnBudget!, dashed: true });
      }
      return {
        ok: true,
        action: "Dash",
        applied: `${sheet.name}'s movement is doubled this turn; the battle map allows the extra distance.`,
      };
    }
    case "disengage": {
      if (encounter && budget) {
        storeBudget(encounter, { ...encounter.turnBudget!, disengaged: true });
      }
      return {
        ok: true,
        action: "Disengage",
        applied: `${sheet.name} can move out of every enemy's reach this turn without provoking an opportunity attack.`,
      };
    }
    case "hide": {
      const stealth = rollExpression(d20Expression(derived.skills.stealth ?? 0));
      const roll = insertRoll({
        campaignId: campaign.id,
        characterId: sheet.id,
        requestedBy: "dm",
        kind: "skill_check",
        detail: `${sheet.name}: Stealth to hide`,
        result: stealth,
      });
      publishRoll(campaign.id, roll);
      turn.rollIds.push(roll.id);

      // Compared against the sharpest living enemy's real passive
      // Perception rather than left to judgement. No enemies = nothing to
      // hide from, so the attempt simply succeeds.
      const watchers = encounter
        ? listEnemies(encounter.id).filter((enemy) => enemy.status === "alive")
        : [];
      const sharpest = watchers.reduce(
        (best, enemy) => Math.max(best, passivePerceptionFor(enemy.stats)),
        0,
      );
      const hidden = stealth.total >= sharpest;
      if (hidden) {
        addSheetCondition(campaign, sheet, HIDDEN, 10);
      }
      return {
        ok: true,
        action: "Hide",
        stealth: stealth.total,
        ...(watchers.length ? { vsPassivePerception: sharpest } : {}),
        hidden,
        note: hidden
          ? `${sheet.name} is hidden. Their next attack has advantage and reveals them; the server applies both.`
          : `${sheet.name} stays in plain sight: ${stealth.total} does not beat a passive Perception of ${sharpest}.`,
      };
    }
    case "help": {
      const target = args.targetCharacterId
        ? resolveSheetRef(args.targetCharacterId, sheets, sheetsById)
        : null;
      if (!target || target.id === sheet.id) {
        return {
          error: "Help goes to another character: pass their targetCharacterId.",
        };
      }
      const fresh = getSheetById(target.id) ?? target;
      addSheetCondition(campaign, fresh, HELPED, 1);
      return {
        ok: true,
        action: "Help",
        applied: `${fresh.name} has advantage on their next ability check or attack; the server spends it on their next d20 roll.`,
      };
    }
    case "grapple":
    case "shove": {
      if (!encounter) {
        return { error: `${args.action} needs an active encounter and a target.` };
      }
      const enemy = args.targetEnemyId ? resolveEnemyRef(encounter.id, args.targetEnemyId) : null;
      if (!enemy || enemy.status !== "alive") {
        return { error: `${args.action} needs a living targetEnemyId from GAME STATE.` };
      }
      // SRD contest: the attacker's Athletics against the target's better of
      // Athletics (STR) and Acrobatics (DEX). The stat block has no skills,
      // so its raw ability modifiers stand in.
      const attackRoll = rollExpression(d20Expression(derived.skills.athletics ?? 0));
      const defenderMod = Math.max(
        saveModFor(enemy.stats, "str"),
        saveModFor(enemy.stats, "dex"),
      );
      const defendRoll = rollExpression(d20Expression(defenderMod));
      const attackerCard = insertRoll({
        campaignId: campaign.id,
        characterId: sheet.id,
        requestedBy: "dm",
        kind: "skill_check",
        detail: `${sheet.name}: Athletics to ${args.action} ${enemy.displayName}`,
        result: attackRoll,
      });
      const defenderCard = insertRoll({
        campaignId: campaign.id,
        characterId: null,
        requestedBy: "dm",
        kind: "skill_check",
        detail: `${enemy.displayName}: contest against the ${args.action}`,
        result: defendRoll,
      });
      publishRoll(campaign.id, attackerCard);
      publishRoll(campaign.id, defenderCard);
      turn.rollIds.push(attackerCard.id, defenderCard.id);

      // Ties go to the defender, per the SRD contest rule.
      const won = attackRoll.total > defendRoll.total;
      if (!won) {
        return {
          ok: true,
          action: args.action,
          contest: `${attackRoll.total} vs ${defendRoll.total}`,
          success: false,
          note: `${enemy.displayName} resists; narrate the failed ${args.action}.`,
        };
      }
      const condition = args.action === "grapple" ? "grappled" : "prone";
      const pushOnly = args.action === "shove" && args.shove === "push";
      if (!pushOnly) {
        if (enemy.stats.conditionImmune.toLowerCase().includes(condition)) {
          return {
            ok: true,
            action: args.action,
            contest: `${attackRoll.total} vs ${defendRoll.total}`,
            success: false,
            note: `${enemy.displayName} cannot be ${condition}; it is immune. Narrate the attempt failing against its nature.`,
          };
        }
        patchEnemyConditions(
          enemy.id,
          [...enemy.conditions, condition],
          { ...enemy.conditionMeta, [condition]: {} },
        );
        publishEncounter(campaign.id);
      }
      return {
        ok: true,
        action: args.action,
        contest: `${attackRoll.total} vs ${defendRoll.total}`,
        success: true,
        applied: pushOnly
          ? `${enemy.displayName} is shoved 5 feet back; move its token if the map shows the fight.`
          : `${enemy.displayName} is ${condition}. The server applied the condition and its mechanics.`,
      };
    }
  }
}

// ---- use_reaction ----

// Reactions with a server-side payload. Everything else spends the reaction
// and comes back with the SRD line for the model to narrate.
const REACTION_NOTES: Array<{ match: RegExp; note: string }> = [
  {
    match: /shield/i,
    note: "Shield: +5 AC until the start of their next turn, which can turn a hit into a miss. If the triggering attack already landed, re-read its roll against the new AC and narrate accordingly.",
  },
  {
    match: /uncanny dodge/i,
    note: "Uncanny Dodge: the damage of that one attack is halved. Apply the halved number with apply_damage, or if the full damage already landed, heal the difference back.",
  },
  {
    match: /deflect missile/i,
    note: "Deflect Missiles: reduce the ranged weapon damage by 1d10 + monk level + DEX modifier; if that reduces it to 0 they may throw the missile back as a monk weapon attack.",
  },
  {
    match: /cutting words/i,
    note: "Cutting Words: spend a Bardic Inspiration die and subtract it from the triggering roll, which can turn a hit into a miss.",
  },
  {
    match: /protection/i,
    note: "Protection fighting style: the triggering attack against the ally rolls at disadvantage.",
  },
  {
    match: /opportunity|attack of opportunity/i,
    note: "Opportunity attack: one melee attack against the creature leaving their reach. Resolve it with pc_attack.",
  },
];

export function handleUseReaction(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof useReactionSchema>;
  try {
    args = useReactionSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: use_reaction needs characterId and feature." };
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  if (sheet.currentHp <= 0) {
    return { error: `${sheet.name} is at 0 HP and has no reaction to spend.` };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "Reactions only exist in combat; there is no active encounter." };
  }

  // A reaction is spent on someone ELSE's turn, so it cannot live in the
  // acting combatant's turn budget. Both sides of the table share
  // encounter.reactionsUsed, which empties when the round wraps.
  if (encounter.reactionsUsed.includes(sheet.id)) {
    return {
      error: `${sheet.name} has already used their reaction this round; it comes back at the start of their next turn. ${args.feature} does not happen.`,
    };
  }
  encounter.reactionsUsed = [...encounter.reactionsUsed, sheet.id];
  saveEncounter(encounter);

  const known = REACTION_NOTES.find((entry) => entry.match.test(args.feature));
  return {
    ok: true,
    reaction: args.feature,
    spent: `${sheet.name}'s reaction is used until the start of their next turn.`,
    note: known?.note ?? `Narrate ${args.feature} exactly as their sheet describes it.`,
  };
}
