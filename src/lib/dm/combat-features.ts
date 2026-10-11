// Class features a character spends through use_resource whose effect the
// server resolves in the fight (SRD 5.1):
//   - Intimidating Presence (Berserker 10): the action; one creature within
//     30 feet that can see or hear the barbarian makes a WIS save (DC 8 +
//     proficiency + CHA) or is frightened of them until the end of the
//     barbarian's next turn. Later turns' actions extend it. A creature that
//     succeeds cannot be frightened by it again for 24 hours.
//   - Holy Nimbus (Oath of Devotion 20): the action, once a long rest; for a
//     minute bright light shines 30 feet from the paladin, and an enemy that
//     starts its turn in it takes 10 radiant damage (condition-tick.ts calls
//     holyNimbusTurnStart).
//   - Divine Intervention (cleric 10): the action; percentile dice at or
//     under the cleric's level succeed, and at 20th no roll is needed
//     (Divine Intervention Improvement). After
//     a success it cannot be used for 7 days; after a failure, not until a
//     long rest (its counter).
// Called from the use_resource arm of src/lib/dm/mutations.ts before the
// generic path. Must not import mutations.ts (which imports it).

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getClock } from "@/lib/db/clock";
import { getDatabase, parseJson } from "@/lib/db/core";
import { getActiveEncounter, listEnemies, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { tilesApart } from "@/lib/dm/board-reach";

import { spendAction } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { withOpportunityTurn } from "@/lib/dm/opportunity-strike";
import { untilTurnEnd } from "@/lib/dm/turn-end";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { computeSheetDerived } from "@/lib/srd";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import { classLevelOf, holdsFeature } from "@/lib/srd/trait-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const lower = (value: string) => value.trim().toLowerCase();

// Feet between two combatants on the live board, or null with no board.
export function feetBetween(encounterId: string, a: string, b: string): number | null {
  const map = getBattleMapForEncounter(encounterId);
  const from = map ? getTokenByRef(map.id, a) : null;
  const to = map ? getTokenByRef(map.id, b) : null;
  return from && to ? tilesApart(from, to) * 5 : null;

}

// The action a feature costs, checked and priced; `commit` stores it once
// the feature has resolved. Out of a fight there is no turn to charge.
export function priceTheAction(
  sheet: CharacterSheet,
  encounter: Encounter | null,
  what: string,
): { commit: () => void } | { error: string } {
  const able = canAct({ sheet, encounter, kind: "action" });
  if (!able.ok) {
    return { error: able.error };
  }
  const fight = encounter && (encounter.kind ?? "fight") === "fight" ? encounter : null;
  const budget = fight ? budgetFor(fight, sheet.id, attacksAllowedFor(sheet), conditionExtraActions(sheet.conditions)) : null;
  if (!fight || !budget) {
    return { commit: () => {} };
  }
  const spent = spendAction(budget, "action", what, sheet.name);
  if (!spent.ok) {
    return { error: spent.error };
  }
  return { commit: () => storeBudget(fight, spent.budget) };
}

export function spendUse(campaign: Campaign, turnId: string, sheet: CharacterSheet, id: string, label: string) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const state = fresh.resources?.[id];
  if (!state) {
    return;
  }
  const patch = { resources: { ...fresh.resources, [id]: { max: state.max, used: Math.min(state.max, state.used + 1) } } };
  patchSheet(fresh.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: fresh.id,
    turnId,
    kind: "use_resource",
    delta: { resource: label, spent: 1 },
    reason: label,
    seq: allocateSeq(campaign.id),
    before: fresh,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: fresh.name });
}

export function publishSheet(campaign: Campaign, sheetId: string) {
  const updated = patchSheet(sheetId, {});
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

function left(sheet: CharacterSheet, id: string): number | null {
  const state = sheet.resources?.[id];
  return state ? state.max - state.used : null;
}

// A use_resource call this module resolves, or null for the other paths.
export function combatFeatureSpend(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  resourceName: string,
  targetEnemyId: string | undefined,
): Record<string, unknown> | null {
  const name = lower(resourceName);
  if (/^intimidating presence\b/.test(name)) {
    return intimidatingPresence(campaign, sheet, targetEnemyId);
  }
  if (/^holy nimbus\b/.test(name)) {
    return holyNimbus(campaign, turnId, sheet);
  }
  if (/^divine intervention\b/.test(name)) {
    return divineIntervention(campaign, turnId, sheet);
  }
  return null;
}

// ---- Intimidating Presence ----

export const UNMOVED = "unmoved by intimidating presence";
const DAY_ROUNDS = 14400;

function intimidatingPresence(campaign: Campaign, stale: CharacterSheet, targetEnemyId: string | undefined): Record<string, unknown> {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!holdsFeature(sheet, "intimidating presence") && !(classLevelOf(sheet, "barbarian") >= 10 && /berserker/i.test(sheet.subclass ?? ""))) {
    return { error: `${sheet.name} does not have Intimidating Presence (a Berserker's 10th level feature).` };
  }
  const encounter = getActiveEncounter(campaign.id);
  const enemy = encounter && targetEnemyId ? resolveEnemyRef(encounter.id, targetEnemyId) : null;
  if (!encounter || !enemy || enemy.status !== "alive") {
    return { error: "Intimidating Presence needs targetEnemyId: the living creature the barbarian menaces. Nothing was spent." };
  }
  const meta = enemy.conditionMeta as ConditionMetaMap;
  if (enemy.conditions.includes(UNMOVED) && meta[UNMOVED]?.source === sheet.id) {
    return { error: `${enemy.displayName} already saw through ${sheet.name}'s Intimidating Presence and cannot be frightened by it again for 24 hours. Nothing was spent.` };
  }
  const apart = feetBetween(encounter.id, sheet.id, enemy.id);
  if (apart !== null && apart > 30) {
    return { error: `${enemy.displayName} is ${apart} feet away; Intimidating Presence reaches a creature within 30 feet. Nothing was spent.` };
  }
  const price = priceTheAction(sheet, encounter, "Intimidating Presence");
  if ("error" in price) {
    return { error: price.error };
  }
  // Already frightened by it: the action extends it to the end of the
  // barbarian's next turn, with no new save.
  const held = enemy.conditions.includes("frightened") && meta.frightened?.source === sheet.id && meta.frightened?.untilTurnEndOf === sheet.id;
  if (held) {
    patchEnemyConditions(enemy.id, enemy.conditions, { ...meta, frightened: untilTurnEnd(sheet.id, { source: sheet.id }) });
    publishEncounter(campaign.id);
    price.commit();
    return { ok: true, feature: "Intimidating Presence", cost: "their action", applied: `${enemy.displayName} stays frightened of ${sheet.name} until the end of their next turn.` };
  }
  const derived = computeSheetDerived(sheet);
  const dc = 8 + derived.proficiencyBonus + derived.abilityMods.cha;
  const save = rollEnemySave(campaign.id, enemy, "wis", dc, { resist: true });
  price.commit();
  const rolled = save.autoFailed ? "automatic" : String(save.total);
  if (save.success) {
    patchEnemyConditions(enemy.id, [...enemy.conditions.filter((entry) => entry !== UNMOVED), UNMOVED], {
      ...meta,
      [UNMOVED]: { rounds: DAY_ROUNDS, source: sheet.id },
    });
    publishEncounter(campaign.id);
    return {
      ok: true,
      feature: "Intimidating Presence",
      cost: "their action",
      saved: true,
      applied: `${enemy.displayName} holds its nerve (WIS ${rolled} vs DC ${dc}) and cannot be frightened by ${sheet.name}'s presence again for 24 hours.`,
    };
  }
  const immune = String(enemy.stats.conditionImmune ?? "").toLowerCase().includes("frightened");
  if (immune) {
    return { ok: true, feature: "Intimidating Presence", cost: "their action", applied: `${enemy.displayName} cannot be frightened.` };
  }
  const conditions = enemy.conditions.includes("frightened") ? enemy.conditions : [...enemy.conditions, "frightened"];
  patchEnemyConditions(enemy.id, conditions, { ...meta, frightened: untilTurnEnd(sheet.id, { source: sheet.id }) });
  publishEncounter(campaign.id);
  return {
    ok: true,
    feature: "Intimidating Presence",
    cost: "their action",
    saved: false,
    applied: `${enemy.displayName} fails the WIS save (${rolled} vs DC ${dc}) and is frightened of ${sheet.name} until the end of their next turn. Their action on later turns extends it (use_resource again).`,
  };
}

// ---- Holy Nimbus ----

export const HOLY_NIMBUS = "holy nimbus";
const NIMBUS_FEET = 30;

function holyNimbus(campaign: Campaign, turnId: string, stale: CharacterSheet): Record<string, unknown> {
  const sheet = getSheetById(stale.id) ?? stale;
  const uses = left(sheet, "holy_nimbus");
  if (uses === null) {
    return { error: `${sheet.name} does not have Holy Nimbus (an Oath of Devotion paladin's 20th level feature).` };
  }
  if (uses <= 0) {
    return { error: `${sheet.name} has used Holy Nimbus; it comes back on a long rest.` };
  }
  const price = priceTheAction(sheet, getActiveEncounter(campaign.id), "Holy Nimbus");
  if ("error" in price) {
    return { error: price.error };
  }
  spendUse(campaign, turnId, sheet, "holy_nimbus", "Holy Nimbus");
  const fresh = getSheetById(sheet.id) ?? sheet;
  const meta = { ...(fresh.conditionMeta as ConditionMetaMap), [HOLY_NIMBUS]: { rounds: 10, source: sheet.id } };
  const conditions = fresh.conditions.includes(HOLY_NIMBUS) ? fresh.conditions : [...fresh.conditions, HOLY_NIMBUS];
  patchSheet(sheet.id, { conditions, conditionMeta: meta });
  publishSheet(campaign, sheet.id);
  price.commit();
  return {
    ok: true,
    resource: "Holy Nimbus",
    cost: "their action",
    applied: `${sheet.name} shines with bright light for 30 feet for a minute. Each enemy that starts its turn in it takes 10 radiant damage; the server deals it.`,
  };
}

// The enemies whose turns are starting inside a paladin's nimbus take its
// 10 radiant. Returns the table lines.
export function holyNimbusTurnStart(campaign: Campaign, encounter: Encounter, combatantIds: string[]): string[] {
  const lines: string[] = [];
  const paladins = listSheets(campaign.id)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => sheet.conditions.some((entry) => lower(entry) === HOLY_NIMBUS) && sheet.currentHp > 0);
  if (!paladins.length) {
    return lines;
  }
  const starting = new Set(combatantIds);
  for (const enemy of listEnemies(encounter.id)) {
    if (!starting.has(enemy.id) || enemy.status !== "alive") {
      continue;
    }
    const near = paladins.find((sheet) => {
      const apart = feetBetween(encounter.id, sheet.id, enemy.id);
      return apart === null || apart <= NIMBUS_FEET;
    });
    if (near) {
      burn(campaign, encounter, enemy);
      lines.push(`${enemy.displayName} starts its turn in ${near.name}'s Holy Nimbus and takes 10 radiant damage.`);
    }
  }
  return lines;
}

function burn(campaign: Campaign, encounter: Encounter, enemy: EncounterEnemy) {
  withOpportunityTurn(campaign.id, (turn) => {
    const sheets = listSheets(campaign.id);
    applyEnemyDamage(campaign, turn, encounter, enemy, 10, sheets, new Map(sheets.map((entry) => [entry.id, entry])), "radiant", {
      magical: true,
      holdVictory: true,
    });
  });
}

// ---- Divine Intervention ----

const ANSWERED = "divine_intervention";
const WEEK_MINUTES = 7 * 24 * 60;

function lastAnswer(characterId: string): number | null {
  const row = getDatabase()
    .prepare(`SELECT delta_json FROM sheet_audit WHERE character_id = ? AND kind = ? ORDER BY seq DESC LIMIT 1`)
    .get(characterId, ANSWERED) as { delta_json: string } | undefined;
  const delta = row ? parseJson<{ instant?: number } | null>(row.delta_json, null) : null;
  return typeof delta?.instant === "number" ? delta.instant : null;
}

function divineIntervention(campaign: Campaign, turnId: string, stale: CharacterSheet): Record<string, unknown> {
  const sheet = getSheetById(stale.id) ?? stale;
  const uses = left(sheet, "divine_intervention");
  if (uses === null) {
    return { error: `${sheet.name} does not have Divine Intervention (a cleric's feature from 10th level).` };
  }
  const now = getClock(campaign.id).instant;
  const answered = lastAnswer(sheet.id);
  if (answered !== null && now - answered < WEEK_MINUTES) {
    const days = Math.ceil((WEEK_MINUTES - (now - answered)) / (24 * 60));
    return { error: `${sheet.name}'s deity answered within the last 7 days; Divine Intervention cannot be called for ${days} more day${days === 1 ? "" : "s"}. Nothing was spent.` };
  }
  if (uses <= 0) {
    return { error: `${sheet.name} has called for Divine Intervention since their last long rest; it comes back on a long rest.` };
  }
  const price = priceTheAction(sheet, getActiveEncounter(campaign.id), "Divine Intervention");
  if ("error" in price) {
    return { error: price.error };
  }
  const level = classLevelOf(sheet, "cleric");
  let rolled: number | null = null;
  if (level < 20) {
    const outcome = rollExpression("1d100");
    rolled = outcome.total;
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "ability_check",
      detail: `${sheet.name}: Divine Intervention (at or under ${level})`,
      result: outcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  }
  const intervenes = rolled === null || rolled <= level;
  spendUse(campaign, turnId, sheet, "divine_intervention", "Divine Intervention");
  if (intervenes) {
    insertSheetAudit({
      campaignId: campaign.id,
      characterId: sheet.id,
      turnId,
      kind: ANSWERED,
      delta: { instant: now },
      reason: "the deity intervened",
      seq: allocateSeq(campaign.id),
    });
  }
  publishSheet(campaign, sheet.id);
  price.commit();
  return {
    ok: true,
    resource: "Divine Intervention",
    cost: "their action",
    ...(rolled !== null ? { rolled } : {}),
    intervenes,
    note: intervenes
      ? `The deity intervenes${rolled !== null ? ` (${rolled} at or under ${level})` : ""}. The DM chooses its nature (the effect of any cleric or domain spell fits it) and narrates it; healing it brings goes through heal, harm to enemies through damage_enemy with source environment. Divine Intervention cannot be called again for 7 days.`
      : `No answer (${rolled} is over ${level}). Narrate the silence; ${sheet.name} can call again after a long rest.`,
  };
}
