// Damage a foe path lands on a character (issue 503, Phase 6): pc_attack's
// blow on a companion turned against the party, a turncoat's spell on a
// party member, an opportunity strike between two sheets. The foe paths
// were written against an enemy row; the view they hold of a sheet
// (sheet-foe.ts) hands its damage here, and from here it lands the way any
// harm lands on a character (src/lib/dm/pc-damage.ts): Arcane Ward first,
// each type against the character's own resistances, temporary hit points,
// a beast form's pool, Relentless Endurance and Relentless Rage, the
// concentration save, and the death engine.
//
// A character at 0 falls unconscious and is dying (combat-sides-logic.ts
// sheetOutOfFight has the rule); a blow while down is a failed death save,
// two on a critical hit, and a blow past its maximum kills it. A blow meant
// to knock out leaves it stable instead (SRD 5.1, Knocking a Creature Out).
//
// The result reads like an enemy's (name, hp, health, damageApplied), so the
// foe paths report it unchanged. The fight's end is the caller's to ask
// (enemy-damage.ts applyEnemyDamage), which keeps this module below it.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { stableDeathTrack } from "@/lib/dm/death-logic";
import { healthState } from "@/lib/bestiary/health";
import { applyPcDamage } from "@/lib/dm/pc-damage";

export type SheetFoeBlow = {
  amount: number;
  type?: string;
  // A blow of several types, raw: each meets the character's defenses.
  parts?: Array<{ amount: number; type: string }>;
  magical?: boolean;
  spell?: boolean;
  crit?: boolean;
  nonlethal?: boolean;
  // Death outright (exhaustion 6, Power Word Kill): no save, no track.
  death?: boolean;
  reason?: string;
};

export function applySheetFoeDamage(campaign: Campaign, turn: DmTurn, view: EncounterEnemy, blow: SheetFoeBlow): Record<string, unknown> {
  const sheet = getSheetById(view.id);
  if (!sheet) {
    return { error: `${view.displayName} is no longer at the table.`, retry: true };
  }
  const max = effectiveMaxHp(sheet);
  if (sheet.deathSaves?.dead) {
    return { ok: true, name: sheet.name, hp: `0/${max}`, damageApplied: 0, note: `${sheet.name} is already dead.` };
  }
  if (blow.death) {
    const killed = patchSheet(sheet.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
    if (killed) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: killed });
    }
    return { ok: true, name: sheet.name, hp: `0/${max}`, health: healthState(0, max), dead: true, dropped: true, note: `${sheet.name} dies.` };
  }
  const amount = Math.max(0, Math.floor(blow.amount));
  if (amount <= 0) {
    return { ok: true, name: sheet.name, hp: `${sheet.currentHp}/${max}`, health: healthState(sheet.currentHp, max), damageApplied: 0 };
  }
  const applied = applyPcDamage(campaign, turn.id, sheet, {
    amount: Math.min(amount, 500),
    ...(blow.type ? { type: blow.type } : {}),
    ...(blow.parts?.length ? { parts: blow.parts } : {}),
    ...(blow.magical ? { magical: true } : {}),
    ...(blow.spell ? { spell: true } : {}),
    ...(blow.crit ? { crit: true } : {}),
    reason: (blow.reason ?? "").slice(0, 200),
  });
  if ("error" in applied) {
    return applied;
  }
  let after = getSheetById(sheet.id) ?? sheet;
  const dropped = after.currentHp <= 0 && sheet.currentHp > 0;
  // A melee blow meant to knock out: unconscious and stable, not dying.
  if (dropped && blow.nonlethal && !after.deathSaves?.dead) {
    const stable = patchSheet(sheet.id, { deathSaves: stableDeathTrack() });
    if (stable) {
      after = stable;
      publishPersisted(campaign.id, "sheet_updated", { sheet: stable });
    }
  }
  const afterMax = effectiveMaxHp(after);
  const dead = after.deathSaves?.dead === true;
  return {
    ...applied,
    ok: true,
    name: after.name,
    hp: `${Math.max(0, after.currentHp)}/${afterMax}`,
    health: healthState(Math.max(0, after.currentHp), afterMax),
    damageApplied: typeof applied.damageApplied === "number" ? applied.damageApplied : sheet.currentHp + (sheet.tempHp ?? 0) - Math.max(0, after.currentHp) - (after.tempHp ?? 0),
    ...(dead ? { dead: true, note: `${after.name} is dead.` } : {}),
    ...(!dead && after.currentHp <= 0
      ? {
          down: true,
          ...(dropped ? { dropped: true } : {}),
          note: blow.nonlethal && dropped
            ? `${after.name} is knocked out: unconscious and stable at 0 hit points, out of the fight.`
            : `${after.name} falls unconscious at 0 hit points, dying and out of the fight: a blow while down is a failed death save, two on a critical hit.`,
        }
      : {}),
  };
}
