// The creatures whose numbers a spell's own text gives rather than a
// monster's stat block: Animate Objects' table, the Arcane Hand, the
// Faithful Hound and the Unseen Servant (SRD 5.1). Small enough to author
// inline; every other creature a spell calls is in the generated table
// (src/lib/srd/srd-creatures.ts). Pure data with no table behind it, so the
// DM console's picker in the browser may read the names.
//
// Data derived from the SRD 5.1, (c) Wizards of the Coast LLC, CC-BY-4.0.
// See docs/LICENSES.md.

import type { CreatureAbility, CreatureAttack } from "@/lib/srd/creature-attacks";

export type SpellCreature = {
  name: string;
  type: string;
  size: "Tiny" | "Small" | "Medium" | "Large" | "Huge";
  cr: number;
  ac: number;
  hp: number;
  speed: number;
  abilities: Record<CreatureAbility, number>;
  attacks: CreatureAttack[];
  immune?: string;
  conditionImmune?: string;
  traits: string;
};

const score = (str: number, dex: number, con: number, int: number, wis: number, cha: number) => ({ str, dex, con, int, wis, cha });

export const SPELL_CREATURES: SpellCreature[] = [
  // ---- Animate Objects (the spell's own table) ----
  ...(
    [
      ["Tiny", 20, 18, 4, 18, 8, "1d4+4"],
      ["Small", 25, 16, 6, 14, 6, "1d8+2"],
      ["Medium", 40, 13, 10, 12, 5, "2d6+1"],
      ["Large", 50, 10, 14, 10, 6, "2d10+2"],
      ["Huge", 80, 10, 18, 6, 8, "2d12+4"],
    ] as const
  ).map(([size, hp, ac, str, dex, toHit, damage]): SpellCreature => ({
    name: `Animated Object (${size})`, type: "construct", size, cr: 0, ac, hp, speed: 30,
    abilities: score(str, dex, 10, 3, 3, 1),
    attacks: [{ name: "Slam", toHit, damage, type: "bludgeoning" }],
    traits: "Blindsight 30 ft. (blind beyond). An object with no legs flies 30 ft. and may hover; one with legs climbs 30 ft. At 0 hit points it is an object again.",
  })),

  // ---- Arcane Hand (its hit points and fist are the caster's, set at the casting) ----
  {
    name: "Arcane Hand", type: "construct", size: "Large", cr: 0, ac: 20, hp: 1, speed: 60,
    abilities: score(26, 10, 10, 10, 10, 10),
    attacks: [{ name: "Clenched Fist", toHit: 0, damage: "4d8", type: "force" }],
    traits: "A hand of shimmering force that moves 60 ft. on each command. Grasping Hand grapples with its Strength 26 and crushes a creature it holds for 2d6 + the caster's spellcasting modifier bludgeoning; Forceful Hand shoves (a contest with its Strength); Interposing Hand gives half cover.",
  },

  // ---- Faithful Hound (its bite is the caster's, set at the casting) ----
  {
    name: "Faithful Hound", type: "construct", size: "Medium", cr: 0, ac: 10, hp: 1, speed: 0,
    abilities: score(10, 10, 10, 10, 10, 10),
    attacks: [{ name: "Bite", toHit: 0, damage: "4d8", type: "piercing" }],
    immune: "acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing, thunder",
    conditionImmune: "blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious",
    traits: "A phantom watchdog, invisible to all but its caster, that cannot be harmed and stays where it was conjured. It barks when a creature it does not know comes within 30 ft. and bites one hostile creature within 5 ft. at the start of its caster's turns.",
  },

  // ---- Unseen Servant ----
  {
    name: "Unseen Servant", type: "construct", size: "Medium", cr: 0, ac: 10, hp: 1, speed: 15,
    abilities: score(2, 10, 10, 1, 1, 1),
    attacks: [],
    traits: "An invisible, mindless force: it cannot attack and does simple tasks at the caster's command (a bonus action).",
  },
];

export function spellCreatureNames(): string[] {
  return SPELL_CREATURES.map((creature) => creature.name);
}
