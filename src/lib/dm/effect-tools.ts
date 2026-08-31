import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import {
  deleteEffectsByName,
  insertEffect,
  listEffects,
} from "@/lib/db/active-effects";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import {
  checkEffect,
  describeEffect,
  EFFECT_DURATIONS,
  EFFECT_FIELDS,
  EFFECT_MODES,
  resolveField,
  type ActiveEffect,
  type EffectField,
  type EffectTargetKind,
  type FieldOutcome,
} from "@/lib/dm/effects-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Applying and lifting active effects, and the one helper every engine that
// wants a modified number calls.
//
// Everything mechanical lives in effects-logic.ts; this is the DB and event
// rim around it, plus the two adjudications that put it in reach of both the
// AI and a person at the console.

export const EFFECT_TOOL_NAMES = ["set_effect", "clear_effect"] as const;

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const effectTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "set_effect",
      description:
        "Put a lasting modifier on a character or an enemy: a blessing, a curse, a potion, a hex, a wound that has not healed. Use this for anything that changes a number for a while and is not one of the 14 named 5e conditions (those go through set_condition). Every modifier is applied by the server to the rolls it names, and the effect ends on its own when its duration runs out.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "The character it lands on." },
          enemyId: { type: "string", description: "Or the enemy it lands on." },
          name: { type: "string", description: "What it is called, e.g. 'Bless'." },
          source: { type: "string", description: "What caused it, e.g. 'Aldric's spell'." },
          modifiers: {
            type: "array",
            description: "What it changes. At least one.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                field: { type: "string", enum: [...EFFECT_FIELDS] },
                mode: { type: "string", enum: [...EFFECT_MODES] },
                value: { type: "integer", description: "For add and override." },
              },
              required: ["field"],
            },
          },
          duration: { type: "string", enum: [...EFFECT_DURATIONS] },
          remaining: { type: "integer", minimum: 1, description: "Rounds or minutes it lasts." },
          saveAbility: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
          saveDc: { type: "integer", minimum: 1, maximum: 30 },
          visible: { type: "boolean", description: "True when the party can tell it is there." },
        },
        required: ["name", "modifiers"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_effect",
      description:
        "Lift an active effect early, by name: dispelled, cured, or the curse broken. Effects with a duration end on their own; this is for the ones that do not.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string" },
          enemyId: { type: "string" },
          name: { type: "string", description: "The effect's name." },
        },
        required: ["name"],
      },
    },
  },
];

const setSchema = z.object({
  characterId: z.string().optional(),
  enemyId: z.string().optional(),
  name: z.string(),
  source: z.string().optional(),
  modifiers: z.array(z.record(z.string(), z.unknown())).optional(),
  duration: z.string().optional(),
  remaining: z.coerce.number().optional(),
  saveAbility: z.string().optional(),
  saveDc: z.coerce.number().optional(),
  visible: z.coerce.boolean().optional(),
});

const clearSchema = z.object({
  characterId: z.string().optional(),
  enemyId: z.string().optional(),
  name: z.string(),
});

function tableNote(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

// Which combatant an effect lands on. A character id and an enemy id are both
// accepted, and a name is accepted for either, because that is what a person
// types into the console and what a model reaches for when the id is not to
// hand.
function resolveTarget(
  campaign: Campaign,
  args: { characterId?: string; enemyId?: string },
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { kind: EffectTargetKind; id: string; name: string } | null {
  if (args.characterId) {
    const sheet =
      sheetsById.get(args.characterId) ??
      sheets.find((entry) => entry.name.toLowerCase() === args.characterId?.toLowerCase());
    if (sheet) {
      return { kind: "character", id: sheet.id, name: sheet.name };
    }
  }
  if (args.enemyId) {
    const encounter = getActiveEncounter(campaign.id);
    if (encounter) {
      const enemies = listEnemies(encounter.id);
      const enemy =
        enemies.find((entry) => entry.id === args.enemyId) ??
        enemies.find(
          (entry) => entry.displayName.toLowerCase() === args.enemyId?.toLowerCase(),
        );
      if (enemy) {
        return { kind: "enemy", id: enemy.id, name: enemy.displayName };
      }
    }
  }
  return null;
}

function publishEffects(campaignId: string) {
  publishPersisted(campaignId, "effects_updated", {
    effects: listEffects(campaignId),
  });
}

export function handleSetEffect(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof setSchema>;
  try {
    args = setSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: set_effect needs a name and at least one modifier." };
  }
  const target = resolveTarget(campaign, args, sheets, sheetsById);
  if (!target) {
    return { error: "set_effect needs a characterId or an enemyId from GAME STATE." };
  }
  const checked = checkEffect({
    name: args.name,
    source: args.source,
    modifiers: (args.modifiers ?? []) as Array<{ field: unknown; mode?: unknown; value?: unknown }>,
    duration: args.duration,
    remaining: args.remaining,
    saveAbility: args.saveAbility,
    saveDc: args.saveDc,
    visible: args.visible,
  });
  if ("error" in checked) {
    return checked;
  }
  // Reapplying by the same name replaces rather than stacks: casting Bless
  // twice on the same target does not double it, and two rows would leave the
  // second one impossible to lift.
  deleteEffectsByName(campaign.id, target, checked.effect.name);
  const effect = insertEffect({
    campaignId: campaign.id,
    targetKind: target.kind,
    targetId: target.id,
    ...checked.effect,
  });
  publishEffects(campaign.id);
  if (effect.visible) {
    tableNote(campaign, `${target.name}: ${describeEffect(effect)}`);
  }
  return { ok: true, effect: describeEffect(effect), on: target.name };
}

export function handleClearEffect(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof clearSchema>;
  try {
    args = clearSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: clear_effect needs a name." };
  }
  const target = resolveTarget(campaign, args, sheets, sheetsById);
  if (!target) {
    return { error: "clear_effect needs a characterId or an enemyId from GAME STATE." };
  }
  const removed = deleteEffectsByName(campaign.id, target, args.name);
  if (!removed) {
    return { error: `${target.name} is not under "${args.name}".` };
  }
  publishEffects(campaign.id);
  tableNote(campaign, `${args.name} lifts from ${target.name}.`);
  return { ok: true, cleared: args.name, from: target.name };
}

// ---- the read side ----

// What is riding on one combatant, for one field, right now. The single
// function every engine calls: the AC check, the attack roll, the save. It is
// deliberately a query rather than something baked into the sheet, because an
// effect is not a property of a character, it is a thing happening to them.
export function effectOutcome(
  campaignId: string,
  target: { kind: EffectTargetKind; id: string },
  field: EffectField,
): FieldOutcome {
  return resolveField(listEffects(campaignId, target), field);
}

// The extras a d20 roll needs, resolved from the effect table. Shaped for
// resolveRollExpression's `extras` because that is the one place every check,
// save and initiative roll passes through, so an effect applies to all of
// them without each caller remembering it.
export function rollEffectExtras(
  campaignId: string,
  characterId: string,
  kind: "saving_throw" | "skill_check" | "ability_check" | "initiative" | string,
): {
  effectBonus?: number;
  effectNote?: string;
  effectAdvantage?: boolean;
  effectDisadvantage?: boolean;
} {
  const field: EffectField | null =
    kind === "saving_throw"
      ? "save"
      : kind === "initiative"
        ? "initiative"
        : kind === "skill_check" || kind === "ability_check"
          ? "check"
          : null;
  if (!field) {
    return {};
  }
  const outcome = effectOutcome(campaignId, { kind: "character", id: characterId }, field);
  if (!outcome.bonus && !outcome.advantage && !outcome.disadvantage) {
    return {};
  }
  return {
    ...(outcome.bonus ? { effectBonus: outcome.bonus } : {}),
    ...(outcome.sources.length ? { effectNote: outcome.sources.join("; ") } : {}),
    ...(outcome.advantage ? { effectAdvantage: true } : {}),
    ...(outcome.disadvantage ? { effectDisadvantage: true } : {}),
  };
}

export function effectsOn(
  campaignId: string,
  target: { kind: EffectTargetKind; id: string },
): ActiveEffect[] {
  return listEffects(campaignId, target);
}
