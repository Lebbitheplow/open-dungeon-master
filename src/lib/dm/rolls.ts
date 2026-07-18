import { z } from "zod";
import { d20Expression, type Advantage } from "@/lib/dice";
import { computeSheetDerived, findSkill } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { StreamedToolCall } from "@/lib/model-client";

export const rollArgsSchema = z.object({
  characterId: z.string().optional(),
  kind: z.enum([
    "skill_check",
    "saving_throw",
    "ability_check",
    "attack",
    "damage",
    "initiative",
    "custom",
  ]),
  skill: z.string().optional(),
  ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  dc: z.number().int().min(1).max(40).optional(),
  expression: z.string().max(60).optional(),
  advantage: z.enum(["none", "advantage", "disadvantage"]).optional(),
  reason: z.string().optional(),
});

export type RollArgs = z.infer<typeof rollArgsSchema>;

export type ParsedToolCall = {
  id?: string;
  name: string;
  rawArguments: string;
};

export function extractToolCalls(toolCalls: unknown): ParsedToolCall[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  const parsed: ParsedToolCall[] = [];
  for (const call of toolCalls) {
    const raw = call as StreamedToolCall & { function?: { name?: unknown; arguments?: unknown } };
    const name = typeof raw?.function?.name === "string" ? raw.function.name : "";
    if (!name) {
      continue;
    }
    const args =
      typeof raw.function?.arguments === "string"
        ? raw.function.arguments
        : JSON.stringify(raw.function?.arguments ?? {});
    parsed.push({ id: typeof raw.id === "string" ? raw.id : undefined, name, rawArguments: args });
  }
  return parsed;
}

// Resolve a request_roll call into a canonical expression using the sheet as
// the only source of modifiers.
export function resolveRollExpression(
  args: RollArgs,
  sheet: CharacterSheet | null,
): { expression: string; detail: string } | { error: string } {
  const advantage: Advantage = args.advantage ?? "none";

  if (args.kind === "skill_check") {
    if (!sheet) {
      return { error: "skill_check needs a valid characterId from GAME STATE." };
    }
    // Models often send display names ("Sleight of Hand"); normalize to ids.
    const normalizedSkill = (args.skill ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const skill = normalizedSkill ? findSkill(normalizedSkill) : null;
    if (!skill) {
      return { error: `Unknown skill "${args.skill ?? ""}". Use a 5e skill id like "stealth".` };
    }
    const derived = computeSheetDerived(sheet);
    return {
      expression: d20Expression(derived.skills[skill.id] ?? 0, advantage),
      detail: skill.id,
    };
  }

  if (args.kind === "saving_throw" || args.kind === "ability_check") {
    if (!sheet) {
      return { error: `${args.kind} needs a valid characterId from GAME STATE.` };
    }
    if (!args.ability) {
      return { error: `${args.kind} needs an ability (str, dex, con, int, wis, cha).` };
    }
    const derived = computeSheetDerived(sheet);
    const modifier =
      args.kind === "saving_throw"
        ? derived.saves[args.ability]
        : derived.abilityMods[args.ability];
    return { expression: d20Expression(modifier, advantage), detail: args.ability };
  }

  if (args.kind === "initiative") {
    if (!sheet) {
      return { error: "initiative needs a valid characterId from GAME STATE." };
    }
    const derived = computeSheetDerived(sheet);
    return { expression: d20Expression(derived.initiative, advantage), detail: "initiative" };
  }

  // attack / damage / custom: the model supplies the expression (NPC stat
  // blocks live in its narration for now); the dice library enforces sanity.
  if (!args.expression) {
    return { error: `${args.kind} needs a dice expression like "1d20+4" or "2d6+2".` };
  }
  return { expression: args.expression, detail: args.reason?.slice(0, 60) ?? "" };
}

// Finds the sheet a model-supplied character reference points at: exact id
// first, then case-insensitive name (models often send names).
export function resolveSheetRef(
  requested: string | undefined,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): CharacterSheet | null {
  const trimmed = (requested ?? "").trim();
  if (!trimmed) {
    return null;
  }
  return (
    sheetsById.get(trimmed) ??
    sheets.find((entry) => entry.name.toLowerCase() === trimmed.toLowerCase()) ??
    null
  );
}
