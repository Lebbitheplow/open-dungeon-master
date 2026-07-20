import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { rollExpression } from "@/lib/dice";
import { applyDmMutation } from "@/lib/dm/mutations";
import { handleCastAtPlayer } from "@/lib/dm/cast-tools";
import { resolveSheetRef } from "@/lib/dm/rolls";
import {
  fallingDamageDice,
  trapProfile,
  type TrapSeverity,
} from "@/lib/srd/hazards";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Traps and environmental hazards used to be pure narration routed through the
// generic damage_enemy call, so a "dart trap" or a "40-foot fall" dealt
// whatever the model guessed. apply_hazard makes the server own the numbers:
// falling scales at the PHB 1d6-per-10-feet, a trap's save DC and damage come
// from the DMG severity-by-level table against each victim's own tier, and the
// save itself runs through the same cast_at_player engine every monster save
// uses. Detection stays with check_notice (a trap is spotted by passive
// Perception before it is sprung); this tool is the springing.
//
// This module imports the sheet layer, the cast engine, and mutations; it must
// never be imported by them.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const HAZARD_TOOL_NAMES = ["apply_hazard"] as const;

const SEVERITY_ENUM = ["setback", "dangerous", "deadly"] as const;

export const hazardTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "apply_hazard",
      description:
        "Resolve a trap, a fall, or an environmental hazard against one or more characters with real 5e numbers. The server computes the damage and (for traps) the save DC from the book and applies the save and damage itself, so you never invent them. Use this instead of damage_enemy for any harm from the environment. Call it BEFORE narrating the result and narrate exactly what it reports. Types: 'falling' (pass feet; 1d6 per 10 ft, no save), 'trap' (pass severity; a Dexterity save and damage scaled to each victim's level), or 'generic' (pass your own damage dice, saveAbility, and dc for a bespoke hazard like a gout of flame).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: ["falling", "trap", "generic"],
            description: "Which hazard math to use.",
          },
          characterIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description: "Exact characterIds caught by the hazard.",
          },
          feet: {
            type: "integer",
            description: "falling only: how far the character falls, in feet.",
          },
          severity: {
            type: "string",
            enum: [...SEVERITY_ENUM],
            description:
              "trap only: how dangerous the trap is. setback is a nuisance, dangerous can drop a careless character, deadly can kill.",
          },
          saveAbility: {
            type: "string",
            enum: ["str", "dex", "con", "int", "wis", "cha"],
            description: "trap/generic: the save the hazard forces. Defaults to dex.",
          },
          dc: { type: "integer", description: "generic only: the save DC." },
          damage: {
            type: "string",
            description: "generic only: the damage dice, e.g. 3d6.",
          },
          damageType: {
            type: "string",
            description: "Damage type (bludgeoning, piercing, fire, poison, ...). Resistances apply.",
          },
          halfOnSave: {
            type: "boolean",
            description: "Whether a successful save halves the damage. Defaults to true for traps.",
          },
          condition: {
            type: "string",
            description:
              "Optional condition a failed save also inflicts (e.g. poisoned, restrained).",
          },
          reason: { type: "string", description: "Short note on the hazard." },
        },
        required: ["type", "characterIds"],
      },
    },
  },
];

const hazardSchema = z.object({
  type: z.enum(["falling", "trap", "generic"]),
  characterIds: z.array(z.string()).min(1),
  feet: z.coerce.number().int().min(0).max(1000).optional(),
  severity: z.enum(["setback", "dangerous", "deadly"]).optional(),
  saveAbility: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  dc: z.coerce.number().int().min(1).max(30).optional(),
  damage: z.string().max(30).optional(),
  damageType: z.string().max(30).optional(),
  halfOnSave: z.coerce.boolean().optional(),
  condition: z.string().max(40).optional(),
  reason: z.string().optional(),
});

export function handleApplyHazard(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof hazardSchema>;
  try {
    args = hazardSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: apply_hazard needs a type and characterIds." };
  }

  // Resolve the victims once; bad ids are reported, not silently dropped.
  const targets: CharacterSheet[] = [];
  const unknown: string[] = [];
  for (const id of args.characterIds) {
    const stale = resolveSheetRef(id, sheets, sheetsById);
    const sheet = stale ? getSheetById(stale.id) ?? stale : null;
    if (sheet && !targets.some((entry) => entry.id === sheet.id)) {
      targets.push(sheet);
    } else if (!sheet) {
      unknown.push(id);
    }
  }
  if (!targets.length) {
    return { error: `No valid characterIds${unknown.length ? `: ${unknown.join(", ")}` : ""}.` };
  }

  const source = (args.reason ?? "").trim() || defaultSource(args);
  const damageType =
    args.damageType?.trim() || (args.type === "falling" ? "bludgeoning" : "piercing");

  // Falling has no save: flat bludgeoning applied straight to each victim.
  if (args.type === "falling") {
    const dice = fallingDamageDice(args.feet ?? 0);
    if (dice === "0") {
      return { ok: true, type: "falling", feet: args.feet ?? 0, note: "Too short a fall to hurt." };
    }
    const perTarget = targets.map((sheet) => {
      const rolled = rollExpression(dice);
      const applied = applyDmMutation(
        campaign,
        turn.id,
        "apply_damage",
        JSON.stringify({
          characterId: sheet.id,
          amount: rolled.total,
          type: damageType,
          reason: source,
        }),
        sheets,
        sheetsById,
      ).result;
      return { name: sheet.name, damage: rolled.total, ...applied };
    });
    return {
      ok: true,
      type: "falling",
      feet: args.feet ?? 0,
      dice,
      results: perTarget,
      note: `${dice} bludgeoning to each; the server applied it.`,
    };
  }

  // trap / generic: a save-then-damage effect. Each victim gets their own
  // profile (a trap scales to that character's level) and runs through the
  // shared cast_at_player engine, so conditions, resistances, and the save
  // roll are all handled the same way as a monster's breath weapon.
  const halfOnSave = args.halfOnSave ?? true;
  const perTarget = targets.map((sheet) => {
    let saveAbility: string;
    let dc: number;
    let damage: string;
    if (args.type === "trap") {
      const severity: TrapSeverity = args.severity ?? "dangerous";
      const profile = trapProfile(severity, sheet.level ?? 1);
      saveAbility = args.saveAbility ?? profile.saveAbility;
      dc = profile.saveDc;
      damage = profile.damageDice;
    } else {
      saveAbility = args.saveAbility ?? "dex";
      dc = args.dc ?? 13;
      damage = args.damage ?? "";
    }
    const result = handleCastAtPlayer(
      campaign,
      turn,
      JSON.stringify({
        characterId: sheet.id,
        source,
        saveAbility,
        dc,
        damage: damage || undefined,
        damageType,
        halfOnSave,
        condition: args.condition,
      }),
      sheets,
      sheetsById,
    );
    return { name: sheet.name, ...result };
  });

  return {
    ok: true,
    type: args.type,
    ...(args.type === "trap" ? { severity: args.severity ?? "dangerous" } : {}),
    results: perTarget,
    note: "Saves and damage applied by the server; narrate the outcome per character.",
  };
}

function defaultSource(args: z.infer<typeof hazardSchema>): string {
  if (args.type === "falling") return "the fall";
  if (args.type === "trap") return "a trap";
  return "the hazard";
}
