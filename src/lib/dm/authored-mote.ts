// Mote of Potential (College of Creation 3): the Bardic Inspiration die a
// Creation bard gives carries a mote (the condition's meta `mote`, written by
// use_resource in resource-tools.ts), and the roll that spends the die sets
// it off:
//
//   - an ability check rolls the die twice and keeps the higher
//     (src/lib/dm/rolls.ts folds "2dXkh1" into the expression);
//   - a saving throw gives the one who rolled temporary hit points equal to
//     the die's roll plus the bard's Charisma modifier (moteAfterRoll, from
//     request_roll and every forced save);
//   - an attack roll's mote bursts on the target: a Constitution save
//     against the bard's spell save DC, or thunder damage equal to a roll of
//     the die (moteBurst, from pc_attack).
//
// The published subclass words the check and the save this way; the
// authored line ("extra damage on an attack, temporary hit points on a
// check, or an ally bonus on a save") is read through it.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { rollExpression, type RollResult } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";

export type HeldMote = { bardId: string; die: string; sides: number };

// The mote riding one of the conditions a roll spends ("a|b|c", as
// resolveRollExpression and the attack's riders list them), or null. Read
// before the spend clears the condition.
export function moteOf(sheet: Pick<CharacterSheet, "conditionMeta">, spent: string | string[] | undefined): HeldMote | null {
  const names = Array.isArray(spent) ? spent : (spent ?? "").split("|");
  const meta = sheet.conditionMeta as ConditionMetaMap & Record<string, { mote?: boolean; source?: string } | undefined>;
  for (const name of names) {
    const match = /^bardic inspiration \((d(\d{1,2}))\)$/i.exec(name.trim());
    const entry = meta[name];
    if (match && entry?.mote && entry.source) {
      return { bardId: entry.source, die: match[1].toLowerCase(), sides: Number(match[2]) };
    }
  }
  return null;
}

// The value the die showed in a roll: its term's subtotal, or a fresh roll
// when the expression did not keep it apart.
function dieValue(outcome: RollResult | null, mote: HeldMote): number {
  const term = outcome?.terms.find((entry) => entry.kind === "dice" && entry.sides === mote.sides);
  return term && term.kind === "dice" ? term.subtotal : rollExpression(`1${mote.die}`).total;
}

// After a saving throw that spent a mote die: its temporary hit points.
export function moteAfterRoll(
  campaign: Campaign,
  stale: CharacterSheet,
  mote: HeldMote | null,
  kind: string,
  outcome: RollResult,
): string | null {
  if (!mote || kind !== "saving_throw") {
    return null;
  }
  const bard = getSheetById(mote.bardId);
  const sheet = getSheetById(stale.id) ?? stale;
  const cha = bard ? computeSheetDerived(bard).abilityMods.cha : 0;
  const amount = Math.max(1, dieValue(outcome, mote) + cha);
  if (amount > sheet.tempHp) {
    const updated = patchSheet(sheet.id, { tempHp: amount });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return `Mote of Potential: ${sheet.name} gains ${amount} temporary hit points.`;
}

// After an attack roll that spent a mote die: the burst on the target.
export function moteBurst(campaign: Campaign, turn: DmTurn, mote: HeldMote | null, target: EncounterEnemy): string | null {
  const encounter = getActiveEncounter(campaign.id);
  const enemy = getEnemy(target.id);
  const bard = mote ? getSheetById(mote.bardId) : null;
  if (!mote || !encounter || !enemy || enemy.status !== "alive") {
    return null;
  }
  const derived = bard ? computeSheetDerived(bard) : null;
  const dc = derived?.spellSaveDc ?? 8 + (derived?.proficiencyBonus ?? 2) + (derived?.abilityMods.cha ?? 0);
  const save = rollEnemySave(campaign.id, enemy, "con", dc, {
    magical: true,
    record: { turn, detail: `${enemy.displayName}: CON save against the mote's burst` },
  });
  if (save.success) {
    return `Mote of Potential: the mote bursts on ${enemy.displayName}, which shrugs it off (CON ${save.total} vs DC ${dc}).`;
  }
  // The mote is the bard's: the burst is theirs.
  const amount = Math.max(1, rollCard(campaign, turn, bard?.id ?? null, "damage", rollAgainst("Mote of Potential", enemy.displayName), `1${mote.die}`, bard ? sheetAttacker(bard) : null).total);
  const sheets = listSheets(campaign.id);
  applyEnemyDamage(campaign, turn, encounter, enemy, amount, sheets, new Map(sheets.map((entry) => [entry.id, entry])), "thunder", { magical: true });
  publishEncounter(campaign.id);
  return `Mote of Potential: the mote bursts on ${enemy.displayName} for ${amount} thunder damage.`;
}
