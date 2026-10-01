// The spell answers baked from the SRD rows for a server with no content
// pack. Split from src/lib/content/index.ts, whose spellDamageFor and
// spellMechanicsFor fall back to these.

import bakedSpellMechJson from "@/lib/srd/manifest/spell-mech.json";
import type { SpellMech } from "@/lib/srd/spell-mechanics";

// What the SRD rows' text answers, baked at build time
// (scripts/annotate-spell-manifest.mjs) for a server with no content pack:
// the parsed mechanics and the dice by slot level or cantrip tier.
type BakedSpell = { n: string; a?: string[]; m?: SpellMech; x?: Record<string, string> };
const BAKED = new Map<string, BakedSpell>(
  (bakedSpellMechJson as unknown as { spells: BakedSpell[] }).spells.flatMap((spell) =>
    [spell.n, ...(spell.a ?? [])].map((name) => [name.trim().toLowerCase().replace(/\s+/g, " "), spell] as const),
  ),
);

function bakedSpell(name: string): BakedSpell | null {
  return BAKED.get(name.trim().toLowerCase().replace(/\s+/g, " ")) ?? null;
}

// The baked dice for a caster level (a cantrip) or a slot level.
function bakedDice(spell: BakedSpell, spellLevel: number, casterLevel: number, slotLevel: number): string | null {
  if (!spell.x) {
    return null;
  }
  if (spellLevel === 0) {
    const tier = [17, 11, 5, 1].find((level) => casterLevel >= level && spell.x?.[`c${level}`]);
    return tier ? (spell.x[`c${tier}`] ?? null) : null;
  }
  return spell.x[String(slotLevel)] ?? null;
}

// A baked spell's parsed mechanics, or null.
export function bakedSpellMech(name: string): SpellMech | null {
  return bakedSpell(name)?.m ?? null;
}

// The dice a baked spell rolls for this caster and slot, with the note the
// damage result carries; null when the row states none.
export function bakedSpellDamage(
  name: string,
  spellLevel: number,
  casterLevel: number,
  slotLevel: number,
): { dice: string; note: string; spellLevel: number } | null {
  const baked = bakedSpell(name);
  const dice = baked ? bakedDice(baked, spellLevel, casterLevel, slotLevel) : null;
  return dice
    ? { dice, note: spellLevel === 0 ? `cantrip damage at level ${casterLevel}: ${dice}` : `${dice} from a level ${slotLevel} slot`, spellLevel }
    : null;
}
