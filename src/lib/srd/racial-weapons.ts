// A lineage's natural weapon, read off its trait on the sheet: "Bite (1d6
// piercing unarmed strike)" (lizardfolk), "Claws (1d4 slashing unarmed
// strike)" (aarakocra's talons), "Cat's Claws (20 ft climb speed, 1d4
// slashing unarmed strike)" (tabaxi). pc_attack's weapon "bite" or "claws"
// strikes with the trait's die and type. Before this the bite was a plain
// unarmed strike for 1 bludgeoning, and Hungry Jaws had nothing to bite with
// (issue 233). Pure.
import type { SrdWeapon } from "@/lib/srd/weapons";
import { textKey } from "@/lib/language/text-logic";

const TRAIT = /^(.+?)\s*\((?:[^()]*?,\s*)?(\d+d\d+)\s+([a-z]+)\s+unarmed strike\)\s*$/i;

export type RacialWeapon = { feature: string; srd: SrdWeapon };

// `terms` are the ways to read the weapon's name (src/lib/language/
// language.ts nameTerms).
export function racialNaturalWeapon(features: Array<{ name: string }>, terms: readonly string[]): RacialWeapon | null {
  const wanted = terms.map(textKey).filter(Boolean);
  if (!wanted.length) {
    return null;
  }
  for (const feature of features) {
    const found = TRAIT.exec(feature.name.trim());
    if (!found) {
      continue;
    }
    // "Cat's Claws" answers to "claws" as well as to its own name.
    const own = found[1].trim();
    const bare = own.replace(/^[a-z]+'s\s+/i, "");
    const names = [textKey(own), textKey(bare)];
    if (names.some((name) => wanted.some((term) => term === name || term.startsWith(`${name} `) || name.startsWith(term)))) {
      return {
        feature: own,
        srd: { name: bare.replace(/\b\w/g, (letter) => letter.toUpperCase()), category: "simple", kind: "melee", damage: `${found[2]} ${found[3].toLowerCase()}` },
      };
    }
  }
  return null;
}
