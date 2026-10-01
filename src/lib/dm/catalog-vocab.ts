// The fixed vocabularies the console's forms pick from, in one place so the
// combat, party and world catalogs offer the same lists.
//
// Why selects and not free text: the engine reads a damage type as a whole
// word (src/lib/dm/damage-logic.ts), so "fier" typed into a box is a
// homebrew type no creature resists, and the troll's regeneration never
// hears about the fire. A pick cannot be misspelled. Conditions keep a way
// out ("Something else") because story conditions are legal
// (src/lib/dm/set-condition.ts canonicalCondition); the SRD ones are offered
// first so the ones the engine enforces are the ones a person reaches for.
//
// Pure: no imports with I/O, so scripts/test-invoke-catalog.mjs loads it and
// checks these lists against the engine's own.
import type { CatalogField } from "@/lib/dm/catalog-types";

type Option = { value: string; label: string };

const titled = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

// The thirteen SRD damage types, the list damage-logic.ts matches against.
export const DAMAGE_TYPE_VALUES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
] as const;

export const DAMAGE_TYPE_OPTIONS: Option[] = DAMAGE_TYPE_VALUES.map((value) => ({
  value,
  label: titled(value),
}));

// The SRD conditions the engine enforces (src/lib/bestiary/kit.ts CONDITIONS).
export const CONDITION_VALUES = [
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled",
  "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone",
  "restrained", "stunned", "unconscious",
] as const;

export const CONDITION_OPTIONS: Option[] = CONDITION_VALUES.map((value) => ({
  value,
  label: titled(value),
}));

// src/lib/dm/hazard-tools.ts SEVERITY_ENUM.
export const TRAP_SEVERITY_OPTIONS: Option[] = [
  { value: "setback", label: "Setback: a nuisance" },
  { value: "dangerous", label: "Dangerous: can drop a careless character" },
  { value: "deadly", label: "Deadly: can kill" },
];

// src/lib/dm/object-damage.ts OBJECT_MATERIALS and OBJECT_SIZES.
export const OBJECT_MATERIAL_VALUES = [
  "cloth", "paper", "rope", "crystal", "glass", "ice", "wood", "bone", "stone",
  "iron", "steel", "mithral", "adamantine",
] as const;

export const OBJECT_MATERIAL_OPTIONS: Option[] = OBJECT_MATERIAL_VALUES.map((value) => ({
  value,
  label: titled(value),
}));

export const OBJECT_SIZE_OPTIONS: Option[] = [
  { value: "tiny", label: "Tiny (a bottle, a lock)" },
  { value: "small", label: "Small (a chest, a lute)" },
  { value: "medium", label: "Medium (a barrel, a chandelier)" },
  { value: "large", label: "Large (a cart, a 10 ft window)" },
];

// The eighteen SRD skills by the ids the tools take (src/lib/srd/skills.json).
export const SKILL_OPTIONS: Option[] = [
  ["acrobatics", "Acrobatics"], ["animal_handling", "Animal Handling"], ["arcana", "Arcana"],
  ["athletics", "Athletics"], ["deception", "Deception"], ["history", "History"],
  ["insight", "Insight"], ["intimidation", "Intimidation"], ["investigation", "Investigation"],
  ["medicine", "Medicine"], ["nature", "Nature"], ["perception", "Perception"],
  ["performance", "Performance"], ["persuasion", "Persuasion"], ["religion", "Religion"],
  ["sleight_of_hand", "Sleight of Hand"], ["stealth", "Stealth"], ["survival", "Survival"],
].map(([value, label]) => ({ value, label }));

export const ABILITY_OPTIONS: Option[] = [
  { value: "str", label: "Strength" },
  { value: "dex", label: "Dexterity" },
  { value: "con", label: "Constitution" },
  { value: "int", label: "Intelligence" },
  { value: "wis", label: "Wisdom" },
  { value: "cha", label: "Charisma" },
];

// The difficulty tiers a check can be set at; the server turns each into its
// DC.
export const DIFFICULTY_OPTIONS: Option[] = [
  { value: "very_easy", label: "Very easy (DC 5)" },
  { value: "easy", label: "Easy (DC 10)" },
  { value: "moderate", label: "Moderate (DC 15)" },
  { value: "hard", label: "Hard (DC 20)" },
  { value: "very_hard", label: "Very hard (DC 25)" },
  { value: "nearly_impossible", label: "Nearly impossible (DC 30)" },
];

export const ADVANTAGE_OPTIONS: Option[] = [
  { value: "none", label: "Straight" },
  { value: "advantage", label: "Advantage" },
  { value: "disadvantage", label: "Disadvantage" },
];

export const REASON_FIELD: CatalogField = {
  name: "reason",
  label: "Reason",
  kind: "text",
  placeholder: "Short in-fiction cause",
};

// A damage type pick. Labelled per form ("Type", "Spell damage type"). The
// SRD's thirteen come first; a homebrew type (a setting's "sonic") is typed
// in, because the handlers take any word and a resistance only answers the
// type it names, so an unknown type is simply unresisted.
export function damageTypeField(name: string, label: string, help?: string): CatalogField {
  return {
    name,
    label,
    kind: "select",
    options: DAMAGE_TYPE_OPTIONS,
    other: { label: "Another damage type", placeholder: "sonic, holy" },
    ...(help ? { help } : {}),
  };
}

// A condition pick, SRD first, with room for a story condition.
export function conditionField(
  name: string,
  label: string,
  extra: Partial<CatalogField> = {},
): CatalogField {
  return {
    name,
    label,
    kind: "select",
    options: CONDITION_OPTIONS,
    other: { label: "A story condition", placeholder: "cursed, marked, soaked" },
    ...extra,
  };
}

// The situational advantage a person rules, and the circumstance behind it.
// The engine holds the model to a reason (src/lib/dm/pc-attack-options.ts
// claimedAdvantage); a person's ruling stands either way, and the reason
// goes into the roll's note.
export function advantageFields(): CatalogField[] {
  return [
    {
      name: "advantage",
      label: "Roll",
      kind: "select",
      options: ADVANTAGE_OPTIONS,
      help: "Only for what the server cannot see. Conditions, cover, light, flanking and features are applied already.",
    },
    {
      name: "advantageReason",
      label: "Why",
      kind: "text",
      placeholder: "the ogre is tangled in the curtain",
      help: "Kept with the roll as your ruling, so the table can see why.",
    },
  ];
}

// Where a spell's area is laid on the battle map (src/lib/dm/zone-args.ts
// ZONE_ARGS): the same four arguments on every form that casts one. Each pair
// can be picked on the board, which previews the area as the pointer moves.
export const AREA_PLACEMENT_FIELDS: CatalogField[] = [
  {
    name: "atX",
    label: "Area centre, column",
    kind: "number",
    min: 0,
    max: 200,
    square: { row: "atY", role: "at" },
    help: "An area that stays on the map (Web, Fog Cloud, Moonbeam): its centre square, or a wall's first square. Empty lays it around the creatures caught, or on the caster.",
  },
  { name: "atY", label: "Area centre, row", kind: "number", min: 0, max: 200 },
  {
    name: "towardX",
    label: "Runs toward, column",
    kind: "number",
    min: 0,
    max: 200,
    square: { row: "towardY", role: "toward" },
    help: "A wall or Gust of Wind's line: the square it runs toward. Empty sets a wall across the caster's view.",
  },
  { name: "towardY", label: "Runs toward, row", kind: "number", min: 0, max: 200 },
];
