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

// SRD 5.1 Objects, Statistics for Objects, the Object Hit Points table:
// [fragile, resilient], each the average of its dice so the table stays
// deterministic. Fragile is its own column, not half of resilient (issue
// #570, EQP-01: halving gave a Small chest 8 and a Medium barrel 9).
const SIZE_HP: Record<ObjectSize, [number, number]> = {
  tiny: [2, 5], // bottle, lock: 1d4 / 2d4
  small: [3, 10], // chest, lute: 1d6 / 3d6
  medium: [4, 18], // barrel, chandelier: 1d8 / 4d8
  large: [5, 27], // cart, 10-ft-by-10-ft window: 1d10 / 5d10
};

export function objectHp(size: ObjectSize, fragile = false): number {
  const [frail, sturdy] = SIZE_HP[size] ?? SIZE_HP.medium;
  return fragile ? frail : sturdy;
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
