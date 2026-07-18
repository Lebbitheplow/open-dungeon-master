import { z } from "zod";

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];

export const abilityScoresSchema = z.object({
  str: z.number().int().min(1).max(30),
  dex: z.number().int().min(1).max(30),
  con: z.number().int().min(1).max(30),
  int: z.number().int().min(1).max(30),
  wis: z.number().int().min(1).max(30),
  cha: z.number().int().min(1).max(30),
});
export type AbilityScores = z.infer<typeof abilityScoresSchema>;

export const hitDiceSchema = z.object({
  die: z.enum(["d6", "d8", "d10", "d12"]),
  total: z.number().int().min(1).max(20),
  spent: z.number().int().min(0).max(20),
});
export type HitDice = z.infer<typeof hitDiceSchema>;

export const proficienciesSchema = z.object({
  saves: z.array(z.enum(ABILITIES)).max(6),
  skills: z.array(z.string().max(40)).max(18),
  languages: z.array(z.string().max(40)).max(12),
  tools: z.array(z.string().max(60)).max(12),
  armor: z.array(z.string().max(40)).max(8),
  weapons: z.array(z.string().max(40)).max(16),
});
export type Proficiencies = z.infer<typeof proficienciesSchema>;

export const equipmentItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  qty: z.number().int().min(1).max(999).default(1),
  // Optional link to a content-db entry (Open5e slug or "homebrew:<id>");
  // free-text items stay valid.
  slug: z.string().trim().max(80).optional(),
});
export type EquipmentItem = z.infer<typeof equipmentItemSchema>;

// Uploaded portrait/avatar reference; restricted to local uploads so a
// sheet can never point the party's browsers at an external host.
export const attachmentSchema = z.object({
  id: z.string().max(80).optional(),
  name: z.string().max(120).optional(),
  type: z.string().max(60).optional(),
  url: z.string().max(300).startsWith("/uploads/"),
});
export type SheetAttachment = z.infer<typeof attachmentSchema>;

export const spellSlotSchema = z.object({
  max: z.number().int().min(0).max(10),
  used: z.number().int().min(0).max(10),
});

export const spellcastingSchema = z
  .object({
    ability: z.enum(["int", "wis", "cha"]),
    slots: z.record(z.string().regex(/^[1-9]$/), spellSlotSchema),
    prepared: z.array(z.string().trim().min(1).max(80)).max(60),
    // Spells known (for known-casters); prepared casters leave this empty
    // and use `prepared` alone.
    known: z.array(z.string().trim().min(1).max(80)).max(80).default([]),
  })
  .nullable();
export type Spellcasting = z.infer<typeof spellcastingSchema>;

// Payload for creating a sheet. HP/AC arrive explicit (the creation UI
// suggests derived values, the player can adjust before saving).
export const createSheetSchema = z.object({
  name: z.string().trim().min(1).max(60),
  race: z.string().trim().min(1).max(60),
  class: z.string().trim().min(1).max(60),
  subclass: z.string().trim().max(60).default(""),
  background: z.string().trim().max(60).default(""),
  alignment: z.string().trim().max(30).default(""),
  abilities: abilityScoresSchema,
  maxHp: z.number().int().min(1).max(500),
  ac: z.number().int().min(1).max(30),
  speed: z.number().int().min(0).max(120).default(30),
  hitDice: hitDiceSchema,
  proficiencies: proficienciesSchema,
  equipment: z.array(equipmentItemSchema).max(60).default([]),
  gold: z.number().int().min(0).max(1000000).default(0),
  feats: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  spellcasting: spellcastingSchema.default(null),
  portrait: attachmentSchema.nullable().default(null),
  notes: z.string().max(4000).default(""),
  // Player-authored backstory, visible to the whole party and woven into
  // the DM prompt (unlike notes, which stay private to the owner).
  backstory: z.string().trim().max(2000).default(""),
});
export type CreateSheetInput = z.infer<typeof createSheetSchema>;

// Fields a player may patch during play.
export const patchSheetSchema = z.object({
  currentHp: z.number().int().min(0).max(500).optional(),
  tempHp: z.number().int().min(0).max(200).optional(),
  maxHp: z.number().int().min(1).max(500).optional(),
  ac: z.number().int().min(1).max(30).optional(),
  xp: z.number().int().min(0).max(1000000).optional(),
  level: z.number().int().min(1).max(20).optional(),
  gold: z.number().int().min(0).max(1000000).optional(),
  conditions: z.array(z.string().trim().min(1).max(40)).max(15).optional(),
  equipment: z.array(equipmentItemSchema).max(60).optional(),
  hitDice: hitDiceSchema.optional(),
  spellcasting: spellcastingSchema.optional(),
  feats: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  subclass: z.string().trim().max(60).optional(),
  portrait: attachmentSchema.nullable().optional(),
  notes: z.string().max(4000).optional(),
  backstory: z.string().trim().max(2000).optional(),
});
export type PatchSheetInput = z.infer<typeof patchSheetSchema>;

// Everything the DM engine and the party lead may change, including the
// identity fields players cannot touch in-play. Players stay limited to
// patchSheetSchema.
export const fullPatchSheetSchema = patchSheetSchema.extend({
  name: z.string().trim().min(1).max(60).optional(),
  race: z.string().trim().min(1).max(60).optional(),
  class: z.string().trim().min(1).max(60).optional(),
  background: z.string().trim().max(60).optional(),
  alignment: z.string().trim().max(30).optional(),
  speed: z.number().int().min(0).max(120).optional(),
  abilities: abilityScoresSchema.optional(),
  proficiencies: proficienciesSchema.optional(),
});
export type FullPatchSheetInput = z.infer<typeof fullPatchSheetSchema>;

export type CharacterSheet = {
  id: string;
  campaignId: string;
  userId: string;
  libraryCharacterId: string | null;
  name: string;
  race: string;
  class: string;
  subclass: string;
  background: string;
  alignment: string;
  level: number;
  xp: number;
  abilities: AbilityScores;
  maxHp: number;
  currentHp: number;
  tempHp: number;
  ac: number;
  speed: number;
  hitDice: HitDice;
  proficiencies: Proficiencies;
  equipment: EquipmentItem[];
  gold: number;
  feats: string[];
  spellcasting: Spellcasting;
  conditions: string[];
  portrait: SheetAttachment | null;
  notes: string;
  backstory: string;
  createdAt: string;
  updatedAt: string;
};
