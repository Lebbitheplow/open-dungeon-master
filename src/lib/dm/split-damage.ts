// The damage tray: one rolled number, several targets, a multiplier each.
//
// 5e is full of moments where the same damage lands differently on different
// creatures for reasons no save covers: one was behind cover, one has an
// immunity the fiction just revealed, one is diving clear. Foundry's GMs do
// this with a tray of applied damage and a full/half/double/none button per
// token, and it is the one combat action ODM had no way to express: a person
// would have had to run damage_enemy and apply_damage separately, doing the
// halving in their head.
//
// The multiplier is the only thing this adds. Everything else goes through
// the paths that already exist, so resistances, immunities, temp hit points,
// death saves and concentration all resolve exactly as they always do.
import { z } from "zod";
import { getActiveEncounter } from "@/lib/db/encounters";
import { applyDmMutation } from "@/lib/dm/mutations";
import { applyEnemyDamage, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const SPLIT_DAMAGE_TOOL_NAMES = ["split_damage"] as const;

const MULTIPLIERS = {
  none: 0,
  half: 0.5,
  full: 1,
  double: 2,
} as const;

export type DamageShare = keyof typeof MULTIPLIERS;

const targetSchema = z.object({
  enemyId: z.string().optional(),
  characterId: z.string().optional(),
  share: z.enum(["none", "half", "full", "double"]).default("full"),
});

const splitSchema = z.object({
  amount: z.coerce.number().int().min(1).max(500),
  type: z.string().max(30).optional(),
  targets: z.array(targetSchema).min(1).max(20),
  reason: z.string().optional(),
});

export const splitDamageTool = {
  type: "function",
  function: {
    name: "split_damage",
    description:
      "Apply ONE damage total to several creatures at once, each at their own share of it: full, half, double, or none. Use it when the same blow lands differently on different targets for a reason no saving throw covers (cover, a revealed immunity, someone diving clear). The server halves and doubles, then applies each share through the ordinary damage rules, so resistances, temporary hit points and death saves all still resolve themselves. For an area effect with a save, use aoe_damage instead.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        amount: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "The damage rolled, before any share is taken of it.",
        },
        type: { type: "string", description: "Damage type, e.g. fire, bludgeoning." },
        targets: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              enemyId: { type: "string" },
              characterId: { type: "string" },
              share: { type: "string", enum: ["none", "half", "full", "double"] },
            },
          },
          description: "One entry per creature: its id, and how much of the total it takes.",
        },
        reason: { type: "string" },
      },
      required: ["amount", "targets"],
    },
  },
} as const;

export function handleSplitDamage(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof splitSchema>;
  try {
    args = splitSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "split_damage needs an amount and at least one target." };
  }

  const encounter = getActiveEncounter(campaign.id);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const target of args.targets) {
    // A share of zero is a real answer ("that one is immune"), not a
    // no-op to complain about, so it is reported rather than applied.
    const share = MULTIPLIERS[target.share];
    if (share === 0) {
      skipped.push(target.enemyId ?? target.characterId ?? "someone");
      continue;
    }
    // Halving rounds down, as every 5e halving does.
    const amount = Math.max(1, Math.floor(args.amount * share));

    if (target.enemyId) {
      if (!encounter) {
        skipped.push(`${target.enemyId} (no fight running)`);
        continue;
      }
      const enemy = resolveEnemyRef(encounter.id, target.enemyId);
      if (!enemy || enemy.status !== "alive") {
        skipped.push(`${target.enemyId} (not a living enemy)`);
        continue;
      }
      const result = applyEnemyDamage(
        campaign,
        turn,
        encounter,
        enemy,
        amount,
        sheets,
        sheetsById,
        args.type,
      );
      applied.push(
        "error" in result
          ? `${enemy.displayName}: ${String(result.error)}`
          : `${enemy.displayName} takes ${amount}${result.dead ? " and falls" : ""}`,
      );
      continue;
    }

    if (target.characterId) {
      const outcome = applyDmMutation(
        campaign,
        turn.id,
        "apply_damage",
        JSON.stringify({
          characterId: target.characterId,
          amount,
          type: args.type,
          reason: args.reason,
        }),
        sheets,
        sheetsById,
      );
      const name = sheetsById.get(target.characterId)?.name ?? target.characterId;
      applied.push(
        "error" in outcome.result
          ? `${name}: ${String(outcome.result.error)}`
          : `${name} takes ${amount}`,
      );
      continue;
    }

    skipped.push("a target with no id");
  }

  if (!applied.length && !skipped.length) {
    return { error: "None of those targets could be found." };
  }
  return {
    ok: true,
    applied,
    ...(skipped.length ? { untouched: skipped } : {}),
    note: "The server already applied all of this. Narrate it; do not apply it again.",
  };
}
