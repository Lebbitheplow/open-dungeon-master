import { z } from "zod";

export const HOMEBREW_KINDS = [
  "spell",
  "feat",
  "item",
  "race",
  "background",
  "archetype",
  "monster",
] as const;

export type HomebrewKind = (typeof HOMEBREW_KINDS)[number];

// The snapshot of a homebrew item's mechanics that rides on a sheet's
// equipment line (src/lib/homebrew/gear.ts). Loose here because the pure
// normalizers own the shape; this only keeps a hand-edited sheet from
// carrying something that is not an object.
const abilityEnum = z.enum(["str", "dex", "con", "int", "wis", "cha"]);

export const magicItemEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ac_bonus"), amount: z.number() }),
  z.object({ kind: z.literal("ac_unarmored"), amount: z.number() }),
  z.object({ kind: z.literal("save_bonus"), amount: z.number() }),
  z.object({ kind: z.literal("set_ability"), ability: abilityEnum, score: z.number() }),
  z.object({ kind: z.literal("resistance"), types: z.array(z.string()) }),
]);

// The same shapes as SrdWeapon and SrdArmor (src/lib/srd/weapons.ts,
// armor.ts), so a snapshot type-checks straight into the engines.
export const homebrewGearSchema = z.object({
  weapon: z
    .object({
      name: z.string(),
      category: z.enum(["simple", "martial", "firearm", "exotic"]),
      kind: z.enum(["melee", "ranged"]),
      damage: z.string(),
      properties: z.array(z.string()).optional(),
      rangeFt: z.number().optional(),
    })
    .optional(),
  armor: z
    .object({
      name: z.string(),
      category: z.enum(["light", "medium", "heavy", "shield"]),
      baseAc: z.number(),
      dexCap: z.number().optional(),
      strengthRequirement: z.number().optional(),
      stealthDisadvantage: z.boolean().optional(),
      weightLb: z.number(),
    })
    .optional(),
  magic: z
    .object({
      requiresAttunement: z.boolean(),
      effects: z.array(magicItemEffectSchema),
    })
    .optional(),
  weight: z.number().min(0).optional(),
});
export type HomebrewGearSnapshot = z.infer<typeof homebrewGearSchema>;

// Deliberately permissive at the wire: the route normalizes per kind
// through src/lib/homebrew/gear.ts, which is where a weapon's damage
// expression is refused and an armour's class is clamped. name + desc are
// required; kind-specific fields are what the normalizers read.
export const homebrewDataSchema = z
  .object({
    desc: z.string().trim().max(8_000).default(""),
    // spell hints
    level: z.number().int().min(0).max(9).optional(),
    school: z.string().trim().max(40).optional(),
    classes: z.array(z.string().trim().max(40)).max(20).optional(),
    ritual: z.boolean().optional(),
    concentration: z.boolean().optional(),
    // item hints
    itemKind: z.enum(["weapon", "armor", "gear", "magic_item"]).optional(),
    rarity: z.string().trim().max(40).optional(),
    cost: z.string().trim().max(40).optional(),
    // class/archetype hints
    classSlug: z.string().trim().max(60).optional(),
  })
  .loose();

export const createHomebrewSchema = z.object({
  kind: z.enum(HOMEBREW_KINDS),
  name: z.string().trim().min(1).max(80),
  data: homebrewDataSchema.default({ desc: "" }),
});

export const patchHomebrewSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  data: homebrewDataSchema.optional(),
});

export type CreateHomebrewInput = z.infer<typeof createHomebrewSchema>;
