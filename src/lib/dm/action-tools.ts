import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import {
  getActiveEncounter,
  listEnemies,
  patchEnemyConditions,
  saveEncounter,
  type EncounterEnemy,
} from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import type { DmTurn } from "@/lib/db/dm-turns";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { abilityMod, acBreakdownFor, computeSheetDerived, sizeForRace } from "@/lib/srd";
import {
  conditionBlocksReactions,
  conditionExtraActions,
} from "@/lib/srd/condition-effects";
import { passivePerceptionFor, saveModFor, sizeRank } from "@/lib/bestiary/statblock";
import { spendAction, type ActionKind, type TurnBudget } from "@/lib/dm/action-budget";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { canAct } from "@/lib/dm/can-act";
import { seenClearlyBy, tilesBetween, wallBetween } from "@/lib/dm/attack-spatial";
import { pushTokenAway } from "@/lib/dm/map-tools";

import { resolveEnemyRef, publishEncounter } from "@/lib/dm/enemy-damage";
// For the Shield spell's slot spend; mutations never imports back.
import { applyDmMutation } from "@/lib/dm/mutations";
import { resolveSheetRef } from "@/lib/dm/rolls";
import {
  DODGING,
  exhaustionRollState,
  mergeAdvantage,
  rollDerivation,
  type AdvantageState,
} from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { spellFactsFor } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";

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
          targetCharacterId: {
            type: "string",
            description: "Protection style only: the ally being covered.",
          },
          level: {
            type: "integer",
            minimum: 1,
            maximum: 9,
            description: "A reaction SPELL (Shield, Counterspell, Hellish Rebuke) cast from a higher slot. Omit for the spell's own level; the server spends the slot.",
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
  // The ally a Protection-style reaction covers.
  targetCharacterId: z.string().optional(),
  // A reaction spell cast from a higher slot (Counterspell at 5th).
  level: z.coerce.number().int().min(1).max(9).optional(),
  reason: z.string().optional(),
});

// ---- budget plumbing ----

// Lives in src/lib/dm/turn-budget.ts; re-exported for the callers that
// learned it here.
export {
  attacksAllowedFor,
  budgetFor,
  currentCombatantId,
  grantActionSurge,
  storeBudget,
} from "@/lib/dm/turn-budget";

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

// Adds a condition to a sheet without disturbing the ones already there. It
// lasts a count of rounds, or until the start of the named combatant's next
// turn, which is how Dodge, Help, Shield and the Protection style are worded.
function addSheetCondition(
  campaign: Campaign,
  sheet: CharacterSheet,
  condition: string,
  lasts: { rounds: number } | { untilTurnOf: string },
) {
  if (sheet.conditions.some((entry) => entry.toLowerCase() === condition)) {
    return;
  }
  const updated = patchSheet(sheet.id, {
    conditions: [...sheet.conditions, condition],
    conditionMeta: { ...sheet.conditionMeta, [condition]: lasts },
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The d20 a contest or a Stealth roll is made with: an ability check, so the
// conditions and exhaustion that put ability checks at disadvantage apply
// here exactly as they do through request_roll.
function checkAdvantage(
  sheet: CharacterSheet,
  ability: "str" | "dex",
  extra: AdvantageState[] = [],
): AdvantageState {
  return mergeAdvantage([
    rollDerivation(sheet.conditions, "skill_check", ability).advantage,
    exhaustionRollState(sheet.exhaustion ?? 0, "skill_check").advantage,
    ...extra,
  ]);
}

// What an enemy contests a grapple or shove with: the better of Strength
// (Athletics) and Dexterity (Acrobatics), a printed skill bonus when the
// stat block has one and the bare ability modifier otherwise. A block with
// no ability scores (an old snapshot) falls back to its save modifiers.
function contestModifier(stats: EncounterEnemy["stats"]): number {
  const skills = stats.skills ?? {};
  const bare = (ability: "str" | "dex") =>
    stats.abilities?.[ability] !== undefined
      ? abilityMod(stats.abilities[ability])
      : saveModFor(stats, ability);
  return Math.max(skills.athletics ?? bare("str"), skills.acrobatics ?? bare("dex"));
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
  const encounter = getActiveEncounter(campaign.id);
  const allowed = canAct({ sheet, encounter, kind: "action" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }

  // The action is priced here and paid for below, by `spend`, once the
  // action's own checks have passed: a grapple refused for size or a Help
  // with no ally named leaves the turn its action.
  const budget = budgetFor(
    encounter,
    sheet.id,
    attacksAllowedFor(sheet),
    conditionExtraActions(sheet.conditions),
  );
  let priced: TurnBudget | null = null;
  if (budget && encounter) {
    const price = spendAction(budget, ACTION_COST[args.action], args.action, sheet.name);
    if (!price.ok) {
      return { error: price.error };
    }
    priced = price.budget;
  }
  const spend = (flags: Partial<Pick<TurnBudget, "dashed" | "disengaged">> = {}) => {
    if (encounter && priced) {
      storeBudget(encounter, { ...priced, ...flags });
    }
  };

  const derived = computeSheetDerived(sheet);

  switch (args.action) {
    case "dodge": {
      spend();
      // Until their next turn, attacks against them have disadvantage and
      // they have advantage on DEX saves.
      addSheetCondition(campaign, sheet, DODGING, { untilTurnOf: sheet.id });
      return {
        ok: true,
        action: "Dodge",
        applied: `${sheet.name} is dodging: every attack against them rolls at disadvantage until their next turn, and they have advantage on Dexterity saves. The server applies it.`,
      };
    }
    case "dash": {
      spend({ dashed: true });
      return {
        ok: true,
        action: "Dash",
        applied: `${sheet.name}'s movement is doubled this turn; the battle map allows the extra distance.`,
      };
    }
    case "disengage": {
      spend({ disengaged: true });
      return {
        ok: true,
        action: "Disengage",
        applied: `${sheet.name} can move out of every enemy's reach this turn without provoking an opportunity attack.`,
      };
    }
    case "hide": {
      // Nobody hides from a creature that sees them clearly. On a mapped
      // fight that is read from the board: a sight line with no cover and
      // no darkness between is a clear view.
      const watcher = encounter ? seenClearlyBy(encounter.id, sheet.id) : null;
      if (watcher) {
        return {
          error: `${sheet.name} cannot hide: ${watcher} sees them clearly. They move out of its sight, behind cover or into darkness first, then hide.`,
        };
      }
      spend();
      // Noisy armor (scale, plate...) makes hiding a disadvantage roll.
      const noisyArmor = acBreakdownFor(sheet).stealthDisadvantage;
      const stealth = rollExpression(
        d20Expression(
          derived.skills.stealth ?? 0,
          checkAdvantage(sheet, "dex", noisyArmor ? ["disadvantage"] : []),
        ),
      );
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
        addSheetCondition(campaign, sheet, HIDDEN, { rounds: 10 });
      }
      return {
        ok: true,
        action: "Hide",
        stealth: stealth.total,
        ...(watchers.length ? { vsPassivePerception: sharpest } : {}),
        hidden,
        ...(noisyArmor ? { armor: "their armor imposed disadvantage on the Stealth roll" } : {}),
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
      spend();
      const fresh = getSheetById(target.id) ?? target;
      addSheetCondition(campaign, fresh, HELPED, { untilTurnOf: sheet.id });
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
      // SRD: the target can be at most one size larger than the attacker.
      if (sizeRank(enemy.stats.size) > sizeRank(sizeForRace(sheet.race)) + 1) {
        return {
          error: `${enemy.displayName} is ${enemy.stats.size}: too large for ${sheet.name} (${sizeForRace(sheet.race)}) to ${args.action}. A creature can only ${args.action} a target at most one size larger than itself.`,
        };
      }
      // Hands on the target: it has to be within reach, with no wall between.
      const apart = tilesBetween(encounter.id, sheet.id, enemy.id);
      if (apart !== null && (apart > 1 || wallBetween(encounter.id, sheet.id, enemy.id))) {
        return {
          error: `${sheet.name} is ${apart * 5} ft from ${enemy.displayName}; a ${args.action} needs the target within 5 ft. They move their token next to it first.`,
        };
      }
      spend();
      // SRD contest: the attacker's Athletics against the target's better of
      // Athletics (STR) and Acrobatics (DEX).
      const attackRoll = rollExpression(
        d20Expression(derived.skills.athletics ?? 0, checkAdvantage(sheet, "str")),
      );
      const defenderAdvantage = mergeAdvantage([
        rollDerivation(enemy.conditions, "skill_check", "str").advantage,
      ]);
      const defendRoll = rollExpression(
        d20Expression(contestModifier(enemy.stats), defenderAdvantage),
      );
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
      if (pushOnly) {
        // Five feet straight away from the shover, when the square is free.
        const pushed = pushTokenAway(campaign, encounter.id, sheet.id, enemy.id);
        return {
          ok: true,
          action: args.action,
          contest: `${attackRoll.total} vs ${defendRoll.total}`,
          success: true,
          applied: pushed.moved
            ? `${enemy.displayName} is shoved 5 feet back to (${pushed.at.x},${pushed.at.y}). The server moved its token; the push provokes nothing.`
            : `${enemy.displayName} is shoved but has nowhere to go: ${pushed.reason}. It stays where it is.`,
        };
      }
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
        {
          ...enemy.conditionMeta,
          // Who holds the grapple, so it can end when they are incapacitated
          // (src/lib/dm/set-condition.ts releaseGrapplesHeldBy).
          [condition]: condition === "grappled" ? { source: sheet.id } : {},
        },
      );
      publishEncounter(campaign.id);
      return {
        ok: true,
        action: args.action,
        contest: `${attackRoll.total} vs ${defendRoll.total}`,
        success: true,
        applied: `${enemy.displayName} is ${condition}. The server applied the condition and its mechanics.`,
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
  turn: DmTurn,
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
  const encounter = getActiveEncounter(campaign.id);
  // The dead, the dying, the incapacitated and the surprised have no
  // reaction; whose turn it is does not matter to one.
  const allowed = canAct({ sheet, encounter, kind: "reaction" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }
  if (!encounter) {
    return { error: "Reactions only exist in combat; there is no active encounter." };
  }
  // Slow and its kin switch reactions off entirely.
  const blocked = conditionBlocksReactions(sheet.conditions);
  if (blocked) {
    return {
      error: `${sheet.name} is ${blocked} and cannot take reactions; ${args.feature} does not happen.`,
    };
  }

  // A reaction is spent on someone ELSE's turn, so it cannot live in the
  // acting combatant's turn budget. Both sides of the table share
  // encounter.reactionsUsed; a combatant's entry leaves it as their own turn
  // starts (advancePointer).
  if (encounter.reactionsUsed.includes(sheet.id)) {
    return {
      error: `${sheet.name} has already used their reaction; it comes back at the start of their next turn. ${args.feature} does not happen.`,
    };
  }

  // A reaction that is a spell (Shield, Counterspell, Hellish Rebuke,
  // Absorb Elements, Feather Fall) is a cast: the caster must hold it and
  // pay its slot through the one guard (src/lib/dm/cast-guard.ts), which
  // refuses before the reaction is spent. Shield's +5 AC then lands as a
  // registry condition until their next turn, so enemy swings genuinely
  // test the higher number.
  const reactionSpell = spellFactsFor(args.feature.trim(), spellAuthorsFor(campaign));
  if (reactionSpell?.castingTime === "reaction") {
    const cast = applyDmMutation(
      campaign,
      turn.id,
      "use_spell_slot",
      JSON.stringify({
        characterId: sheet.id,
        spell: reactionSpell.name,
        ...(args.level ? { level: args.level } : {}),
        via: "reaction",
        reason: `${reactionSpell.name} reaction`,
      }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in cast) {
      return cast;
    }
    encounter.reactionsUsed = [...encounter.reactionsUsed, sheet.id];
    saveEncounter(encounter);
    const spent = `${sheet.name}'s reaction${
      typeof cast.slotLevel === "number" ? ` and a level-${cast.slotLevel} slot are` : " is"
    } spent.`;
    if (reactionSpell.name.toLowerCase() === "shield") {
      addSheetCondition(campaign, sheet, "shielded", { untilTurnOf: sheet.id });
      const updated = getSheetById(sheet.id);
      return {
        ok: true,
        reaction: args.feature,
        spent,
        applied: `Shield: +5 AC until the start of their next turn; their AC is now ${
          updated?.ac ?? sheet.ac + 5
        }. The server applied it. If the triggering attack rolled below that, it misses; narrate accordingly.`,
      };
    }
    const known = REACTION_NOTES.find((entry) => entry.match.test(args.feature));
    return {
      ok: true,
      reaction: args.feature,
      spent,
      ...(cast.droppedConcentration ? { droppedConcentration: cast.droppedConcentration } : {}),
      note: known?.note ?? `${reactionSpell.name} is cast; narrate its effect as the spell describes it.`,
    };
  }

  encounter.reactionsUsed = [...encounter.reactionsUsed, sheet.id];
  saveEncounter(encounter);

  // The Protection fighting style covers an ally with a real condition:
  // the triggering attack (and any other until the protector's next turn)
  // rolls at disadvantage against them.
  if (/protection/i.test(args.feature)) {
    const allyRef = args.targetCharacterId
      ? resolveSheetRef(args.targetCharacterId, sheets, sheetsById)
      : null;
    const ally = allyRef ? (getSheetById(allyRef.id) ?? allyRef) : null;
    if (ally && ally.id !== sheet.id) {
      addSheetCondition(campaign, ally, "protected", { untilTurnOf: sheet.id });
      return {
        ok: true,
        reaction: args.feature,
        spent: `${sheet.name}'s reaction is used until the start of their next turn.`,
        applied: `${ally.name} is protected: attacks against them roll at disadvantage until ${sheet.name}'s next turn. The server applies it; if the triggering attack already hit, re-read it at disadvantage.`,
      };
    }
  }

  const known = REACTION_NOTES.find((entry) => entry.match.test(args.feature));
  return {
    ok: true,
    reaction: args.feature,
    spent: `${sheet.name}'s reaction is used until the start of their next turn.`,
    note: known?.note ?? `Narrate ${args.feature} exactly as their sheet describes it.`,
  };
}
