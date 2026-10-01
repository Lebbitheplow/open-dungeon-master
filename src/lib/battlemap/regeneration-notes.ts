// How a creature lying at 0 hit points waiting to regenerate reads on the
// table's screens (src/lib/dm/regeneration.ts has the rule: SRD 5.1 troll,
// "dies only if it starts its turn with 0 hit points and doesn't
// regenerate"). One wording for the encounter panel, the Hand's target chips
// and the board's condition chip. Pure.

export function regeneratingNote(stopped: boolean): string {
  return stopped
    ? "Down at 0 hit points, and the damage that stops its Regeneration landed: it dies at the start of its turn."
    : "Down at 0 hit points, not dead: at the start of its turn it regains hit points and rises, unless the damage that stops its Regeneration (acid or fire for a troll) lands first.";
}
