import { z } from "zod";

// A creature a spell or a feature made (Conjure Animals' wolves, Animate
// Dead's skeleton, a Battle Smith's steel defender). It is a guest companion
// sheet whose own numbers are the creature's stat block (abilities, hit
// points, armor class, speed); this record carries what a character sheet has
// no place for: the natural attacks, Multiattack, the damage the creature
// shrugs off, and who made it with what, so the spell's end, its duration or
// 0 hit points send it away (src/lib/dm/summon-store.ts).
export const summonAttackSchema = z.object({
  name: z.string().trim().min(1).max(40),
  toHit: z.number().int().min(-5).max(30),
  // A dice expression the dice engine accepts ("2d4+2"): the hit's own type.
  damage: z.string().trim().min(1).max(40),
  type: z.string().trim().max(20),
  // Dice of another type riding the hit ("plus 1d4 cold"), each meeting its
  // own resistance.
  riders: z
    .array(z.object({ dice: z.string().trim().min(1).max(20), type: z.string().trim().max(20) }))
    .max(2)
    .optional(),
  // Melee reach in feet (5 when absent), or a ranged attack's normal and long
  // range in feet.
  reach: z.number().int().min(5).max(30).optional(),
  range: z.number().int().min(5).max(600).optional(),
  longRange: z.number().int().min(5).max(1200).optional(),
});
export type SummonAttack = z.infer<typeof summonAttackSchema>;

export const summonSchema = z.object({
  // The spell or feature that made it, and the character who did.
  spell: z.string().trim().min(1).max(80),
  casterId: z.string().trim().min(1).max(80),
  casterName: z.string().trim().max(60).default(""),
  // The stat block's name ("Wolf"), creature type, size and challenge rating.
  form: z.string().trim().min(1).max(60),
  creatureType: z.string().trim().max(30).default(""),
  size: z.string().trim().max(12).default("Medium"),
  cr: z.number().min(0).max(30).default(0),
  attacks: z.array(summonAttackSchema).max(4).default([]),
  attacksPerTurn: z.number().int().min(1).max(4).default(1),
  resist: z.string().trim().max(200).default(""),
  immune: z.string().trim().max(200).default(""),
  vulnerable: z.string().trim().max(120).default(""),
  conditionImmune: z.string().trim().max(200).default(""),
  // One line of the block's traits for whoever runs the creature.
  traits: z.string().trim().max(400).default(""),
  // The spell ends it when concentration does; without concentration its
  // duration (the "summoned" condition on this sheet) or 0 hit points do.
  concentration: z.boolean().default(false),
  // Conjure Elemental and Conjure Fey: when concentration breaks the
  // creature stays and turns on the party (an enemy with this stat block).
  hostileOnBreak: z.boolean().optional(),
  // Every creature of one casting shares this id (one group initiative).
  castId: z.string().trim().max(40).default(""),
});
export type SheetSummon = z.infer<typeof summonSchema>;
