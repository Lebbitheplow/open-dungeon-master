// Whether a spell's attack is a melee spell attack (SRD 5.1 "make a melee
// spell attack"): every touch-range attack spell, and the two whose range
// is Self and whose attack is still a touch.
//
// Its own pure module so the Hand (src/lib/battlemap/hand-spells.ts) reads
// the rule pc_attack reads, without pulling in the database-bound module the
// attack riders live in (src/lib/dm/spell-attack-riders.ts re-exports it).
export function isMeleeSpellAttack(spell: string, rangeKind: string | undefined): boolean {
  return rangeKind === "touch" || /^(?:vampiric touch|flame blade)$/i.test(spell.trim());
}
