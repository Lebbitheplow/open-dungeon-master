import { xpForCr } from "@/lib/srd/encounter-math";
import type { EnemyStats } from "@/lib/bestiary/statblock";

// DMG-baseline stats by CR, for enemies the model invents (no matching
// monster) and as the fallback when the content pack is absent. Values track
// the "Monster Statistics by Challenge Rating" table closely enough to keep
// invented enemies honest.

export function synthesizeStats(cr: number): EnemyStats {
  const clamped = Math.min(Math.max(cr, 0), 30);
  const ac = Math.min(19, Math.round(12 + clamped * 0.35));
  const maxHp = Math.max(3, Math.min(400, Math.round(10 + clamped * 15)));
  const toHit = Math.min(14, Math.round(3 + clamped * 0.4));
  // Damage per hit near the DMG per-round band, split across one attack.
  const diceCount = Math.max(1, Math.min(16, Math.round(clamped * 1.1)));
  const modifier = Math.min(8, Math.max(1, Math.round(2 + clamped * 0.25)));
  const dexMod = Math.min(4, Math.max(0, Math.round(clamped * 0.15)));
  const genericSave = Math.min(5, Math.round(clamped * 0.3));
  return {
    ac,
    maxHp,
    dexMod,
    saveMods: {
      str: genericSave,
      dex: dexMod,
      con: genericSave,
      int: Math.max(0, genericSave - 1),
      wis: Math.max(0, genericSave - 1),
      cha: Math.max(0, genericSave - 1),
    },
    speed: "30",
    attacks: [{ name: "Strike", toHit, damage: `${diceCount}d6+${modifier}`, type: "untyped" }],
    traits: [],
    resist: "",
    immune: "",
    vulnerable: "",
    conditionImmune: "",
    cr: clamped,
    xp: xpForCr(clamped),
    // Bigger threats swing more than once, matching real stat blocks.
    attacksPerTurn: clamped >= 3 ? 2 : 1,
  };
}
