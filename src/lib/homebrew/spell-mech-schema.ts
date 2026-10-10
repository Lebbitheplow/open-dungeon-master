import { z } from "zod";
import { isValidExpression } from "@/lib/dice";
import type { SpellMech } from "@/lib/srd/spell-mech-types";
import { ROUND_CEILING } from "@/lib/schemas/condition-meta";

// The whole of a spell's mechanics block (src/lib/srd/spell-mech-types.ts),
// checked at the homebrew boundary. A homebrew spell used to keep five
// fields of it (how it resolves, the save, half on a save, the damage type,
// one condition or buff), so a copy of Web lost its escape check, a copy of
// Fireball its area, a copy of Spirit Guardians its aura and a copy of
// Revivify the revival itself. The engines read every field below for the
// SRD's spells; a workshop spell now carries the same block, bounded so a
// stored row can never ask the engine for something it cannot roll.

const ability = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
const word = (max = 40) => z.string().trim().min(1).max(max).transform((value) => value.toLowerCase());
const words = (count = 13) => z.array(word()).max(count);
const dice = z
  .string()
  .trim()
  .max(40)
  .transform((value) => value.replace(/\s+/g, ""))
  .refine((value) => isValidExpression(value), "is not dice the table can roll");
// A number out of range is pulled into it, as the bestiary does: a DM who
// writes a 999,999-round curse meant a long one. Only a value that is not a
// number at all is refused.
const int = (min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : value),
    z.number().int().min(min).max(max),
  );
// A year in rounds, the same ceiling conditions carry (Geas runs thirty days).
const rounds = int(1, ROUND_CEILING);
const level = int(0, 9);
const feet = int(0, 5_280);

const turnDamage = z.object({
  dice,
  perSlotLevel: dice.optional(),
  baseLevel: level,
  type: word(),
  noSave: z.boolean().optional(),
});

const conditionBase = {
  name: word(),
  rounds: rounds.optional(),
  // [the slot level it starts at, its rounds or null for "until dispelled"], ascending (Geas).
  roundsBySlot: z.array(z.tuple([level, rounds.nullable()])).max(9).optional(),
  saveEnds: z.boolean().optional(),
  also: words(4).optional(),
  variants: words(12).optional(),
  endsOnDamage: z.boolean().optional(),
  saveOnDamage: z.enum(["normal", "advantage"]).optional(),
  hpAtMost: int(1, 1_000).optional(),
  noInitialSave: z.boolean().optional(),
  turnStart: turnDamage.optional(),
  turnEnd: z
    .object({
      dice: dice.optional(),
      perSlotLevel: dice.optional(),
      baseLevel: level,
      type: word().optional(),
      tally: z.object({ fails: int(1, 5), becomes: word() }).optional(),
    })
    .optional(),
  endsWith: z.enum(["target turn end", "caster turn start"]).optional(),
  choices: z.record(z.string().trim().min(1).max(40), words(4)).optional(),
  escape: z.array(z.enum(["str", "dex", "int"])).max(3).optional(),
  escapeDc: int(1, 30).optional(),
  escapeSave: z.literal("wis").optional(),
  variantRules: z
    .record(
      z.string().trim().min(1).max(40),
      z.object({ rounds: rounds.optional(), saveEnds: z.boolean().optional(), endsOnDamage: z.boolean().optional() }),
    )
    .optional(),
};

const riders = z.object({
  pushFeet: feet.optional(),
  hpFloor: int(0, 1_000).optional(),
  shrinksMaxHp: z.boolean().optional(),
  concentrationSave: z.literal("con").optional(),
  losesAction: z.boolean().optional(),
  gripSave: z.literal("con").optional(),
  advantageInFight: z.boolean().optional(),
  saveDisadvantageFor: words().optional(),
  maxDamageFor: words().optional(),
  hpTiers: z
    .array(
      z.object({
        atMost: int(0, 1_000),
        conditions: words(4),
        rounds: rounds.optional(),
        dies: z.boolean().optional(),
      }),
    )
    .max(6)
    .optional(),
  disintegrates: z.boolean().optional(),
  clusterFeet: feet.optional(),
  damageIgnoresSave: z.boolean().optional(),
  returnsHome: words().optional(),
});

export const spellMechSchema = z.object({
  resolution: z.enum(["attack", "save", "auto", "heal", "buff", "summon", "utility"]),
  save: ability.optional(),
  halfOnSave: z.boolean().optional(),
  damageType: word().optional(),
  secondType: word().optional(),
  attack: z.enum(["melee", "ranged"]).optional(),
  condition: z.object(conditionBase).optional(),
  noDamage: z.boolean().optional(),
  buff: z
    .object({
      condition: word(),
      target: z.enum(["self", "ally", "allies"]),
      rounds,
      variants: words(8).optional(),
      tempHp: z
        .object({
          base: int(0, 500),
          perSlotLevel: int(0, 100).optional(),
          dice: dice.optional(),
        })
        .optional(),
      maxHp: z.object({ base: int(0, 500), perSlotLevel: int(0, 100).optional() }).optional(),
      tempHpEachTurn: z.boolean().optional(),
      bySlot: z.array(z.tuple([level, word()])).max(9).optional(),
    })
    .optional(),
  aura: z
    .object({
      radiusFeet: feet,
      save: ability,
      dice,
      perSlotLevel: dice.optional(),
      baseLevel: level,
      type: word(),
      halfOnSave: z.boolean(),
    })
    .optional(),
  dice: z.object({ base: dice, perSlotLevel: dice.optional(), baseLevel: level }).optional(),
  darts: z.object({ count: int(1, 20), perSlotLevel: int(0, 10), each: dice }).optional(),
  attacks: z
    .object({ count: int(1, 10), perSlotLevel: int(0, 5).optional(), byCasterLevel: z.boolean().optional() })
    .optional(),
  hitPointPool: z
    .object({
      dice,
      perSlotLevel: dice,
      condition: word(),
      rounds,
      immuneTypes: words().optional(),
      immuneCondition: word().optional(),
      skipConditions: words(6).optional(),
      endsOnDamage: z.boolean().optional(),
    })
    .optional(),
  targets: z.object({ count: int(1, 100), perSlotLevel: int(0, 10).optional() }).optional(),
  area: z.boolean().optional(),
  areaFeet: feet.optional(),
  repeat: z.enum(["action", "bonus", "free"]).optional(),
  targetTypes: words(14).optional(),
  immuneTypes: words(14).optional(),
  immuneIfImmuneTo: word().optional(),
  revive: z
    .object({
      hp: z.enum(["one", "all"]),
      withinMinutes: int(1, 200_000_000),
      ordeal: z.boolean().optional(),
    })
    .optional(),
  healing: z.object({ flat: int(1, 1_000), perSlotLevel: int(0, 100).optional() }).optional(),
  healPool: int(1, 2_000).optional(),
  dispel: z.boolean().optional(),
  cures: z.object({ conditions: words(10), all: z.boolean().optional() }).optional(),
  riders: riders.optional(),
  maxHpDice: dice.optional(),
  regainEachTurn: int(1, 100).optional(),
  healNoModifier: z.boolean().optional(),
  note: z.string().trim().max(400).optional(),
});

// The parsed block is a SpellMech; the line below fails to compile the day
// the two drift apart.
const drift: SpellMech = {} as z.infer<typeof spellMechSchema>;
void drift;

// The block, or why not: the first problem, named by its field.
export function checkSpellMech(raw: unknown): { mech: SpellMech } | { error: string } {
  const parsed = spellMechSchema.safeParse(raw);
  if (parsed.success) {
    return { mech: parsed.data as SpellMech };
  }
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? issue.path.join(".") : "the block";
  return { error: `The spell's ${where} ${issue?.message ?? "is not valid"}.` };
}
