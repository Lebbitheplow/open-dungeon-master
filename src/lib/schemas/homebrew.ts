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

// Deliberately permissive: homebrew is freeform by nature. name + desc are
// required; kind-specific fields are optional hints the pickers understand.
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
