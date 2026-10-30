// SRD 5.1 Adventuring Gear whose own entry says what an attack with it does:
// the four flasks a character throws (acid, alchemist's fire, holy water,
// oil) and the burning torch. Each is an improvised weapon, so no
// proficiency bonus, but its hit is the entry's own, not the improvised 1d4
// bludgeoning of an object that "bears no resemblance to a weapon" (issue
// #570, EQP-06 to EQP-10: all five hit as a 1d4 + Strength club, and the
// flasks stayed in the pack). Pure data; src/lib/dm/attack-logic.ts builds
// the profile from it and src/lib/dm/gear-weapon-hit.ts lands what the hit
// leaves.

import { matchGear } from "@/lib/srd/adventuring-gear";

export type GearWeapon = {
  // The catalog row it is (src/lib/srd/adventuring-gear.ts).
  name: string;
  // Thrown: "make a ranged attack ... throw the vial up to 20 feet", so a
  // ranged attack (Dexterity, SRD 5.1 Combat, Attack Rolls) with no long
  // range. Melee: the torch, a melee attack with Strength.
  thrown: boolean;
  // What a hit deals at once, with no ability modifier: the entries say
  // "the target takes 2d6 acid damage" and "it deals 1 fire damage", the
  // item's damage whole, as a spell's is. Null for a flask whose hit deals
  // nothing at once (alchemist's fire burns at the start of the target's
  // turns, oil only coats it).
  dice: string | null;
  // The damage type, also of what it leaves (alchemist's fire's burn).
  type: string;
  // Holy water: "If the target is a fiend or undead, it takes 2d6 radiant
  // damage"; any other creature takes nothing (attack-rules.ts
  // isUndeadOrFiend reads the stat block).
  fiendsAndUndeadOnly?: boolean;
  // The flask shatters on impact or on the floor: one is spent whatever the
  // roll.
  spent: boolean;
  // What a hit leaves on the target (gear-weapon-hit.ts).
  leaves?: "burning" | "oiled";
};

const GEAR_WEAPONS: GearWeapon[] = [
  // Acid: "On a hit, the target takes 2d6 acid damage."
  { name: "Acid (vial)", thrown: true, dice: "2d6", type: "acid", spent: true },
  // Alchemist's Fire: "On a hit, the target takes 1d4 fire damage at the
  // start of each of its turns", until a DC 10 Dexterity check puts it out.
  { name: "Alchemist's Fire (flask)", thrown: true, dice: null, type: "fire", spent: true, leaves: "burning" },
  { name: "Holy Water (flask)", thrown: true, dice: "2d6", type: "radiant", fiendsAndUndeadOnly: true, spent: true },
  // Oil: "On a hit, the target is covered in oil": 5 more fire damage the
  // next time it takes fire damage within a minute.
  { name: "Oil (flask)", thrown: true, dice: null, type: "", spent: true, leaves: "oiled" },
  // Torch: "If you make a melee attack with a burning torch and hit, it
  // deals 1 fire damage." Read as the torch's whole damage, no Strength
  // added, as the flasks' entries are read. A carried torch is taken to be
  // the burning one: the light engine reads it lit (light-timers.ts).
  { name: "Torch", thrown: false, dice: "1", type: "fire", spent: false },
];

// Keyed by the catalog row object itself, so every spelling of the row finds
// it.
const BY_ROW = new Map(GEAR_WEAPONS.flatMap((entry) => {
  const row = matchGear(entry.name);
  return row ? [[row, entry] as const] : [];
}));

// The gear weapon a carried line or a named object is, by the catalog's
// own spellings ("vial of acid", "flask of oil", "torches"). Null for
// anything else.
export function gearWeaponFor(name: string): GearWeapon | null {
  const row = matchGear(name);
  return row ? (BY_ROW.get(row) ?? null) : null;
}


// The marks the flasks leave, by the names the board shows.
export const BURNING = "burning";
export const COVERED_IN_OIL = "covered in oil";
// Oil: "the target takes an additional 5 fire damage from the burning oil."
export const BURNING_OIL_DAMAGE = 5;
