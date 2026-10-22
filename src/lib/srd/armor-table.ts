// SRD 5.1's armor table and the setting armor, as data only: the armor
// engine (armor.ts) reads it, and so does the magic item table
// (magic-gear.ts), which armor.ts imports, for the suits a composite magic
// name may be built on ("Mithral Half Plate").

export type ArmorCategory = "light" | "medium" | "heavy" | "shield";

export type SrdArmor = {
  name: string;
  category: ArmorCategory;
  // Shields add to AC; every other category replaces the 10 base.
  baseAc: number;
  // How much DEX the armor lets through: undefined = all of it (light),
  // 2 = medium, 0 = heavy. Shields never touch DEX.
  dexCap?: number;
  // Minimum Strength score; below it the wearer's speed drops by 10.
  strengthRequirement?: number;
  stealthDisadvantage?: boolean;
  // Pounds. Open5e ships every armor row with a blank weight, so the SRD
  // table is the only source we have for it; the encumbrance rule
  // (src/lib/srd/encumbrance.ts) falls back here when the content pack has
  // nothing to say.
  weightLb: number;
  // Set on the setting armor only: the genres whose classes it is offered
  // to. An SRD class is never suggested a kevlar vest (issue #112).
  genres?: string[];
};

// The English ways a suit's name is written: alone, or with "armor"/"armour"
// before or after it ("Plate Armor"). Read by the armor engine (armor.ts) and
// the composite magic names (magic-gear.ts: "Plate Armor of Fire
// Resistance").
export const armorSpellings = (core: string) => [core, `${core} armor`, `${core} armour`, `armor ${core}`, `armour ${core}`];

export const SRD_ARMOR: SrdArmor[] = [
  { name: "Padded", category: "light", baseAc: 11, stealthDisadvantage: true, weightLb: 8 },
  { name: "Leather", category: "light", baseAc: 11, weightLb: 10 },
  { name: "Studded Leather", category: "light", baseAc: 12, weightLb: 13 },
  { name: "Hide", category: "medium", baseAc: 12, dexCap: 2, weightLb: 12 },
  { name: "Chain Shirt", category: "medium", baseAc: 13, dexCap: 2, weightLb: 20 },
  { name: "Scale Mail", category: "medium", baseAc: 14, dexCap: 2, stealthDisadvantage: true, weightLb: 45 },
  { name: "Breastplate", category: "medium", baseAc: 14, dexCap: 2, weightLb: 20 },
  { name: "Half Plate", category: "medium", baseAc: 15, dexCap: 2, stealthDisadvantage: true, weightLb: 40 },
  { name: "Ring Mail", category: "heavy", baseAc: 14, dexCap: 0, stealthDisadvantage: true, weightLb: 40 },
  { name: "Chain Mail", category: "heavy", baseAc: 16, dexCap: 0, strengthRequirement: 13, stealthDisadvantage: true, weightLb: 55 },
  { name: "Splint", category: "heavy", baseAc: 17, dexCap: 0, strengthRequirement: 15, stealthDisadvantage: true, weightLb: 60 },
  { name: "Plate", category: "heavy", baseAc: 18, dexCap: 0, strengthRequirement: 15, stealthDisadvantage: true, weightLb: 65 },
  { name: "Shield", category: "shield", baseAc: 2, weightLb: 6 },
  // Setting-specific equivalents for the custom genre classes, so a
  // cyberpunk runner in a armorweave vest gets real AC instead of nothing.
  { name: "Armorweave Vest", category: "light", baseAc: 12, weightLb: 6, genres: ["cyberpunk"] },
  { name: "Kevlar Vest", category: "medium", baseAc: 13, dexCap: 2, weightLb: 15, genres: ["cyberpunk", "post_apocalyptic"] },
  { name: "Riot Plating", category: "heavy", baseAc: 17, dexCap: 0, strengthRequirement: 13, stealthDisadvantage: true, weightLb: 50, genres: ["cyberpunk", "post_apocalyptic"] },
  { name: "Brass Carapace", category: "medium", baseAc: 14, dexCap: 2, weightLb: 25, genres: ["steampunk"] },
  { name: "Scrap Plate", category: "heavy", baseAc: 16, dexCap: 0, strengthRequirement: 13, stealthDisadvantage: true, weightLb: 50, genres: ["post_apocalyptic"] },
  { name: "Ballistic Shield", category: "shield", baseAc: 2, weightLb: 8, genres: ["cyberpunk", "post_apocalyptic"] },
];
