// The authored subclass features that act as a turn starts or ends and as
// a rest ends (src/lib/srd/authored-effects.ts): Elder Champion's 10 hit
// points, Aura of Conquest and Dread Lord on the enemies near the paladin,
// Protective Spirit, Celestial Resilience. Split from authored-hooks.ts,
// which holds the attack moments.

import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, type Encounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { activeAuthored, resolveFormula } from "@/lib/srd/authored-effects";
import { effectiveMaxHp, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { withinFeet } from "@/lib/dm/authored-saves";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

function fielded(campaignId: string): CharacterSheet[] {
  return listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => !sheet.deathSaves?.dead && sheet.currentHp > 0);
}

function modsOf(sheet: CharacterSheet): Record<string, number> {
  return computeSheetDerived(sheet).abilityMods;
}

function reach(range: number | Array<[number, number]>, level: number): number {
  if (typeof range === "number") {
    return range;
  }
  let feet = range[0]?.[1] ?? 10;
  for (const [atLevel, value] of range) {
    if (level >= atLevel) {
      feet = value;
    }
  }
  return feet;
}

function publishSheet(campaign: Campaign, sheetId: string) {
  const updated = patchSheet(sheetId, {});
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

function heal(campaign: Campaign, sheet: CharacterSheet, amount: number): number {
  const max = effectiveMaxHp(sheet);
  const currentHp = Math.min(max, sheet.currentHp + Math.max(0, amount));
  if (currentHp === sheet.currentHp) {
    return 0;
  }
  patchSheet(sheet.id, { currentHp });
  publishSheet(campaign, sheet.id);
  return currentHp - sheet.currentHp;
}

function setTempHp(campaign: Campaign, sheet: CharacterSheet, amount: number): boolean {
  if (amount <= sheet.tempHp) {
    return false;
  }
  patchSheet(sheet.id, { tempHp: amount });
  publishSheet(campaign, sheet.id);
  return true;
}

// ---- turns ----

// Combatants whose turns are starting: Elder Champion's 10 hit points; an
// enemy near an aura that hurts it (Aura of Conquest on the frightened,
// Dread Lord's darkness).
export function authoredTurnStart(campaign: Campaign, encounter: Encounter, combatantIds: string[]): string[] {
  const lines: string[] = [];
  const holders = fielded(campaign.id);
  for (const id of combatantIds) {
    const sheet = getSheetById(id);
    if (sheet && !sheet.deathSaves?.dead) {
      for (const { effect, held } of activeAuthored(sheet, "turn_heal")) {
        if (effect.when !== "start") {
          continue;
        }
        const amount = rollCard(campaign, null, sheet.id, "custom", `${held.feature}: hit points regained`, resolveFormula(effect.formula, held.level, modsOf(sheet)), null).total;
        const given = heal(campaign, getSheetById(id) ?? sheet, amount);
        if (given > 0) {
          lines.push(`${held.feature}: ${sheet.name} regains ${given} hit points.`);
        }
      }
      continue;
    }
    const enemy = getEnemy(id);
    if (!enemy || enemy.status !== "alive") {
      continue;
    }
    for (const holder of holders) {
      for (const { effect, held } of activeAuthored(holder, "enemy_turn_damage")) {
        const live = getEnemy(id);
        if (!live || live.status !== "alive") {
          break;
        }
        if (!withinFeet(encounter.id, holder.id, id, reach(effect.rangeFt, held.level))) {
          continue;
        }
        if (effect.frightenedOnly) {
          const scared = live.conditions.find((entry) => lower(entry) === "frightened");
          if (!scared || (live.conditionMeta as ConditionMetaMap)[scared]?.source !== holder.id) {
            continue;
          }
        }
        const amount = rollCard(campaign, null, holder.id, "damage", rollAgainst(held.feature, live.displayName), resolveFormula(effect.formula, held.level, modsOf(holder)), sheetAttacker(holder)).total;
        if (amount > 0) {
          lines.push(hurtEnemy(campaign, encounter, live, amount, effect.type, held.feature));
        }
      }
    }
  }
  return lines;
}

// Combatants whose turns are ending: Protective Spirit.
export function authoredTurnEnd(campaign: Campaign, combatantIds: string[]): string[] {
  const lines: string[] = [];
  for (const id of combatantIds) {
    const sheet = getSheetById(id);
    if (!sheet || sheet.deathSaves?.dead || sheet.currentHp <= 0) {
      continue;
    }
    for (const { effect, held } of activeAuthored(sheet, "turn_heal")) {
      if (effect.when !== "end") {
        continue;
      }
      const now = getSheetById(id) ?? sheet;
      if (effect.belowHalf && now.currentHp >= Math.ceil(effectiveMaxHp(now) / 2)) {
        continue;
      }
      const amount = rollCard(campaign, null, now.id, "custom", `${held.feature}: hit points regained`, resolveFormula(effect.formula, held.level, modsOf(now)), null).total;
      const given = heal(campaign, now, amount);
      if (given > 0) {
        lines.push(`${held.feature}: ${now.name} regains ${given} hit points.`);
      }
    }
  }
  return lines;
}

// ---- rests ----

// Celestial Resilience: temporary hit points when a rest ends, for the
// warlock and up to five others. Temporary hit points never stack.
export function authoredRestTempHp(campaign: Campaign, restedIds: string[]): string[] {
  const lines: string[] = [];
  const rested = restedIds.map((id) => getSheetById(id)).filter((sheet): sheet is CharacterSheet => Boolean(sheet && !sheet.deathSaves?.dead));
  for (const holder of rested) {
    for (const { effect, held } of activeAuthored(holder, "rest_temp_hp")) {
      const mods = modsOf(holder);
      const own = Number(resolveFormula(effect.formula, held.level, mods)) || 0;
      if (setTempHp(campaign, getSheetById(holder.id) ?? holder, own)) {
        lines.push(`${held.feature}: ${holder.name} gains ${own} temporary hit points.`);
      }
      if (effect.allies) {
        const each = Number(resolveFormula(effect.allies.formula, held.level, mods)) || 0;
        for (const ally of rested.filter((entry) => entry.id !== holder.id).slice(0, effect.allies.count)) {
          if (setTempHp(campaign, getSheetById(ally.id) ?? ally, each)) {
            lines.push(`${held.feature}: ${ally.name} gains ${each} temporary hit points.`);
          }
        }
      }
    }
  }
  return lines;
}
