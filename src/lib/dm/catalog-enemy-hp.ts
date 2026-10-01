// A person running the table corrects an enemy's hit points (U:UD9).
//
// No tool heals or edits an enemy for the AI DM, and that is right: the
// engine resolves what happens to a creature, and a tool that let the model
// set a number would be a bypass. The human DM keeps correction power, as
// update_sheet gives them over characters: the troll that regenerates, the
// priest the cult healed between scenes, a slip of the finger on the damage
// tray. This is that correction, judged here and applied by the DM-only
// route src/app/api/campaigns/[campaignId]/dm/enemy-hp/route.ts.
//
// Pure, for scripts/test-enforce-ui-dm.mjs.

type EnemyLike = {
  displayName: string;
  status: string;
  currentHp: number;
  maxHp: number;
  conditions: string[];
};

export type EnemyHpCorrection =
  | { currentHp: number; wakes: boolean }
  | { error: string };

export function enemyHpCorrection(enemy: EnemyLike, wanted: number): EnemyHpCorrection {
  if (enemy.status !== "alive") {
    return {
      error: `${enemy.displayName} is ${enemy.status}; only a creature still in the fight can have its hit points corrected.`,
    };
  }
  if (!Number.isInteger(wanted) || wanted < 1) {
    return {
      error: `Hit points are corrected to 1 or more; dropping ${enemy.displayName} to 0 goes through Damage an enemy, so the engine decides what the fall means.`,
    };
  }
  if (wanted > enemy.maxHp) {
    return { error: `${enemy.displayName} has ${enemy.maxHp} hit points at most.` };
  }
  // A creature knocked out at 0 wakes when it regains a hit point (SRD 5.1,
  // Knocking a Creature Out: it is unconscious and stable; healing ends it).
  const wakes =
    enemy.currentHp <= 0 && enemy.conditions.some((entry) => entry.trim().toLowerCase() === "unconscious");
  return { currentHp: wanted, wakes };
}
