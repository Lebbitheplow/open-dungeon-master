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

// Death-save track for a character at 0 HP. Null = not dying. Managed by
// the server death engine (src/lib/dm/death.ts); never player- or
// model-writable directly.
export const deathSavesSchema = z
  .object({
    successes: z.number().int().min(0).max(3),
    failures: z.number().int().min(0).max(3),
    stable: z.boolean(),
    dead: z.boolean(),
  })
  .nullable();
export type DeathSaves = z.infer<typeof deathSavesSchema>;

export const proficienciesSchema = z.object({
  saves: z.array(z.enum(ABILITIES)).max(6),
  skills: z.array(z.string().max(40)).max(18),
  // Skills with doubled proficiency (rogue/bard expertise). The .default
  // heals rows stored before the field existed.
  expertise: z.array(z.string().max(40)).max(6).default([]),
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
  // Worn/wielded right now: drives the derived AC (src/lib/srd/armor.ts).
  // Optional so rows written before the field keep validating; when NO item
  // on a sheet carries it, the AC engine treats everything as worn.
  equipped: z.boolean().optional(),
  // Magic item currently attuned. Capped at 3 per character by patchSheet.
  attuned: z.boolean().optional(),
});
export type EquipmentItem = z.infer<typeof equipmentItemSchema>;

// A class feature, racial trait, feat, player-made class choice, or
// story-granted ability. `source` drives regranting: "class" and "race"
// entries are recomputed from SRD data on level-up while the others are
// always preserved. "choice" is how a player's pick within a class feature
// is stored (a fighting style: "Fighting Style: Archery"), which is why it
// survives the regrant that wipes the plain "Fighting Style" entry.
export const sheetFeatureSchema = z.object({
  name: z.string().trim().min(1).max(80),
  source: z.enum(["class", "race", "background", "feat", "choice", "story"]).default("story"),
  level: z.number().int().min(1).max(20).optional(),
});
export type SheetFeature = z.infer<typeof sheetFeatureSchema>;

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

// One Ability Score Improvement choice (earned at levels 4/8/12/16/19):
// +2 to one ability, +1 to two abilities, or a feat instead.
export const asiChoiceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("plus2"), ability: z.enum(ABILITIES) }),
  z.object({
    mode: z.literal("plus1x2"),
    abilities: z.tuple([z.enum(ABILITIES), z.enum(ABILITIES)]),
  }),
  z.object({ mode: z.literal("feat"), feat: z.string().trim().min(1).max(80) }),
]);
export type AsiChoice = z.infer<typeof asiChoiceSchema>;

// Payload for creating a sheet. HP/AC arrive explicit (the creation UI
// suggests derived values, the player can adjust before saving).
export const createSheetSchema = z.object({
  name: z.string().trim().min(1).max(60),
  race: z.string().trim().min(1).max(60),
  class: z.string().trim().min(1).max(60),
  subclass: z.string().trim().max(60).default(""),
  background: z.string().trim().max(60).default(""),
  alignment: z.string().trim().max(30).default(""),
  gender: z.string().trim().max(30).default(""),
  // Free-text physical description; feeds the auto-generated portrait.
  appearance: z.string().trim().max(500).default(""),
  abilities: abilityScoresSchema,
  maxHp: z.number().int().min(1).max(500),
  ac: z.number().int().min(1).max(30),
  // True = `ac` is a hand-set number the armor engine must leave alone.
  // False = the server derives it from equipped armor on every write
  // (src/lib/srd/armor.ts). Deliberately NOT defaulted: a payload that omits
  // it is a library character saved before the engine existed, and createSheet
  // pins those so nobody's stored character loses their armor class.
  acOverride: z.boolean().optional(),
  speed: z.number().int().min(0).max(120).default(30),
  hitDice: hitDiceSchema,
  proficiencies: proficienciesSchema,
  equipment: z.array(equipmentItemSchema).max(60).default([]),
  gold: z.number().int().min(0).max(1000000).default(0),
  feats: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  features: z.array(sheetFeatureSchema).max(80).default([]),
  // The ASI choices baked into `abilities`, in threshold order. Stored so
  // instantiating at a lower campaign level can reverse the extra ones.
  asiChoices: z.array(asiChoiceSchema).max(5).default([]),
  // Choices a race offers rather than fixes (half-elf's two +1 bumps and
  // two skills, high elf's cantrip, dwarf's tool). Their effects are baked
  // into `abilities` and `proficiencies`; these are stored so reopening the
  // builder can rehydrate the exact picks instead of guessing.
  racialChoices: z
    .object({
      asi: z.array(z.enum(ABILITIES)).max(3).default([]),
      skills: z.array(z.string().trim().min(1).max(40)).max(4).default([]),
      cantrip: z.string().trim().max(80).default(""),
      tool: z.string().trim().max(60).default(""),
    })
    .optional(),
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
  // Setting `ac` by hand implies an override; clear the flag to hand the
  // armor class back to the engine.
  ac: z.number().int().min(1).max(30).optional(),
  acOverride: z.boolean().optional(),
  xp: z.number().int().min(0).max(1000000).optional(),
  level: z.number().int().min(1).max(20).optional(),
  gold: z.number().int().min(0).max(1000000).optional(),
  conditions: z.array(z.string().trim().min(1).max(40)).max(15).optional(),
  equipment: z.array(equipmentItemSchema).max(60).optional(),
  hitDice: hitDiceSchema.optional(),
  spellcasting: spellcastingSchema.optional(),
  feats: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  features: z.array(sheetFeatureSchema).max(80).optional(),
  // Level-up ASIs change ability scores, so players may patch them.
  abilities: abilityScoresSchema.optional(),
  // Level-up expertise picks (rogue/bard); the server keeps only skills the
  // sheet is actually proficient in.
  expertise: z.array(z.string().max(40)).max(6).optional(),
  subclass: z.string().trim().max(60).optional(),
  portrait: attachmentSchema.nullable().optional(),
  notes: z.string().max(4000).optional(),
  backstory: z.string().trim().max(2000).optional(),
});
export type PatchSheetInput = z.infer<typeof patchSheetSchema>;

// Everything the DM engine and the party lead may change, including the
// identity fields players cannot touch in-play. Players stay limited to
// patchSheetSchema.
// Limited-use class-resource counters (Rage, Ki, Second Wind...), keyed by
// resource id from src/lib/srd/class-resources.ts. Auto-populated from the
// features list; spent by use_resource; refilled by rests.
export const resourcesSchema = z.record(
  z.string().max(40),
  z.object({
    max: z.number().int().min(0).max(200),
    used: z.number().int().min(0).max(200),
  }),
);
export type SheetResources = z.infer<typeof resourcesSchema>;

// Duration/save metadata for active conditions, keyed by condition name.
// Lives NEXT TO the plain `conditions` string list so its consumers never
// change; the server maintains both together (src/lib/dm/condition-logic.ts).
export const conditionMetaSchema = z.record(
  z.string().max(40),
  z.object({
    rounds: z.number().int().min(1).max(100).optional(),
    saveEnds: z
      .object({
        ability: z.enum(ABILITIES),
        dc: z.number().int().min(1).max(30),
      })
      .optional(),
  }),
);
export type ConditionMetaMap = z.infer<typeof conditionMetaSchema>;

// An active Wild Shape form. The druid's own hit points are untouched while
// shaped (5e: they are remembered and returned to on revert); damage lands
// on the beast pool and only the excess spills through. Null when the
// character is in their own body.
export const wildShapeSchema = z
  .object({
    form: z.string().trim().min(1).max(60),
    beastHp: z.number().int().min(0).max(300),
    beastMaxHp: z.number().int().min(1).max(300),
    beastAc: z.number().int().min(1).max(30),
  })
  .nullable();
export type WildShape = z.infer<typeof wildShapeSchema>;

export const fullPatchSheetSchema = patchSheetSchema.extend({
  name: z.string().trim().min(1).max(60).optional(),
  race: z.string().trim().min(1).max(60).optional(),
  class: z.string().trim().min(1).max(60).optional(),
  background: z.string().trim().max(60).optional(),
  alignment: z.string().trim().max(30).optional(),
  speed: z.number().int().min(0).max(120).optional(),
  abilities: abilityScoresSchema.optional(),
  proficiencies: proficienciesSchema.optional(),
  // Engine-managed fields; included here so audit pre-images round-trip
  // through undo, but never exposed to update_sheet or player patches.
  deathSaves: deathSavesSchema.optional(),
  concentratingOn: z.string().trim().max(80).nullable().optional(),
  conditionMeta: conditionMetaSchema.optional(),
  resources: resourcesSchema.optional(),
  wildShape: wildShapeSchema.optional(),
  // Exhaustion level 0-6 with real mechanical effects (condition-logic.ts).
  exhaustion: z.number().int().min(0).max(6).optional(),
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
  // Always the character's real armor class: derived from equipped armor on
  // every write unless acOverride pins it (src/lib/srd/armor.ts).
  ac: number;
  acOverride: boolean;
  speed: number;
  hitDice: HitDice;
  proficiencies: Proficiencies;
  equipment: EquipmentItem[];
  gold: number;
  feats: string[];
  features: SheetFeature[];
  spellcasting: Spellcasting;
  conditions: string[];
  conditionMeta: ConditionMetaMap;
  resources: SheetResources;
  // Active beast form, or null. Managed by the server (use_resource +
  // apply_damage in src/lib/dm/mutations.ts).
  wildShape: WildShape;
  exhaustion: number;
  deathSaves: DeathSaves;
  // Spell this character is concentrating on; null when none. Managed by
  // the server (src/lib/dm/concentration.ts).
  concentratingOn: string | null;
  portrait: SheetAttachment | null;
  notes: string;
  backstory: string;
  // AI companion party member: the sheet belongs to an unloginable bot user
  // and the DM drives it (src/lib/dm/companion-tools.ts). 'party' travels
  // with the party until dismissed; 'guest' is a scene-scoped ally.
  isCompanion: boolean;
  companionKind: "party" | "guest" | null;
  // Personality/voice brief the DM roleplays the companion from.
  personality: string;
  createdAt: string;
  updatedAt: string;
};
