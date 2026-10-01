// Where a spell sent to the wrong cast tool belongs: an attack-roll spell
// to pc_attack, a save spell to cast_at_enemy or aoe_damage, a buff to
// cast_buff, healing to heal. Split out of cast-at-enemy.ts, which
// re-exports it; pure, so every cast tool may ask it.

import type { ResolvedSpellMech } from "@/lib/content";

// The redirect a mis-aimed cast gets when the content pack knows how the
// spell actually resolves. Null = this tool is the right one.
export function castRedirect(
  resolved: ResolvedSpellMech | null,
  expected: "save" | "buff" | "attack",
): string | null {
  if (!resolved || resolved.mech.resolution === expected) {
    return null;
  }
  const { name, mech } = resolved;
  switch (mech.resolution) {
    case "attack":
      return `${name} is an attack-roll spell; resolve it with pc_attack (spell="${name}").`;
    case "save":
      return `${name} forces a saving throw; resolve it with cast_at_enemy (or aoe_damage for several targets).`;
    case "buff":
      return `${name} grants an effect, it forces no save; cast it with cast_buff.`;
    case "heal":
      return `${name} heals; resolve it with heal (spell="${name}", casterId, and the slot level): the server spends the slot and rolls the dice.`;
    case "summon":
      return `${name} conjures creatures; cast it with cast_buff, the creature in variant: the server brings them in with their stat blocks.`;
    case "auto":
      // Magic Missile through cast_at_enemy is tolerated: no save rolls.
      return expected === "save" ? null : `${name} hits automatically; resolve it with cast_at_enemy.`;
    case "utility":
      return `${name} has no attack, save, damage, or buff to resolve; spend the slot with use_spell_slot and narrate its effect.`;
  }
}
