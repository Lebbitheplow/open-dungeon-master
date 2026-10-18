// The model's own calls to the raw damage, healing and condition tools
// (docs/dnd-rules-audit-2026-10-09-extent.md, F17), held to the rules of
// src/lib/dm/ai-boundary.ts before they reach the engine:
//
//   - damage and healing are dice the server rolls now (`dice`), or a total
//     the server rolled this turn and nothing has spent yet;
//   - a condition that binds a creature lands only after the save the server
//     rolls (saveAbility and saveDc);
//   - a binding condition the engine keeps (a save, a duration, a spell, a
//     source decides when it ends) is not lifted by hand;
//   - an item granted or revealed says what it is when its name does not;
//   - an advantage claimed with its reason names where it comes from.
//
// Only the model's calls pass through here: those the AI's turn runs itself
// (resolveModelCall in src/lib/dm/turn.ts) and the rest through
// dispatchAdjudication. The engine's own paths call the handlers directly,
// and the console and the party lead keep their free hand.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getRoll, markRollApplied } from "@/lib/db/rolls";
import { isValidExpression } from "@/lib/dice";
import { spellFactsFor } from "@/lib/content";
import { rollAgainst } from "@/lib/roll-labels";
import { rollCard } from "@/lib/dm/roll-card";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { canonicalCondition } from "@/lib/dm/set-condition";
import { trapHoldOn } from "@/lib/dm/trap-escape";
import { instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { AI_BIND_REFUSAL, AI_CLEAR_REFUSAL, AI_NUMBER_REFUSAL, bindsCreature, engineKept } from "@/lib/dm/ai-boundary";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { listedAgainst } from "@/lib/dm/roll-about";
import { heldSaveTraits } from "@/lib/srd/trait-rules";
import { unnamedRollKeys } from "@/lib/srd/roll-keys";
import { hasItemTag, itemRow } from "@/lib/srd/item-tags";
import { listedItemTags } from "@/lib/schemas/item-tags";
import { sentItemTags } from "@/lib/dm/item-logic";
import { isTableGearName } from "@/lib/db/homebrew";

export type GateContext = {
  campaign: Campaign;
  turn: DmTurn;
  sheetsById: Map<string, CharacterSheet>;
};

// The call to run (its arguments, perhaps with the server's own roll in
// them), or the answer that stands in for it.
export type GateOutcome = { args: string } | { result: ToolResult };

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
    case "grant_item":
    case "reveal_item":
      return itemFacts(ctx, name, args, rawArguments);
    case "pc_attack":
    case "enemy_attack":
    case "request_roll":
      return claimSource(args, rawArguments);
    default:
      return { args: rawArguments };
  }
}

// What a granted or revealed item is, when its name alone does not tell the
// engines, which read an item by its row or its tags and never the words of
// its name (src/lib/srd/item-tags.ts): the row a thing no table knows by name
// is (srdName) or its tags, and the spell a scroll holds. Asked for rather
// than lost, as a roll's fields are (src/lib/srd/roll-keys.ts): a potion
// named in the table's language with neither would heal no one, a scroll
// with no spell would cast nothing.
function itemFacts(ctx: GateContext, name: string, args: Record<string, unknown>, rawArguments: string): GateOutcome {
  const described = String(args.name ?? "").trim();
  const itemName = (name === "reveal_item" && typeof args.revealedName === "string" && args.revealedName.trim()) || described;
  if (!itemName || args.unidentified === true) {
    return { args: rawArguments };
  }
  // A revealed item keeps the tags it was granted with.
  const carried = name === "reveal_item" ? ctx.sheetsById.get(String(args.characterId ?? ""))?.equipment.find((item) => item.name === described) : undefined;
  const srdName = typeof args.srdName === "string" && args.srdName.trim() ? args.srdName.trim() : undefined;
  const spell = typeof args.spell === "string" ? args.spell : undefined;
  const tags = sentItemTags({ name: itemName, srdName }, Array.isArray(args.tags) ? listedItemTags(args.tags) : undefined, spell) ?? carried?.tags;
  const item = { name: itemName, ...(srdName ? { srdName } : {}), ...(tags ? { tags } : {}) };
  if (!tags && !srdName && !itemRow(item) && !isTableGearName(ctx.campaign.id, itemName)) {
    return {
      result: {
        error: `${name}: send it again with srdName, the SRD or pack item "${itemName}" is by its English name, or, for loot no list has, tags naming what it is (tags [] when none fits); a spell scroll names its spell in spell. No item the game knows has that name. Nothing changed yet.`,
        retry: true,
      },
    };
  }
  if (hasItemTag(item, "scroll") && !spell?.trim()) {
    return {
      result: {
        error: `${name}: send it again with the spell "${itemName}" holds in spell, as the spell lists name it; a scroll the party cannot read yet is granted unidentified. Nothing changed yet.`,
        retry: true,
      },
    };
  }
  return { args: rawArguments };
}

// An advantage claimed with a reason but no advantageSource: asked whether
// the circumstance is one the server cannot see, rather than set aside, so a
// ruling is never lost to the field left out. A claim from a source the
// server decides, or with no reason, is set aside where it is read
// (pc-attack-options.ts claimedAdvantage).
function claimSource(args: Record<string, unknown>, rawArguments: string): GateOutcome {
  const reason = typeof args.advantageReason === "string" ? args.advantageReason.trim() : "";
  if ((args.advantage === "advantage" || args.advantage === "disadvantage") && reason && args.advantageSource === undefined) {
    return {
      result: {
        error: `The ${args.advantage} claimed for "${reason.slice(0, 80)}" names no advantageSource. Send advantageSource 'other' if it is a circumstance of the fiction the server cannot see, or leave the ${args.advantage} out: the server applies conditions, cover, light, range, Help, flanking, spells, Inspiration and features itself. Nothing was rolled.`,
        retry: true,
      },
    };
  }
  return { args: rawArguments };
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
      return { result: { error: `"${dice}" is not dice the server can roll; send it like "2d6+3".`, retry: true } };
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
    return { result: AI_NUMBER_REFUSAL(what) };
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
    return { result: AI_BIND_REFUSAL(sheet.name, wanted) };
  }
  // Whether the binding is magic, when a trait of theirs answers it (Gnome
  // Cunning): asked for rather than guessed (src/lib/dm/roll-about.ts).
  const against = listedAgainst(wanted);
  const gaps = unnamedRollKeys({ roll: "save", ability, against, magical: args.magical === undefined ? undefined : args.magical === true }, heldSaveTraits(sheet));
  if (gaps.some((gap) => gap.field === "magical")) {
    return { result: { error: `${sheet.name} holds a trait that answers a save against magic. Name magical: true or false, as the fiction is, and send the call again. Nothing changed.`, retry: true } };
  }
  const save = rollCharacterSave(ctx.campaign, ctx.turn, sheet, ability as SaveAbility, dc, `${ability.toUpperCase()} save against being ${wanted}`, { against, ...(args.magical === true ? { magical: true } : {}) });
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
  if (kept && escapeRolled(ctx, sheet, wanted)) {
    return { args: rawArguments };
  }
  return kept ? { result: AI_CLEAR_REFUSAL(sheet.name, wanted) } : { args: rawArguments };
}

// A trap's hold (a falling net) the server has already seen broken: this
// turn rolled the character a check the trap's escape takes (Strength or
// Athletics for a net) that reached its DC, and nothing has spent it. The
// model that rolls the check and then lifts the condition is doing what the
// trap's rule says, as take_action escape does in one call.
function escapeRolled(ctx: GateContext, sheet: CharacterSheet, condition: string): boolean {
  const hold = trapHoldOn(ctx.campaign, sheet);
  if (!hold || canonicalCondition(hold.condition) !== condition) {
    return false;
  }
  const fits = hold.ability === "str" ? /\b(?:athletics|str|strength)\b/i : /\b(?:acrobatics|dex|dexterity)\b/i;
  const roll = ctx.turn.rollIds
    .map((rollId) => getRoll(rollId))
    .find(
      (entry) =>
        entry &&
        !entry.applied &&
        entry.characterId === sheet.id &&
        (entry.kind === "skill_check" || entry.kind === "ability_check") &&
        fits.test(entry.detail) &&
        entry.total >= hold.dc,
    );
  if (!roll) {
    return false;
  }
  markRollApplied(roll.id, `escape:${hold.trap}`.slice(0, 80));
  return true;
}
