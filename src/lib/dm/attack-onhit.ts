// What a character's hit carries beyond its damage, resolved by the server
// once the hit is known, on both dice paths (SRD 5.1):
//   - Basic poison (a vial): coats one slashing or piercing weapon; the next
//     creature it hits makes a DC 10 CON save or takes 1d4 poison damage, and
//     the coat is used. The coat dries in a minute.
//   - Open Hand Technique (Way of the Open Hand 3): a Flurry of Blows hit
//     knocks the target prone (DEX save), pushes it up to 15 feet (STR save),
//     or takes its reactions until the end of the monk's next turn.
//   - Hurl Through Hell (The Fiend 14): the creature hit vanishes until the
//     end of the warlock's next turn, then returns and, unless it is a fiend,
//     takes 10d10 psychic damage. Its return is a turn-end hook
//     (src/lib/dm/turn-end.ts).

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { removeConditions, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { pushTokenAway } from "@/lib/dm/map-tools";
import { withOpportunityTurn } from "@/lib/dm/opportunity-strike";
import { untilTurnEnd } from "@/lib/dm/turn-end";
import {
  HURLED,
  HURL_THROUGH_HELL,
  OPEN_HAND_CHOICES,
  OPEN_HAND_REELING,
  hasOpenHandTechnique,
  hurlProblem,
  type OpenHandChoice,
} from "@/lib/dm/attack-choice-rules";
import { matchWeapon } from "@/lib/srd/weapons";
import { poisonAt } from "@/lib/srd/table-hazards";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const lower = (value: string) => value.trim().toLowerCase();

function publishRoll(campaignId: string, roll: ReturnType<typeof insertRoll>) {
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll, source: "digital" });
}

// Typed damage on an enemy with a short turn for its audit rows, outside the
// hit's own damage roll.
function damageEnemy(campaign: Campaign, enemy: EncounterEnemy, amount: number, type: string) {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || amount <= 0) {
    return;
  }
  withOpportunityTurn(campaign.id, (turn) => {
    const sheets = listSheets(campaign.id);
    applyEnemyDamage(campaign, turn, encounter, enemy, amount, sheets, new Map(sheets.map((entry) => [entry.id, entry])), type, {
      magical: true,
    });
  });
}

// ---- counters a hit spends ----

// Spends one use of a feature's counter the hit (or the miss it rescued)
// paid for, with its audit row. False when none was left.
export function spendFeatureUse(campaign: Campaign, sheetId: string, resourceId: string, label: string): boolean {
  const sheet = getSheetById(sheetId);
  const state = sheet?.resources?.[resourceId];
  if (!sheet || !state || state.max - state.used <= 0) {
    return false;
  }
  const patch = { resources: { ...sheet.resources, [resourceId]: { max: state.max, used: state.used + 1 } } };
  const updated = patchSheet(sheet.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId: null,
    kind: "use_resource",
    delta: { resource: label, spent: 1 },
    reason: label,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return true;
}

// ---- basic poison, and the SRD's injury poisons ----

export const POISON_COAT = "poisoned weapon";
const BASIC_POISON = /\bpoison\b.*\bbasic\b|\bbasic\b.*\bpoison\b/i;

// What a vial coats a blade with: basic poison (DC 10, 1d4, no half), or an
// injury poison from the SRD list (Drow Poison, Serpent Venom, Purple Worm
// Poison, Wyvern Poison: src/lib/srd/afflictions.ts) or the table's workshop
// (src/lib/srd/table-hazards.ts). Null for anything else.
function coatOf(itemName: string, campaignId?: string): { name: string; dc: number; damage?: string; halfOnSave?: boolean; conditions?: string[]; minutes?: number; unconsciousIfFailBy?: number } | null {
  if (BASIC_POISON.test(itemName)) {
    return { name: "basic poison", dc: 10, damage: "1d4" };
  }
  const poison = poisonAt(itemName, campaignId);
  return poison && poison.type === "injury" ? poison : null;
}

export function isBasicPoison(itemName: string, campaignId?: string): boolean {
  return coatOf(itemName, campaignId) !== null;
}

function slashesOrPierces(damage: string): boolean {
  return /slashing|piercing/i.test(damage);
}

// Why the vial cannot be used, before it is spent: nothing to coat.
export function poisonCoatRefusal(sheet: CharacterSheet, itemName: string): string | null {
  if (!isBasicPoison(itemName, sheet.campaignId)) {
    return null;
  }
  const coatable = sheet.equipment.some((item) => {
    const weapon = matchWeapon(item.name);
    return Boolean(weapon && slashesOrPierces(weapon.damage)) || /\b(arrows?|bolts?|needles?)\b/i.test(item.name);
  });
  return coatable
    ? null
    : `${sheet.name} carries no slashing or piercing weapon or ammunition to coat with the poison; the vial stays in the pack.`;
}

// The vial just used: the coat goes on, for a minute (ten rounds). Which
// poison it is rides in the coat's source.
export function coatWithPoison(campaign: Campaign, user: CharacterSheet, itemName: string): Record<string, unknown> | null {
  const coat = coatOf(itemName, campaign.id);
  if (!coat) {
    return null;
  }
  const fresh = getSheetById(user.id) ?? user;
  const meta: ConditionMetaMap = { ...(fresh.conditionMeta as ConditionMetaMap), [POISON_COAT]: { rounds: 10, source: coat.name.toLowerCase() } };
  const conditions = fresh.conditions.some((entry) => lower(entry) === POISON_COAT) ? fresh.conditions : [...fresh.conditions, POISON_COAT];
  const updated = patchSheet(fresh.id, { conditions, conditionMeta: meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  const effect = coat.damage
    ? `takes ${coat.damage} poison damage${coat.halfOnSave ? " (half on a success)" : ""}`
    : `is ${(coat.conditions ?? ["poisoned"]).join(" and ")}${coat.unconsciousIfFailBy ? ", and unconscious as well on a failure by 5 or more" : ""}`;
  return {
    applied: `${fresh.name}'s weapon is coated with ${coat.name}: the next creature it hits within a minute makes a DC ${coat.dc} Constitution save or ${effect}. The server rolls both.`,
  };
}

// Whether this hit carries the coat: a weapon that slashes or pierces.
export function carriesPoison(sheet: CharacterSheet, weaponAttack: boolean, damageType: string): boolean {
  return (
    weaponAttack &&
    slashesOrPierces(damageType) &&
    sheet.conditions.some((entry) => lower(entry) === POISON_COAT)
  );
}

// The coated hit: the coat is used, the creature saves, and a failure takes
// the poison's damage or its condition. Returns the line for the result.
export function poisonOnHit(campaign: Campaign, sheetId: string, enemyId: string): string | null {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return null;
  }
  const coat = coatOf(String((sheet.conditionMeta as ConditionMetaMap)[POISON_COAT]?.source ?? "basic poison"), campaign.id) ?? coatOf("basic poison");
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, [POISON_COAT]);
  const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  const enemy = getEnemy(enemyId);
  if (!coat || !enemy || enemy.status !== "alive") {
    return "The poison's coat is spent on the blow.";
  }
  const label = coat.name.charAt(0).toUpperCase() + coat.name.slice(1);
  const save = rollEnemySave(campaign.id, enemy, "con", coat.dc);
  if (save.success && !(coat.damage && coat.halfOnSave)) {
    return `${label}: ${enemy.displayName} holds (CON save ${save.total} vs DC ${coat.dc}); the coat is spent.`;
  }
  const lines: string[] = [];
  if (coat.damage) {
    const outcome = rollExpression(coat.damage);
    const dealt = save.success ? Math.floor(outcome.total / 2) : outcome.total;
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "damage",
      detail: rollAgainst(label, enemy.displayName),
      result: outcome,
      attacker: { kind: "sheet", id: sheet.id, name: sheet.name },
    });
    publishRoll(campaign.id, roll);
    damageEnemy(campaign, enemy, dealt, "poison");
    lines.push(`${label}: ${enemy.displayName} ${save.success ? "saves" : "fails the CON save"} (${save.autoFailed ? "automatic" : save.total} vs DC ${coat.dc}) and takes ${dealt} poison damage.`);
  }
  if (!save.success && coat.conditions?.length) {
    const fresh = getEnemy(enemyId);
    if (fresh && fresh.status === "alive") {
      const failBy = save.autoFailed ? 99 : coat.dc - (save.total ?? 0);
      const laid = [...coat.conditions, ...(coat.unconsciousIfFailBy && failBy >= coat.unconsciousIfFailBy ? ["unconscious"] : [])];
      const rounds = Math.min(14400, Math.max(1, Math.round((coat.minutes ?? 1) * 10)));
      const meta: ConditionMetaMap = { ...(fresh.conditionMeta as ConditionMetaMap) };
      for (const name of laid) {
        meta[name] = { rounds, source: coat.name, ...(name === "unconscious" ? { endsOnDamage: true } : {}) };
      }
      patchEnemyConditions(fresh.id, [...new Set([...fresh.conditions, ...laid])], meta);
      publishEncounter(campaign.id);
      lines.push(`${label}: ${enemy.displayName} fails the CON save (${save.autoFailed ? "automatic" : save.total} vs DC ${coat.dc}) and is ${laid.join(" and ")}.`);
    }
  }
  return lines.join(" ") || `${label}: the coat is spent.`;
}

// ---- Open Hand Technique ----

// Who may declare it, and the words it writes, are pure and shared with the
// player's Hand (src/lib/dm/attack-choice-rules.ts).
export { OPEN_HAND_CHOICES, OPEN_HAND_REELING, hasOpenHandTechnique, type OpenHandChoice };

export function openHandOnHit(
  campaign: Campaign,
  monkId: string,
  enemyId: string,
  choice: OpenHandChoice,
  dc: number,
): string {
  const enemy = getEnemy(enemyId);
  if (!enemy || enemy.status !== "alive") {
    return "Open Hand Technique: the target is already down.";
  }
  if (choice === "no reactions") {
    const meta: ConditionMetaMap = {
      ...(enemy.conditionMeta as ConditionMetaMap),
      [OPEN_HAND_REELING]: untilTurnEnd(monkId, { source: monkId }),
    };
    const conditions = enemy.conditions.includes(OPEN_HAND_REELING) ? enemy.conditions : [...enemy.conditions, OPEN_HAND_REELING];
    patchEnemyConditions(enemy.id, conditions, meta);
    publishEncounter(campaign.id);
    return `Open Hand Technique: ${enemy.displayName} cannot take reactions until the end of the monk's next turn.`;
  }
  const ability = choice === "prone" ? "dex" : "str";
  const save = rollEnemySave(campaign.id, enemy, ability, dc);
  const rolled = save.autoFailed ? "automatic" : String(save.total);
  if (save.success) {
    return `Open Hand Technique: ${enemy.displayName} holds (${ability.toUpperCase()} save ${rolled} vs DC ${dc}).`;
  }
  if (choice === "prone") {
    if (!enemy.conditions.includes("prone")) {
      patchEnemyConditions(enemy.id, [...enemy.conditions, "prone"], enemy.conditionMeta);
      publishEncounter(campaign.id);
    }
    return `Open Hand Technique: ${enemy.displayName} fails the DEX save (${rolled} vs DC ${dc}) and is knocked prone.`;
  }
  let moved = 0;
  let stopped = "";
  for (let step = 0; step < 3; step += 1) {
    const push = pushTokenAway(campaign, enemy.encounterId, monkId, enemy.id);
    if (!push.moved) {
      stopped = push.reason;
      break;
    }
    moved += 5;
  }
  return `Open Hand Technique: ${enemy.displayName} fails the STR save (${rolled} vs DC ${dc}) and is pushed ${moved} feet${
    stopped && moved < 15 ? ` (${stopped})` : ""
  }.`;
}

// ---- Hurl Through Hell ----

export { HURLED, HURL_THROUGH_HELL, hurlProblem };

// The hit creature is gone through the lower planes: out of reach and out of
// the fight until the end of the warlock's next turn.
export function hurlThroughHell(campaign: Campaign, warlockId: string, enemyId: string): string {
  const enemy = getEnemy(enemyId);
  if (!enemy || enemy.status !== "alive") {
    return "Hurl Through Hell: the target is already down.";
  }
  const meta: ConditionMetaMap = { ...(enemy.conditionMeta as ConditionMetaMap) };
  const conditions = [...enemy.conditions];
  for (const name of [HURLED, ...(conditions.includes("incapacitated") ? [] : ["incapacitated"])]) {
    if (!conditions.includes(name)) {
      conditions.push(name);
    }
    meta[name] = untilTurnEnd(warlockId, { source: warlockId });
  }
  patchEnemyConditions(enemy.id, conditions, meta);
  publishEncounter(campaign.id);
  return `Hurl Through Hell: ${enemy.displayName} vanishes through the lower planes until the end of the warlock's next turn.`;
}

// The return, as the warlock's next turn ends: 10d10 psychic unless a fiend.
export function hurlReturn(campaign: Campaign, enemy: EncounterEnemy, meta: ConditionMeta): string | null {
  if (enemy.status !== "alive") {
    return null;
  }
  if (/fiend/i.test(String(enemy.stats.type ?? ""))) {
    return `${enemy.displayName} returns from the lower planes unharmed: it is a fiend.`;
  }
  const outcome = rollExpression("10d10");
  const warlock = meta.source ? getSheetById(meta.source) : null;
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: meta.source ?? null,
    requestedBy: "dm",
    kind: "damage",
    detail: rollAgainst("Hurl Through Hell", enemy.displayName),
    result: outcome,
    attacker: warlock ? { kind: "sheet", id: warlock.id, name: warlock.name } : null,
  });
  publishRoll(campaign.id, roll);
  damageEnemy(campaign, enemy, outcome.total, "psychic");
  return `${enemy.displayName} returns from the lower planes, reeling from the horror, and takes ${outcome.total} psychic damage (Hurl Through Hell).`;
}
