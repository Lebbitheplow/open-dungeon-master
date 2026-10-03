// The SRD class features the final recount found spent through use_resource
// with nothing behind them (SRD 5.1):
//
//   - Peerless Skill (College of Lore 14): a Bardic Inspiration use adds the
//     die to the bard's own next ability check ("peerless skill (dX)", spent
//     by that check in src/lib/dm/rolls.ts).
//   - Quivering Palm (Way of the Open Hand 17): 3 ki after the monk's
//     unarmed strike sets the vibrations in a creature they attacked this
//     turn; the monk's action ends them later: a CON save against the ki DC,
//     0 hit points on a failure and 10d10 necrotic on a success.
//   - Draconic Presence (Draconic Bloodline 18): 5 sorcery points and the
//     action; creatures of the sorcerer's choice within 60 feet make a WIS
//     save or are charmed (variant "charm") or frightened (the default) for a
//     minute, held by the sorcerer's concentration.
//   - Hide in Plain Sight (ranger 10): a minute of camouflage outside a
//     fight: "camouflaged", +10 to Stealth checks (a condition-effects row).
//   - Primeval Awareness (ranger 3): a spell slot (the level in `amount`, else
//     the lowest free one) for a minute a level of sensing.
//
// Called from the use_resource arm of src/lib/dm/mutations.ts before the
// generic path; must not import mutations.ts. The action-pricing helpers are
// combat-features.ts's.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { classLevelOf, holdsFeature } from "@/lib/srd/trait-rules";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { setConcentration } from "@/lib/dm/concentration";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { getDmTurn } from "@/lib/db/dm-turns";
import { feetBetween, priceTheAction, publishSheet } from "@/lib/dm/combat-features";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

export type SrdSpendArgs = { variant?: string; targetEnemyId?: string; amount?: number };

export function srdFeatureSpend(
  campaign: Campaign,
  turnId: string,
  stale: CharacterSheet,
  resourceName: string,
  args: SrdSpendArgs,
): Record<string, unknown> | null {
  const name = lower(resourceName);
  const sheet = getSheetById(stale.id) ?? stale;
  if (name === "peerless skill") return peerlessSkill(campaign, sheet);
  if (name === "quivering palm") return quiveringPalm(campaign, turnId, sheet, args.targetEnemyId);
  if (name === "draconic presence") return draconicPresence(campaign, turnId, sheet, args);
  if (name === "hide in plain sight") return hideInPlainSight(campaign, sheet);
  if (name === "primeval awareness") return primevalAwareness(campaign, sheet, args.amount);
  return null;
}

function spendPool(campaign: Campaign, sheet: CharacterSheet, id: string, amount: number) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const state = fresh.resources[id];
  const updated = patchSheet(fresh.id, { resources: { ...fresh.resources, [id]: { max: state.max, used: state.used + amount } } });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

function poolLeft(sheet: CharacterSheet, id: string): number {
  const state = sheet.resources?.[id];
  return state ? state.max - state.used : 0;
}

function addCondition(campaign: Campaign, sheet: CharacterSheet, condition: string, meta: Record<string, unknown>) {
  const fresh = getSheetById(sheet.id) ?? sheet;
  const kept = fresh.conditions.filter((entry) => lower(entry) !== lower(condition));
  patchSheet(fresh.id, {
    conditions: [...kept, condition],
    conditionMeta: { ...(fresh.conditionMeta as ConditionMetaMap), [condition]: meta },
  });
  publishSheet(campaign, fresh.id);
}

// ---- Peerless Skill ----

function peerlessSkill(campaign: Campaign, sheet: CharacterSheet): Record<string, unknown> {
  if (!holdsFeature(sheet, "peerless skill")) {
    return { error: `${sheet.name} does not have Peerless Skill (a College of Lore bard's 14th level feature).` };
  }
  if (poolLeft(sheet, "bardic_inspiration") < 1) {
    return { error: `${sheet.name} has no Bardic Inspiration left for Peerless Skill. Nothing was spent.` };
  }
  const level = classLevelOf(sheet, "bard") || sheet.level;
  const die = level >= 15 ? "d12" : level >= 10 ? "d10" : level >= 5 ? "d8" : "d6";
  spendPool(campaign, sheet, "bardic_inspiration", 1);
  addCondition(campaign, sheet, `peerless skill (${die})`, { rounds: 10 });
  return { ok: true, resource: "Peerless Skill", applied: `${sheet.name} adds 1${die} to their next ability check; the server rolls it with the check and spends it.` };
}

// ---- Quivering Palm ----

export const QUIVERING = "quivering palm";

function quiveringPalm(campaign: Campaign, turnId: string, sheet: CharacterSheet, targetEnemyId: string | undefined): Record<string, unknown> {
  if (!holdsFeature(sheet, "quivering palm")) {
    return { error: `${sheet.name} does not have Quivering Palm (a Way of the Open Hand monk's 17th level feature).` };
  }
  const encounter = getActiveEncounter(campaign.id);
  const enemy = encounter && targetEnemyId ? resolveEnemyRef(encounter.id, targetEnemyId) : null;
  if (!encounter || !enemy || enemy.status !== "alive") {
    return { error: "Quivering Palm needs targetEnemyId: the living creature the monk struck. Nothing was spent." };
  }
  const meta = enemy.conditionMeta as ConditionMetaMap;
  const set = enemy.conditions.includes(QUIVERING) && meta[QUIVERING]?.source === sheet.id;
  const derived = computeSheetDerived(sheet);
  const dc = 8 + derived.proficiencyBonus + derived.abilityMods.wis;
  if (!set) {
    const struck = encounter.targets?.round === encounter.round ? (encounter.targets.pairs[sheet.id] ?? []) : [];
    if (!struck.includes(enemy.id)) {
      return { error: `Quivering Palm sets its vibrations with an unarmed strike that hits; ${sheet.name} has not struck ${enemy.displayName} this turn. Nothing was spent.` };
    }
    if (poolLeft(sheet, "ki") < 3) {
      return { error: `${sheet.name} needs 3 ki for Quivering Palm. Nothing was spent.` };
    }
    spendPool(campaign, sheet, "ki", 3);
    patchEnemyConditions(enemy.id, [...enemy.conditions, QUIVERING], {
      ...meta,
      [QUIVERING]: { source: sheet.id, rounds: 14400 },
    } as typeof enemy.conditionMeta);
    publishEncounter(campaign.id);
    return { ok: true, resource: "Quivering Palm", spent: "3 ki", applied: `Vibrations settle in ${enemy.displayName}. ${sheet.name} ends them with their action later (use_resource Quivering Palm again): a CON save against DC ${dc}.` };
  }
  const price = priceTheAction(sheet, encounter, "ending Quivering Palm");
  if ("error" in price) {
    return { error: price.error };
  }
  const cleared = enemy.conditions.filter((entry) => entry !== QUIVERING);
  const rest = { ...meta };
  delete rest[QUIVERING];
  patchEnemyConditions(enemy.id, cleared, rest as typeof enemy.conditionMeta);
  const save = rollEnemySave(campaign.id, enemy, "con", dc, { record: { detail: `${enemy.displayName}: CON save against Quivering Palm` } });
  price.commit();
  const live = listEnemies(encounter.id).find((entry) => entry.id === enemy.id) ?? enemy;
  const amount = save.success ? rollCard(campaign, null, sheet.id, "damage", rollAgainst("Quivering Palm", live.displayName), "10d10", sheetAttacker(sheet)).total : live.currentHp;
  const sheets = listSheets(campaign.id);
  const turn = getDmTurn(turnId);
  // The damage path wants the DM turn; off one, the aura path lands it.
  const applied = turn
    ? applyEnemyDamage(campaign, turn, encounter, live, amount, sheets, new Map(sheets.map((entry) => [entry.id, entry])), save.success ? "necrotic" : undefined)
    : { applied: hurtEnemy(campaign, encounter, live, amount, save.success ? "necrotic" : "", "Quivering Palm") };
  publishEncounter(campaign.id);
  return {
    ok: true,
    resource: "Quivering Palm",
    cost: "their action",
    save: save.total,
    dc,
    applied: save.success ? `${enemy.displayName} resists the vibrations and takes ${amount} necrotic damage.` : `${enemy.displayName} fails the CON save and drops to 0 hit points.`,
    ...applied,
  };
}

// ---- Draconic Presence ----

function draconicPresence(campaign: Campaign, turnId: string, sheet: CharacterSheet, args: SrdSpendArgs): Record<string, unknown> {
  if (!holdsFeature(sheet, "draconic presence")) {
    return { error: `${sheet.name} does not have Draconic Presence (a Draconic Bloodline sorcerer's 18th level feature).` };
  }
  if (poolLeft(sheet, "sorcery_points") < 5) {
    return { error: `${sheet.name} needs 5 sorcery points for Draconic Presence. Nothing was spent.` };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "Draconic Presence answers creatures in a fight; there is none. Nothing was spent." };
  }
  const condition = /charm/.test(lower(args.variant)) ? "charmed" : "frightened";
  const chosen: EncounterEnemy[] = args.targetEnemyId
    ? [resolveEnemyRef(encounter.id, args.targetEnemyId)].filter((enemy): enemy is EncounterEnemy => Boolean(enemy))
    : listEnemies(encounter.id).filter((enemy) => {
        const feet = feetBetween(encounter.id, sheet.id, enemy.id);
        return feet === null || feet <= 60;
      });
  const targets = chosen.filter((enemy) => enemy.status === "alive");
  if (!targets.length) {
    return { error: "No living creature of the sorcerer's choice stands within 60 feet. Nothing was spent." };
  }
  const price = priceTheAction(sheet, encounter, "Draconic Presence");
  if ("error" in price) {
    return { error: price.error };
  }
  spendPool(campaign, sheet, "sorcery_points", 5);
  price.commit();
  setConcentration(campaign, turnId, sheet.id, "Draconic Presence");
  const dc = computeSheetDerived(sheet).spellSaveDc ?? 13;
  const lines: string[] = [];
  for (const enemy of targets) {
    const save = rollEnemySave(campaign.id, enemy, "wis", dc, { magical: true, record: { detail: `${enemy.displayName}: WIS save against Draconic Presence` } });
    const immune = String(enemy.stats.conditionImmune ?? "").toLowerCase().includes(condition);
    if (save.success || immune) {
      lines.push(`${enemy.displayName} ${immune ? `cannot be ${condition}` : `resists (WIS ${save.total} vs DC ${dc})`}.`);
      continue;
    }
    patchEnemyConditions(enemy.id, [...enemy.conditions.filter((entry) => entry !== condition), condition], {
      ...(enemy.conditionMeta as ConditionMetaMap),
      [condition]: { source: sheet.id, spell: "Draconic Presence", rounds: 10 },
    } as typeof enemy.conditionMeta);
    lines.push(`${enemy.displayName} is ${condition} for a minute.`);
  }
  publishEncounter(campaign.id);
  return { ok: true, resource: "Draconic Presence", spent: "5 sorcery points", cost: "their action", concentration: "Draconic Presence", applied: lines };
}

// ---- Hide in Plain Sight ----

export const CAMOUFLAGED = "camouflaged";

function hideInPlainSight(campaign: Campaign, sheet: CharacterSheet): Record<string, unknown> {
  if (!holdsFeature(sheet, "hide in plain sight")) {
    return { error: `${sheet.name} does not have Hide in Plain Sight (a ranger's 10th level feature).` };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter && (encounter.kind ?? "fight") === "fight") {
    return { error: "Hide in Plain Sight takes a minute of preparation, not a moment in the middle of a fight." };
  }
  addCondition(campaign, sheet, CAMOUFLAGED, { rounds: 14400 });
  return { ok: true, resource: "Hide in Plain Sight", applied: `${sheet.name} is camouflaged against a solid surface: +10 to Stealth checks while they stay still. Moving, or taking an action or reaction, ends it (clear_condition camouflaged).` };
}

// ---- Primeval Awareness ----

function primevalAwareness(campaign: Campaign, sheet: CharacterSheet, amount: number | undefined): Record<string, unknown> {
  if (!holdsFeature(sheet, "primeval awareness")) {
    return { error: `${sheet.name} does not have Primeval Awareness (a ranger's 3rd level feature).` };
  }
  const slots = sheet.spellcasting?.slots ?? {};
  const wanted = amount && amount >= 1 ? Math.floor(amount) : null;
  const level = wanted ?? Object.keys(slots).map(Number).sort((a, b) => a - b).find((entry) => slots[String(entry)].used < slots[String(entry)].max);
  const slot = level ? slots[String(level)] : undefined;
  if (!level || !slot || slot.used >= slot.max || !sheet.spellcasting) {
    return { error: `${sheet.name} has no free spell slot${wanted ? ` of level ${wanted}` : ""} to spend on Primeval Awareness. Nothing was spent.` };
  }
  const updated = patchSheet(sheet.id, {
    spellcasting: { ...sheet.spellcasting, slots: { ...slots, [String(level)]: { max: slot.max, used: slot.used + 1 } } },
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return {
    ok: true,
    resource: "Primeval Awareness",
    spent: `a level ${level} spell slot`,
    applied: `For ${level} minute${level === 1 ? "" : "s"}, ${sheet.name} senses whether aberrations, celestials, dragons, elementals, fey, fiends or undead are within 1 mile (6 in their favored terrain): their kind, not their number or place.`,
  };
}
