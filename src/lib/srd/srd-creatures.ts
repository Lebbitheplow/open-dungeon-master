// The SRD 5.1 creatures the spells and features that call a creature or
// become one draw from: every creature of the SRD but the swarms, so every
// beast (Wild Shape, Polymorph, Conjure Animals), every form True Polymorph
// and Shapechange may give, Find Familiar's forms and Pact of the Chain's,
// and every creature a conjuring or necromancy spell may call. Generated from the
// content pack's SRD rows by scripts/generate-srd-creatures.mjs and
// committed, so a server with no pack reads the same blocks;
// scripts/test-srd-creatures.mjs holds each to the SRD 5.1 text.
//
// Server-side: the DM console's pickers in the browser read the names alone
// (srd-creature-names.json), never this table.
//
// Data derived from the SRD 5.1, (c) Wizards of the Coast LLC, CC-BY-4.0.
// See docs/LICENSES.md.

import data from "@/lib/srd/srd-creatures.json";
import type { CreatureAbility, CreatureAttack } from "@/lib/srd/creature-attacks";

export type CreatureSize = "Tiny" | "Small" | "Medium" | "Large" | "Huge" | "Gargantuan";

export type CreatureSpeeds = { walk: number; fly?: number; swim?: number; climb?: number; burrow?: number };

export type SrdCreature = {
  name: string;
  slug: string;
  type: string;
  size: CreatureSize;
  cr: number;
  ac: number;
  hp: number;
  speeds: CreatureSpeeds;
  abilities: Record<CreatureAbility, number>;
  // Saving throws the block lists as proficient.
  saves?: CreatureAbility[];
  // Special senses in feet (darkvision, blindsight, tremorsense, truesight).
  senses?: Record<string, number>;
  resist?: string;
  immune?: string;
  vulnerable?: string;
  conditionImmune?: string;
  attacks: CreatureAttack[];
  // Attacks one Attack action holds (Multiattack); 1 when absent.
  attacksPerTurn?: number;
  // The Multiattack routine by attack name, and any alternative to it.
  routines?: Array<Array<{ attack: string; count: number }>>;
  // Every trait and every action that is no attack, as "Name: text".
  traits: string[];
};

export const SRD_CREATURES = data.creatures as SrdCreature[];

// Find Familiar's forms by their stat blocks' names, with the other names
// the spell gives them ("frog (toad)", "fish (quipper)").
export const FAMILIAR_FORM_NAMES = data.familiars as Array<{ name: string; aliases?: string[] }>;

// Pact of the Chain's four special forms.
export const CHAIN_FORM_NAMES = data.chain as string[];

// "40 ft., climb 30 ft." as a block prints it.
export function speedWords(speeds: CreatureSpeeds): string {
  const modes = (["fly", "swim", "climb", "burrow"] as const)
    .filter((mode) => speeds[mode])
    .map((mode) => `${mode} ${speeds[mode]} ft.`);
  return [`${speeds.walk} ft.`, ...modes].join(", ");
}

// The special senses in words: "darkvision 60 ft., blindsight 10 ft.".
export function senseWords(senses: SrdCreature["senses"]): string {
  return Object.entries(senses ?? {})
    .map(([sense, feet]) => `${sense} ${feet} ft.`)
    .join(", ");
}

// The block's traits as one line no longer than `max`: each in full while
// it fits, then the rest by name alone.
export function traitLine(traits: string[], max = 400): string {
  const parts: string[] = [];
  for (const [index, trait] of traits.entries()) {
    const sentence = /[.!?]$/.test(trait) ? trait : `${trait}.`;
    if ([...parts, sentence].join(" ").length <= max) {
      parts.push(sentence);
      continue;
    }
    const named = [...parts, `Also: ${traits.slice(index).map(traitName).join("; ")}.`].join(" ");
    return named.slice(0, max);
  }
  return parts.join(" ");
}

// "Keen Smell" of "Keen Smell: The bear has advantage...", and "Reaction:
// Parry" of "Reaction: Parry. The knight adds...".
export function traitName(trait: string): string {
  const section = /^((?:Reaction|Legendary action): [^.]+)\./.exec(trait);
  if (section) {
    return section[1];
  }
  const colon = trait.indexOf(":");
  return colon > 0 ? trait.slice(0, colon) : trait;
}
