// SRD 5.1 stat blocks for the creatures spells make: Conjure Animals' and
// Conjure Fey's beasts, Conjure Minor Elementals' and Conjure Elemental's
// elementals, Conjure Woodland Beings' and Conjure Fey's fey, Conjure
// Celestial's celestials, Animate Dead's and Create Undead's undead, Giant
// Insect's insects, Find Steed's and Phantom Steed's mounts (all from the
// generated SRD creature table, src/lib/srd/srd-creatures.ts), and the
// creatures whose numbers a spell's own text gives (Animate Objects, the
// Arcane Hand, the Faithful Hound, the Unseen Servant:
// src/lib/srd/spell-creatures.ts). A server with no content pack summons
// the same creature a server with one does.
//
// Data derived from the SRD 5.1, (c) Wizards of the Coast LLC, CC-BY-4.0.
// See docs/LICENSES.md.

import { findNamed, namesHolding } from "@/lib/language/text-logic";
import type { CreatureAbility, CreatureAttack } from "@/lib/srd/creature-attacks";
import { SPELL_CREATURES, type SpellCreature } from "@/lib/srd/spell-creatures";
import { SRD_CREATURES, traitLine, type CreatureSize, type SrdCreature } from "@/lib/srd/srd-creatures";

export type SummonFormAttack = CreatureAttack;

export type SummonForm = {
  name: string;
  type: string;
  size: CreatureSize;
  cr: number;
  ac: number;
  hp: number;
  speed: number;
  fly?: number;
  swim?: number;
  climb?: number;
  burrow?: number;
  abilities: Record<CreatureAbility, number>;
  // Saving throws the block lists as proficient.
  saves?: CreatureAbility[];
  attacks: SummonFormAttack[];
  attacksPerTurn?: number;
  resist?: string;
  immune?: string;
  vulnerable?: string;
  conditionImmune?: string;
  traits?: string;
};

function fromCreature(creature: SrdCreature): SummonForm {
  const { walk, fly, swim, climb, burrow } = creature.speeds;
  return {
    name: creature.name,
    type: creature.type,
    size: creature.size,
    cr: creature.cr,
    ac: creature.ac,
    hp: creature.hp,
    speed: walk,
    ...(fly ? { fly } : {}),
    ...(swim ? { swim } : {}),
    ...(climb ? { climb } : {}),
    ...(burrow ? { burrow } : {}),
    abilities: creature.abilities,
    ...(creature.saves ? { saves: creature.saves } : {}),
    attacks: creature.attacks,
    ...(creature.attacksPerTurn ? { attacksPerTurn: creature.attacksPerTurn } : {}),
    ...(creature.resist ? { resist: creature.resist } : {}),
    ...(creature.immune ? { immune: creature.immune } : {}),
    ...(creature.vulnerable ? { vulnerable: creature.vulnerable } : {}),
    ...(creature.conditionImmune ? { conditionImmune: creature.conditionImmune } : {}),
    ...(creature.traits.length ? { traits: traitLine(creature.traits) } : {}),
  };
}

function fromSpell(creature: SpellCreature): SummonForm {
  return { ...creature, attacks: creature.attacks };
}

export const SUMMON_FORMS: SummonForm[] = [...SRD_CREATURES.map(fromCreature), ...SPELL_CREATURES.map(fromSpell)];

// The stat block a caller names, matched as a beast form is
// (src/lib/language/text-logic.ts findNamed): its whole name, so a giant elk
// is no Elk. Null when the table does not know it.
export function findSummonForm(term: string): SummonForm | null {
  return findNamed(SUMMON_FORMS, term, (form) => [form.name]);
}

// The stat blocks whose name holds a word a refused name was, for the
// refusal ("spider": Giant Spider).
export function summonFormsHolding(term: string): string[] {
  return namesHolding(SUMMON_FORMS, term, (form) => [form.name]).map((form) => form.name);
}

// The creatures of these kinds the table holds at a challenge rating or
// lower: what a summoning spell can be asked for.
export function summonFormsOf(types: string[], maxCr: number): SummonForm[] {
  return SUMMON_FORMS.filter((form) => types.includes(form.type) && form.cr <= maxCr);
}

export function summonFormNames(): string[] {
  return SUMMON_FORMS.map((form) => form.name);
}
