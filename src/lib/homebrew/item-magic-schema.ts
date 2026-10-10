import { z } from "zod";
import { isValidExpression } from "@/lib/dice";
import type { ArmorRiders, ChargeRule, GearDice, WeaponRiders } from "@/lib/srd/magic-gear";
import type { ItemSpell } from "@/lib/srd/item-spells";
import type { AttunementRule } from "@/lib/srd/magic-items";

// The magic of a workshop item in the same words the SRD's magic items are
// run by (src/lib/srd/magic-gear.ts, item-check-riders.ts, item-spells.ts,
// magic-items.ts): a weapon's bonus and the dice that ride its hits, an
// armour's bonus and what it forgives, charges and how they come back, the
// spells charges cast, what a carried item adds to checks, who may attune,
// and a curse. A homebrew item used to carry five effect kinds and nothing
// else, so a workshop +1 sword hit like a plain one unless "+1" was in its
// name, a Flame Tongue copy burned nobody and a homebrew wand had charges
// nothing ever counted.

export const SKILL_IDS = [
  "acrobatics", "animal_handling", "arcana", "athletics", "deception", "history",
  "insight", "intimidation", "investigation", "medicine", "nature", "perception",
  "performance", "persuasion", "religion", "sleight_of_hand", "stealth", "survival",
] as const;

export const CLASS_WORDS = [
  "barbarian", "bard", "cleric", "druid", "fighter", "monk",
  "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
] as const;

const PROPERTIES = ["ammunition", "finesse", "heavy", "light", "loading", "reach", "thrown", "two-handed", "versatile"] as const;

const int = (min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : value),
    z.number().int().min(min).max(max),
  );
const word = (max = 40) => z.string().trim().min(1).max(max).transform((value) => value.toLowerCase());
const words = (count = 14) => z.array(word()).max(count);
const dice = z
  .string()
  .trim()
  .max(40)
  .transform((value) => value.replace(/\s+/g, ""))
  .refine((value) => isValidExpression(value), "is not dice the table can roll");
const flag = z.boolean().optional();

const gearDice = z.object({
  dice,
  // "weapon": the weapon's own damage type.
  type: word(),
  vs: words().optional(),
  notVs: words().optional(),
  ranged: flag,
});

export const weaponRidersSchema = z.object({
  bonus: int(-3, 3).optional(),
  bonusVs: z.object({ types: words(), bonus: int(1, 3) }).optional(),
  damageType: word().optional(),
  properties: z.array(z.enum(PROPERTIES)).max(PROPERTIES.length).optional(),
  rangeFt: int(5, 600).optional(),
  longRangeFt: int(5, 1_200).optional(),
  extra: z.array(gearDice).max(4).optional(),
  critExtra: z.array(gearDice).max(4).optional(),
});

export const armorRidersSchema = z.object({
  bonus: int(-3, 3).optional(),
  noStrength: flag,
  noStealthPenalty: flag,
  proficientAnyway: flag,
  critProof: flag,
});

export const chargeRuleSchema = z.object({
  max: z.union([int(0, 50), dice]),
  regain: z.union([z.literal("all"), dice]).optional(),
  lastChargeD20: flag,
  spentAway: flag,
  daily: z.string().trim().min(1).max(200).optional(),
});

export const checkRidersSchema = z.object({
  bonus: int(-5, 5).optional(),
  skillBonus: z.partialRecord(z.enum(SKILL_IDS), int(-10, 10)).optional(),
  advantage: z.array(z.enum(SKILL_IDS)).max(SKILL_IDS.length).optional(),
});

export const itemSpellSchema = z.object({
  spell: z.string().trim().min(1).max(60),
  charges: int(0, 50),
  level: int(0, 9),
  perCharge: flag,
  maxLevel: int(1, 9).optional(),
  dc: int(1, 30).optional(),
});

export const attunedBySchema = z.object({
  text: z.string().trim().min(1).max(120),
  classes: z.array(z.enum(CLASS_WORDS)).max(12).optional(),
  spellcaster: flag,
  alignment: word().optional(),
  race: word().optional(),
});

// The blocks an item may carry beside its weapon, armour and effects.
export const itemMagicSchema = z.object({
  weaponRiders: weaponRidersSchema.optional(),
  armorRiders: armorRidersSchema.optional(),
  charges: chargeRuleSchema.optional(),
  checks: checkRidersSchema.optional(),
  spells: z.array(itemSpellSchema).max(24).optional(),
  attunedBy: attunedBySchema.optional(),
  cursed: flag,
  carried: flag,
});

export type ItemMagic = {
  weaponRiders?: WeaponRiders;
  armorRiders?: ArmorRiders;
  charges?: ChargeRule;
  checks?: { bonus?: number; skillBonus?: Partial<Record<(typeof SKILL_IDS)[number], number>>; advantage?: string[] };
  spells?: ItemSpell[];
  attunedBy?: AttunementRule;
  cursed?: boolean;
  carried?: boolean;
};

// Compile-time guard: the checked blocks are the engine's shapes.
const drift: ItemMagic = {} as z.infer<typeof itemMagicSchema>;
const diceDrift: GearDice = {} as z.infer<typeof gearDice>;
void drift;
void diceDrift;

// The item's magic blocks out of a raw data blob, or why not. A legacy
// `charges` of { max, recharge: "dawn" } reads as charges that all come back
// at dawn, which is what the old form meant by it.
export function checkItemMagic(raw: Record<string, unknown>): { magic: ItemMagic } | { error: string } {
  const source = { ...raw };
  const charges = source.charges as Record<string, unknown> | undefined;
  if (charges && typeof charges === "object" && charges.recharge !== undefined && charges.regain === undefined) {
    const { recharge, ...rest } = charges;
    source.charges = /dawn|day|long rest/i.test(String(recharge ?? "")) ? { ...rest, regain: "all" } : rest;
  }
  const picked = Object.fromEntries(
    ["weaponRiders", "armorRiders", "charges", "checks", "spells", "attunedBy", "cursed", "carried"]
      .filter((key) => source[key] !== undefined && source[key] !== null)
      .map((key) => [key, source[key]]),
  );
  const parsed = itemMagicSchema.safeParse(picked);
  if (parsed.success) {
    return { magic: parsed.data as ItemMagic };
  }
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? issue.path.join(".") : "magic";
  return { error: `The item's ${where} ${issue?.message ?? "is not valid"}.` };
}
