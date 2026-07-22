import { getCampaignById, getFloor, setFloor, type Campaign } from "@/lib/db/campaigns";
import {
  activePublicEncounter,
  endEncounter,
  getActiveEncounter,
  getEnemy,
  listEnemies,
  patchEnemyHp,
  setEnemyConcentration,
  type Encounter,
  type EncounterEnemy,
} from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { getDmTurn, type DmTurn, type PendingRoll } from "@/lib/db/dm-turns";
import { markRollApplied, type StoredRoll } from "@/lib/db/rolls";
import { getBattleMapForEncounter, removeTokenByRef } from "@/lib/db/battle-maps";
import { publishPersisted } from "@/lib/events";
import { healthState } from "@/lib/bestiary/health";
import { saveModFor } from "@/lib/bestiary/statblock";
import { d20Expression, rollExpression } from "@/lib/dice";
import { clearSpellConditionsByName } from "@/lib/dm/concentration";
import { enemyDamageMath } from "@/lib/dm/encounter-logic";
import { damageAdjust } from "@/lib/dm/condition-logic";
import { applyDmMutation } from "@/lib/dm/mutations";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { dismissGuestCompanions } from "@/lib/dm/companion-tools";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The single server-side path for damage landing on an enemy. Used by the
// damage_enemy tool AND by damage rolls carrying targetEnemyId, which the
// server applies the moment the dice land so the enemy card can never lag
// the narration. Also home to encounter finishing, shared with the turn
// loop. This module must not import encounter-tools (the import points the
// other way, same rule as map-tools).

export function publishEncounter(campaignId: string) {
  publishPersisted(campaignId, "encounter_updated", {
    encounter: activePublicEncounter(campaignId),
  });
}

export function resolveEnemyRef(encounterId: string, ref: string): EncounterEnemy | null {
  const trimmed = ref.trim();
  if (!trimmed) {
    return null;
  }
  const direct = getEnemy(trimmed);
  if (direct && direct.encounterId === encounterId) {
    return direct;
  }
  return (
    listEnemies(encounterId).find(
      (enemy) => enemy.displayName.toLowerCase() === trimmed.toLowerCase(),
    ) ?? null
  );
}

export function finishEncounter(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  outcome: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const enemies = listEnemies(encounter.id);
  // Survivors scatter when the fight ends without their deaths.
  if (outcome === "enemies_fled" || outcome === "truce" || outcome === "party_fled") {
    for (const enemy of enemies) {
      if (enemy.status === "alive") {
        patchEnemyHp(enemy.id, enemy.currentHp, "fled");
      }
    }
  }
  endEncounter(encounter.id, outcome);

  const totalXp = enemies.reduce((sum, enemy) => sum + enemy.xp, 0);
  const share =
    outcome === "victory" ? 1 : outcome === "enemies_fled" || outcome === "truce" ? 0.5 : 0;
  const xpEach = sheets.length ? Math.floor((totalXp * share) / sheets.length) : 0;
  let xpResult: Record<string, unknown> = {};
  if (xpEach > 0) {
    xpResult = applyDmMutation(
      campaign,
      turn.id,
      "award_xp",
      JSON.stringify({
        characterIds: sheets.map((sheet) => sheet.id),
        amount: xpEach,
        reason: outcome === "victory" ? "encounter victory" : `encounter ended: ${outcome}`,
      }),
      sheets,
      sheetsById,
    ).result;
  }

  const floor = getFloor(campaign.id);
  if (floor.mode === "initiative" || (floor.mode === "hold" && floor.next.mode === "initiative")) {
    setFloor(campaign.id, { mode: "open" });
    publishPersisted(campaign.id, "floor_changed", { floor: { mode: "open" } });
  }
  publishPersisted(campaign.id, "encounter_updated", { encounter: null });
  // Clients drop their fogged map view; the archived rows stay for history.
  publishBattleMapUpdate(campaign.id);
  // Guest allies joined for this fight, so the fight ending writes them out;
  // lasting party companions stay. XP above already counted them in.
  const guestsGone = dismissGuestCompanions(campaign, "the fight ended");

  return {
    encounterOver: true,
    outcome,
    ...(guestsGone.length
      ? {
          guestsDismissed: `${guestsGone.join(", ")} left with the scene; narrate the parting.`,
        }
      : {}),
    ...(xpEach > 0 ? { xpAwarded: `${xpEach} XP each` } : {}),
    ...(typeof xpResult.levelUpAvailable !== "undefined"
      ? { levelUpAvailable: xpResult.levelUpAvailable }
      : {}),
  };
}

// Ends the encounter with victory XP once no living enemies remain.
export function autoEndOnVictory(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const enemies = listEnemies(encounter.id);
  if (enemies.some((enemy) => enemy.status === "alive")) {
    return {};
  }
  return finishEncounter(campaign, turn, encounter, "victory", sheets, sheetsById);
}

// Applies damage to a living enemy: resistance/immunity/vulnerability math
// from the stat block, HP patch, live enemy-card update, token removal and
// auto-victory on a kill. Returns the compact tool result.
export function applyEnemyDamage(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  enemy: EncounterEnemy,
  amount: number,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  damageType?: string,
): Record<string, unknown> {
  const adjusted = damageAdjust(
    amount,
    damageType,
    enemy.stats.resist,
    enemy.stats.immune,
    enemy.stats.vulnerable,
  );
  if (adjusted.amount <= 0) {
    return {
      ok: true,
      name: enemy.displayName,
      hp: `${enemy.currentHp}/${enemy.maxHp}`,
      health: healthState(enemy.currentHp, enemy.maxHp),
      damageApplied: 0,
      note: `${enemy.displayName} is ${adjusted.note}. Narrate the effect washing over it harmlessly.`,
    };
  }
  const math = enemyDamageMath(enemy.currentHp, adjusted.amount);
  const updated = patchEnemyHp(enemy.id, math.currentHp, math.dropped ? "dead" : "alive");
  publishEncounter(campaign.id);
  if (!updated) {
    return { error: "Failed to update enemy." };
  }
  const base: Record<string, unknown> = {
    ok: true,
    name: updated.displayName,
    hp: `${updated.currentHp}/${updated.maxHp}`,
    health: healthState(updated.currentHp, updated.maxHp),
    ...(adjusted.note ? { damageApplied: adjusted.amount, damageNote: adjusted.note } : {}),
  };
  // Enemy concentration: damage forces the CON save (DC 10 or half the
  // damage); death breaks it outright. A break ends the spell's conditions
  // on everyone it was holding (the same cleanup a PC's break runs).
  if (enemy.concentration) {
    const spell = enemy.concentration;
    if (math.dropped) {
      setEnemyConcentration(enemy.id, null);
      clearSpellConditionsByName(campaign, spell);
      base.concentrationBroken = `${updated.displayName}'s ${spell} ends with its death; the spell's effects fade.`;
    } else {
      const dc = Math.max(10, Math.floor(adjusted.amount / 2));
      const outcome = rollExpression(d20Expression(saveModFor(enemy.stats, "con")));
      const held = outcome.total >= dc;
      if (!held) {
        setEnemyConcentration(enemy.id, null);
        clearSpellConditionsByName(campaign, spell);
      }
      base.concentration = held
        ? `${updated.displayName} keeps concentrating on ${spell} (CON save ${outcome.total} vs DC ${dc}).`
        : `${updated.displayName} loses concentration on ${spell} (CON save ${outcome.total} vs DC ${dc}); the spell's effects end.`;
    }
  }
  if (math.dropped) {
    base.dead = true;
    base.note = `${updated.displayName} is slain. You may now narrate its death.`;
    const map = getBattleMapForEncounter(encounter.id);
    if (map) {
      removeTokenByRef(map.id, enemy.id);
      publishBattleMapUpdate(campaign.id);
    }
    Object.assign(base, autoEndOnVictory(campaign, turn, encounter, sheets, sheetsById));
  }
  return base;
}

// A resolved damage roll that names its target: apply it before the model
// even sees the number. Returned payload merges into the roll's tool result.
export function autoApplyDamageRoll(
  campaign: Campaign,
  turn: DmTurn,
  targetEnemyRef: string,
  roll: StoredRoll,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  damageType?: string,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { warning: "No active encounter; this damage was not applied to anyone." };
  }
  const enemy = resolveEnemyRef(encounter.id, targetEnemyRef);
  if (!enemy || enemy.status !== "alive") {
    return {
      warning: `targetEnemyId "${targetEnemyRef}" matched no living enemy; the damage was NOT applied. Call damage_enemy with an exact enemyId from GAME STATE.`,
    };
  }
  const result = applyEnemyDamage(
    campaign,
    turn,
    encounter,
    enemy,
    Math.max(1, roll.total),
    sheets,
    sheetsById,
    damageType,
  );
  if (!("error" in result)) {
    markRollApplied(roll.id, enemy.id);
    result.note = result.dead
      ? `${enemy.displayName} is slain; the server already applied this damage. Do NOT call damage_enemy for this hit.`
      : `The server already applied this damage to ${enemy.displayName}. Do NOT call damage_enemy for this hit.`;
  }
  return result;
}

// Physical-dice variant, called from the pending-rolls route when a player
// submits a targeted damage roll. Returns the summary the resumed turn
// surfaces to the model (stored in pending_rolls.combat_note).
export function applyPendingDamageRoll(pending: PendingRoll, roll: StoredRoll): string | null {
  if (!pending.targetEnemyId) {
    return null;
  }
  const campaign = getCampaignById(pending.campaignId);
  const turn = getDmTurn(pending.turnId);
  if (!campaign || !turn) {
    return null;
  }
  const sheets = listSheets(campaign.id);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const applied = autoApplyDamageRoll(
    campaign,
    turn,
    pending.targetEnemyId,
    roll,
    sheets,
    sheetsById,
    pending.attack?.damageType,
  );
  if (typeof applied.warning === "string") {
    return applied.warning;
  }
  if ("error" in applied) {
    return null;
  }
  const parts = [
    `The server already applied this ${roll.total} damage to ${String(applied.name)} (now ${
      applied.dead ? "SLAIN" : String(applied.health)
    }).`,
  ];
  if (applied.encounterOver) {
    parts.push(`The encounter ended: ${String(applied.outcome)}. XP was awarded automatically.`);
  }
  parts.push("Do NOT call damage_enemy for this hit; narrate from this state.");
  return parts.join(" ");
}
