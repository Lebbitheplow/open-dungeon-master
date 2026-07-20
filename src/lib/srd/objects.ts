// Object durability from the DMG "Objects" rules: a struck object has an AC
// set by its material and hit points set by its size and fragility. Pure and
// table-driven; damage_object reads these so "I smash the door" resolves
// against real numbers instead of DM whim.

export type ObjectMaterial =
  | "cloth"
  | "paper"
  | "rope"
  | "crystal"
  | "glass"
  | "ice"
  | "wood"
  | "bone"
  | "stone"
  | "iron"
  | "steel"
  | "mithral"
  | "adamantine";

export type ObjectSize = "tiny" | "small" | "medium" | "large";

// DMG object AC by material.
const MATERIAL_AC: Record<ObjectMaterial, number> = {
  cloth: 11,
  paper: 11,
  rope: 11,
  crystal: 13,
  glass: 13,
  ice: 13,
  wood: 15,
  bone: 15,
  stone: 17,
  iron: 19,
  steel: 19,
  mithral: 21,
  adamantine: 23,
};

export function objectAc(material: ObjectMaterial): number {
  return MATERIAL_AC[material] ?? 15;
}

// DMG hit points by size, for a resilient object; fragile objects take half
// (rounded down). Given as an average so the table stays deterministic.
const SIZE_HP: Record<ObjectSize, number> = {
  tiny: 4, // bottle, lock
  small: 8, // chest, lute
  medium: 18, // barrel, chandelier
  large: 27, // cart, big door
};

export function objectHp(size: ObjectSize, fragile = false): number {
  const base = SIZE_HP[size] ?? SIZE_HP.medium;
  return fragile ? Math.floor(base / 2) : base;
}

export type ObjectProfile = {
  ac: number;
  hp: number;
  material: ObjectMaterial;
  size: ObjectSize;
  fragile: boolean;
};

export function objectProfile(
  material: ObjectMaterial,
  size: ObjectSize,
  fragile = false,
): ObjectProfile {
  return { ac: objectAc(material), hp: objectHp(size, fragile), material, size, fragile };
}
