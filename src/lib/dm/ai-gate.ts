// The model's own calls to the raw damage, healing and condition tools
// (docs/dnd-rules-audit-2026-10-09-extent.md, F17), held to the rules of
// src/lib/dm/ai-boundary.ts before they reach the engine:
//
//   - damage and healing are dice the server rolls now (`dice`), or a total
//     the server rolled this turn and nothing has spent yet;
//   - a condition that binds a creature lands only after the save the server
//     rolls (saveAbility and saveDc);
//   - a binding condition the engine keeps (a save, a duration, a spell, a
//     source decides when it ends) is not lifted by hand.
//
// Only the model's calls pass through here (dispatchAdjudication). The
// engine's own paths call the handlers directly, and the console and the
// party lead keep their free hand.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getRoll, markRollApplied } from "@/lib/db/rolls";
import { isValidExpression } from "@/lib/dice";
import { spellFactsFor } from "@/lib/content";
import { rollAgainst } from "@/lib/roll-labels";
import { rollCard } from "@/lib/dm/roll-card";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { canonicalCondition } from "@/lib/dm/set-condition";
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { AI_BIND_REFUSAL, AI_CLEAR_REFUSAL, AI_NUMBER_REFUSAL, bindsCreature, engineKept } from "@/lib/dm/ai-boundary";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type GateContext = {
  campaign: Campaign;
  turn: DmTurn;
  sheetsById: Map<string, CharacterSheet>;
};

// The call to run (its arguments, perhaps with the server's own roll in
// them), or the answer that stands in for it.
export type GateOutcome = { args: string } | { result: Record<string, unknown> };

const SAVE_ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);

const NUMBER_TOOLS = new Set(["apply_damage", "heal", "damage_enemy", "split_damage"]);

export function gateAiCall(name: string, rawArguments: string, ctx: GateContext): GateOutcome {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  } catch {
    return { args: rawArguments };
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { args: rawArguments };
  }
  // Dice sent to a damage or healing tool are rolled by the server whoever
  // sends them (the console's forms take dice too).
  if (ctx.turn.actor !== "ai") {
    return NUMBER_TOOLS.has(name) && typeof args.dice === "string" ? number(ctx, args, name === "heal" ? "healing" : "damage", targetOf(name, args)) : { args: rawArguments };
  }
  switch (name) {
    case "apply_damage":
      return number(ctx, args, "damage", String(args.characterId ?? ""));
    case "heal": {
      // A healing spell the server knows is rolled from its own dice.
      const spell = typeof args.spell === "string" ? args.spell.trim() : "";
      if (spell && spellFactsFor(spell)) {
        return { args: rawArguments };
      }
      return number(ctx, args, "healing", String(args.characterId ?? ""));
    }
    case "damage_enemy":
      // A fall is rolled by the server already.
      return args.fallFeet !== undefined ? { args: rawArguments } : number(ctx, args, "damage", String(args.enemyId ?? ""));
    case "split_damage":
      return number(ctx, args, "damage", "");
    case "set_condition":
      return bind(ctx, args);
    case "clear_condition":
      return lift(ctx, args, rawArguments);
    default:
      return { args: rawArguments };
  }
}

function targetOf(name: string, args: Record<string, unknown>): string {
  return String((name === "damage_enemy" ? args.enemyId : name === "split_damage" ? "" : args.characterId) ?? "");
}

// Damage or healing: dice the server rolls now, or (from the model) a total
// it rolled this turn that nothing has applied.
function number(ctx: GateContext, args: Record<string, unknown>, what: "damage" | "healing", targetId: string): GateOutcome {
  const dice = typeof args.dice === "string" ? args.dice.replace(/\s+/g, "") : "";
  if (dice) {
    // Dice, not a number dressed as them: at least one die to roll.
    if (!isValidExpression(dice) || !/\d*d\d+/i.test(dice)) {
      return { result: { error: `"${dice}" is not dice the server can roll; send it like "2d6+3".` } };
    }
    const sheet = ctx.sheetsById.get(targetId);
    const label = rollAgainst(String(args.reason ?? (what === "damage" ? "Damage" : "Healing")).slice(0, 60), sheet?.name ?? "the target");
    const rolled = rollCard(ctx.campaign, ctx.turn, sheet ? sheet.id : null, what === "damage" ? "damage" : "custom", label, dice, null);
    const { dice: _sent, ...rest } = args;
    void _sent;
    return { args: JSON.stringify({ ...rest, amount: Math.max(1, rolled.total) }) };
  }
  const amount = Number(args.amount);
  if (!(amount >= 1) || ctx.turn.actor !== "ai") {
    return { args: JSON.stringify(args) };
  }
  const kinds = what === "damage" ? ["damage"] : ["damage", "custom"];
  const rolled = ctx.turn.rollIds
    .map((rollId) => getRoll(rollId))
    .find((roll) => roll && kinds.includes(roll.kind) && !roll.applied && roll.total === amount);
  if (!rolled) {
    return { result: { error: AI_NUMBER_REFUSAL(what) } };
  }
  markRollApplied(rolled.id, targetId || "split");
  return { args: JSON.stringify(args) };
}

// A binding condition on a character: their save first, the condition only
// on a failure (it then ends on the same save at the end of their turns, or
// when the rounds sent run out).
function bind(ctx: GateContext, args: Record<string, unknown>): GateOutcome {
  const wanted = canonicalCondition(String(args.condition ?? ""));
  const sheet = ctx.sheetsById.get(String(args.characterId ?? ""));
  if (!sheet || !bindsCreature(wanted)) {
    return { args: JSON.stringify(args) };
  }
  const ability = String(args.saveAbility ?? "").slice(0, 3).toLowerCase();
  const dc = Number(args.saveDc);
  if (!SAVE_ABILITIES.has(ability) || !(dc >= 1)) {
    return { result: { error: AI_BIND_REFUSAL(sheet.name, wanted) } };
  }
  const save = rollCharacterSave(ctx.campaign, ctx.turn, sheet, ability as SaveAbility, dc, `${ability.toUpperCase()} save against being ${wanted}`, wanted);
  if (save.success) {
    return {
      result: { ok: true, name: sheet.name, saved: true, note: `${sheet.name} makes the ${ability.toUpperCase()} save (${save.total} vs DC ${dc}): no ${wanted}.` },
    };
  }
  return { args: JSON.stringify(args) };
}

// The model does not lift a binding condition the engine keeps.
function lift(ctx: GateContext, args: Record<string, unknown>, rawArguments: string): GateOutcome {
  const sheet = ctx.sheetsById.get(String(args.characterId ?? ""));
  const wanted = canonicalCondition(String(args.condition ?? ""));
  if (!sheet || !bindsCreature(wanted)) {
    return { args: rawArguments };
  }
  const held = sheet.conditions.find((entry) => canonicalCondition(entry) === wanted);
  const kept = held && instancesOf((sheet.conditionMeta as ConditionMetaMap)[held]).some(engineKept);
  return kept ? { result: { error: AI_CLEAR_REFUSAL(sheet.name, wanted) } } : { args: rawArguments };
}
