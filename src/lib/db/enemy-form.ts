// The two writes that swap an enemy's whole stat block for a Polymorph and
// back (src/lib/dm/enemy-polymorph.ts). Kept apart from encounters.ts, which
// calls restoreOwnForm whenever the polymorphed condition goes, so every way a
// spell ends (concentration, its hour, Dispel Magic) gives the block back.

import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { EnemyOwnForm, EnemyStats } from "@/lib/bestiary/statblock";

// The block, armor class and hit points of a new form. The challenge rating
// and XP columns stay the creature's own: the fight is still worth what it was.
export function writeEnemyForm(enemyId: string, stats: EnemyStats) {
  getDatabase()
    .prepare(
      `UPDATE encounter_enemies SET stat_json = ?, ac = ?, max_hp = ?, current_hp = ?, updated_at = ? WHERE id = ?`,
    )
    .run(JSON.stringify(stats), stats.ac, stats.maxHp, stats.maxHp, nowIso(), enemyId);
}

// The creature's own block and hit points, as the spell found them. The
// polymorphed condition is dropped here too, so a revert from damage leaves
// no condition behind to end it a second time.
export function restoreOwnForm(enemyId: string, own: EnemyOwnForm) {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT conditions_json, condition_meta_json FROM encounter_enemies WHERE id = ?`)
    .get(enemyId) as { conditions_json: string; condition_meta_json: string | null } | undefined;
  if (!row) {
    return;
  }
  const conditions = parseJson<string[]>(row.conditions_json, []).filter(
    (name) => name.toLowerCase() !== "polymorphed",
  );
  const meta = parseJson<Record<string, unknown>>(row.condition_meta_json, {});
  delete meta.polymorphed;
  db.prepare(
    `UPDATE encounter_enemies SET stat_json = ?, ac = ?, max_hp = ?, current_hp = ?,
     conditions_json = ?, condition_meta_json = ?, updated_at = ? WHERE id = ?`,
  ).run(
    JSON.stringify(own.stats),
    own.ac,
    own.maxHp,
    own.currentHp,
    JSON.stringify(conditions),
    JSON.stringify(meta),
    nowIso(),
    enemyId,
  );
}
