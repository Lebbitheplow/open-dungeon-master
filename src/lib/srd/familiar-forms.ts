// The shapes a familiar can take (Find Familiar, SRD 5.1), and the four
// Pact of the Chain adds. Pure data, database-free, so the DM console's
// cast_buff picker (src/lib/dm/catalog-combat.ts) can offer the same forms
// summon_pet and cast_buff accept (src/lib/dm/pet-tools.ts buildPet).

import type { SheetPet } from "@/lib/schemas/sheet";

// The classic familiar shapes, small enough to author inline. All are
// speed/senses flavor with 1 HP; a familiar cannot attack (Pact of the
// Chain lifts that with its special forms).
export type FamiliarForm = Pick<SheetPet, "form" | "hp" | "maxHp" | "ac" | "speed" | "notes"> & {
  attacks?: SheetPet["attacks"];
  chainOnly?: boolean;
};

export const FAMILIAR_FORMS: FamiliarForm[] = [
  { form: "Owl", hp: 1, maxHp: 1, ac: 11, speed: 5, notes: "60 ft fly; Flyby (no opportunity attacks when it flies out of reach); superb night vision." },
  { form: "Raven", hp: 1, maxHp: 1, ac: 12, speed: 10, notes: "50 ft fly; Mimicry (imitates simple sounds)." },
  { form: "Cat", hp: 2, maxHp: 2, ac: 12, speed: 40, notes: "30 ft climb; Keen Smell." },
  { form: "Bat", hp: 1, maxHp: 1, ac: 12, speed: 5, notes: "30 ft fly; blindsight 60 ft (echolocation)." },
  { form: "Rat", hp: 1, maxHp: 1, ac: 10, speed: 20, notes: "Keen Smell." },
  { form: "Spider", hp: 1, maxHp: 1, ac: 12, speed: 20, notes: "20 ft climb; Spider Climb; Web Sense." },
  { form: "Weasel", hp: 1, maxHp: 1, ac: 13, speed: 30, notes: "Keen Hearing and Smell." },
  { form: "Hawk", hp: 1, maxHp: 1, ac: 13, speed: 10, notes: "60 ft fly; Keen Sight." },
  { form: "Frog", hp: 1, maxHp: 1, ac: 11, speed: 20, notes: "20 ft swim; standing leap." },
  { form: "Snake", hp: 2, maxHp: 2, ac: 13, speed: 30, notes: "30 ft swim; blindsight 10 ft." },
  // Pact of the Chain special forms: real combatants with an attack.
  { form: "Imp", hp: 10, maxHp: 10, ac: 13, speed: 20, chainOnly: true, notes: "40 ft fly; invisibility at will; devil's sight.", attacks: [{ name: "Sting", toHit: 5, damage: "1d4+3+3d6", type: "piercing (poison rides the sting)" }] },
  { form: "Quasit", hp: 7, maxHp: 7, ac: 13, speed: 40, chainOnly: true, notes: "Invisibility and Scare at will; shapechanger.", attacks: [{ name: "Claws", toHit: 4, damage: "1d4+3", type: "slashing plus poison" }] },
  { form: "Pseudodragon", hp: 7, maxHp: 7, ac: 13, speed: 15, chainOnly: true, notes: "60 ft fly; blindsight 10 ft; Sting (poison, save or sleep).", attacks: [{ name: "Bite", toHit: 4, damage: "1d4+2", type: "piercing" }, { name: "Sting", toHit: 4, damage: "1d4+2", type: "piercing plus poison save" }] },
  { form: "Sprite", hp: 2, maxHp: 2, ac: 15, speed: 10, chainOnly: true, notes: "40 ft fly; Invisibility; Shortbow (poison, save or sleep).", attacks: [{ name: "Longsword", toHit: 2, damage: "1", type: "slashing" }, { name: "Shortbow", toHit: 6, damage: "1", type: "piercing plus sleep-poison save" }] },
];

// Every form's name, the Pact of the Chain forms included.
export function familiarFormNames(): string[] {
  return FAMILIAR_FORMS.map((entry) => entry.form);
}
