import type { HomebrewKind } from "@/lib/schemas/homebrew";

// What the homebrew panel shows of an entry, and the words it uses for the
// kinds. Monsters are a kind too, but they have the bestiary; this system
// is the other six.

export type HomebrewEntryView = {
  id: string;
  kind: HomebrewKind;
  name: string;
  data: Record<string, unknown>;
  updatedAt: string;
};

export const HOMEBREW_EDITOR_KINDS = [
  "item",
  "spell",
  "feat",
  "background",
  "race",
  "archetype",
] as const satisfies ReadonlyArray<HomebrewKind>;

export type EditorKind = (typeof HOMEBREW_EDITOR_KINDS)[number];

export const KIND_LABELS: Record<EditorKind, string> = {
  item: "Items",
  spell: "Spells",
  feat: "Feats",
  background: "Backgrounds",
  race: "Species",
  archetype: "Subclasses",
};

export const KIND_SINGULAR: Record<EditorKind, string> = {
  item: "item",
  spell: "spell",
  feat: "feat",
  background: "background",
  race: "species",
  archetype: "subclass",
};

// One sentence per kind for the empty state, saying what the engine does
// with the thing rather than what the form asks for.
export const KIND_BLURB: Record<EditorKind, string> = {
  item: "Weapons the attack roll reads, armour the AC engine wears, magic items whose effects apply while attuned.",
  spell: "Spells the cast tools resolve: the save, the damage and the condition come from the block, not from memory.",
  feat: "Feats the character builder offers beside the SRD ones.",
  background: "Backgrounds the builder offers, with the skills it grants.",
  race: "Species the builder offers, with their speed and ability bonuses.",
  archetype: "Subclasses the builder offers under a class, with their features by level.",
};

// The SRD class ids a subclass can sit under, so the picker is a list rather
// than a text box that has to be spelled the way features.ts spells it.
export const CLASS_IDS = [
  "barbarian",
  "bard",
  "cleric",
  "druid",
  "fighter",
  "monk",
  "paladin",
  "ranger",
  "rogue",
  "sorcerer",
  "warlock",
  "wizard",
] as const;

export const SPELL_SCHOOLS = [
  "abjuration",
  "conjuration",
  "divination",
  "enchantment",
  "evocation",
  "illusion",
  "necromancy",
  "transmutation",
] as const;

export const DAMAGE_TYPES = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder",
] as const;

export const input =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200 focus:border-amber-500/50 focus:outline-none";
