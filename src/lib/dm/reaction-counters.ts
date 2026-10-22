// The limited-use reactions spent through use_resource that act on the hit
// that triggered them, or on dropping to 0 (issue 233). Before this the use
// and the reaction were spent and the effect was the guidance line: Stone's
// Endurance took nothing off the blow, Swarming Dispersal resisted nothing,
// and Strength before Death and Necrotic Husk could never be used at all.
//
//   Stone's Endurance (VGtM goliath): the damage less 1d12 + Constitution.
//   Swarming Dispersal (Swarmkeeper 15): resistance to that damage.
//   One with the Word (Order of Scribes 14): none of it, while the Manifest
//     Mind is out; 3d6 spell levels leave the book until 1d6 long rests pass.
//   Warding Maneuver (Cavalier 3): 1d8 on the AC of the one hit (the
//     fighter, or a creature within 5 feet), and resistance if it still hits.
//   Necrotic Husk (Undead warlock 10): 1 hit point instead of 0, 2d10 + the
//     warlock level necrotic to each enemy within 30 feet, a level of
//     exhaustion, and no use again for 1d4 long rests.
//   Strength before Death (Samurai 18): the fall is put off for an extra turn
//     taken right away; at its end they fall unconscious if still at 0.
//
// Each is planned before the use is spent, so a missing trigger costs
// nothing, and applied once it is. The re-resolution of a hit goes through
// settleLastHit like every reaction that changes one (reaction-refund.ts).
// Called from use_resource in src/lib/dm/mutations.ts; must not import it.

import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, listEnemies, saveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { classLevelFor } from "@/lib/srd/multiclass";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollCard } from "@/lib/dm/roll-card";
import { freshLastHit, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import { settleLastHit } from "@/lib/dm/reaction-refund";
import { pcResistances, removeConditions } from "@/lib/dm/condition-logic";
import { HOLDING_ON, PRONE, UNCONSCIOUS, exhaustionPatch } from "@/lib/dm/vitals-logic";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { acBreakdownFor } from "@/lib/srd";
import { matchWeapon } from "@/lib/srd/weapons";
import type { ToolError } from "@/lib/dm/tool-errors";

export const MANIFEST_MIND = "manifest mind";
// The marker a use that recharges over several long rests leaves, with the
// rests still to pass in its name (rest-logic.ts counts it down).
export const HUSK_RECOVERING = "necrotic husk recovering";

type Plan = { apply: () => Record<string, unknown> };
type Input = {
  campaign: Campaign;
  turnId: string;
  sheet: CharacterSheet;
  defId: string;
  targetCharacterId?: string;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
};

const has = (conditions: string[], name: string) => conditions.some((entry) => entry.trim().toLowerCase() === name);

// The fresh damage on a character that a reaction to it can still answer.
function damageOn(campaignId: string, target: CharacterSheet, label: string): LastHit | null {
  const record = freshLastHit(campaignId, target.id);
  if (!record || record.answered.includes(label)) {
    return null;
  }
  return record.swings.some((swing) => swing.hit && swing.raw > 0) ? record : null;
}

// Damage taken off a record, the heaviest blow first.
function lessDamage(swings: SwingRecord[], amount: number): SwingRecord[] {
  let left = Math.max(0, amount);
  const order = swings.map((swing, index) => ({ swing, index })).sort((a, b) => b.swing.raw - a.swing.raw);
  const next = swings.map((swing) => ({ ...swing }));
  for (const { index } of order) {
    if (left <= 0) break;
    const take = Math.min(left, next[index].raw);
    next[index].raw -= take;
    left -= take;
  }
  return next;
}

function settle(input: Input, record: LastHit, corrected: SwingRecord[], label: string) {
  return settleLastHit(input.campaign, input.turnId, record, corrected, label, input.sheets, input.sheetsById);
}

function publishSheet(campaign: Campaign, id: string) {
  const updated = patchSheet(id, {});
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// Whether the hit just recorded is the one that dropped them to 0.
function droppedByFreshHit(campaignId: string, sheet: CharacterSheet): boolean {
  const record = freshLastHit(campaignId, sheet.id);
  return Boolean(record && record.before.currentHp > 0 && sheet.currentHp <= 0 && !sheet.deathSaves?.dead);
}

export function planCounterReaction(input: Input): Plan | ToolError | null {
  const { campaign, sheet } = input;
  const turn = getDmTurn(input.turnId);
  if ((input.defId === "sub_necrotic_husk" || input.defId === "sub_strength_before_death") && !droppedByFreshHit(campaign.id, sheet)) {
    const name = input.defId === "sub_necrotic_husk" ? "Necrotic Husk" : "Strength before Death";
    return {
      error: `${name} is taken as the damage that reduces ${sheet.name} to 0 hit points lands, and the server has no such hit on them just now${sheet.currentHp > 0 ? " (they are not down)" : ""}. Nothing was spent.`,
      refused: "rules",
    };
  }
  switch (input.defId) {
    case "race_stones_endurance": {
      const record = damageOn(campaign.id, sheet, "stone's endurance");
      if (!record) {
        return { error: `Stone's Endurance answers damage ${sheet.name} has just taken, and the server has none on record to reduce. Nothing was spent.`, refused: "rules" };
      }
      return {
        apply: () => {
          const con = computeSheetDerived(sheet).abilityMods.con;
          const expression = `1d12${con >= 0 ? "+" : ""}${con}`;
          const rolled = Math.max(0, rollCard(campaign, turn, sheet.id, "custom", `${sheet.name}: Stone's Endurance`, expression, null).total);
          const settled = settle(input, record, lessDamage(record.swings, rolled), "stone's endurance");
          return { rolled: `${expression}: ${rolled}`, applied: `The damage is reduced by ${rolled}: ${settled.given} hit points come back. HP ${settled.hp}.`, ...(settled.notes.length ? { notes: settled.notes } : {}) };
        },
      };
    }
    case "sub_swarming_dispersal": {
      const record = damageOn(campaign.id, sheet, "swarming dispersal");
      if (!record) {
        return { error: `Swarming Dispersal answers damage ${sheet.name} has just taken, and the server has none on record. Nothing was spent.`, refused: "rules" };
      }
      const resisted = pcResistances(sheet).toLowerCase();
      return {
        apply: () => {
          const corrected = record.swings.map((swing) =>
            swing.hit && !resisted.includes((swing.type ?? record.type).toLowerCase()) ? { ...swing, raw: Math.floor(swing.raw / 2) } : swing,
          );
          const settled = settle(input, record, corrected, "swarming dispersal");
          return { applied: `${sheet.name} resists that damage: ${settled.given} hit points come back. HP ${settled.hp}. They vanish into the swarm and reappear up to 30 feet away (move_token forced on the map).` };
        },
      };
    }
    case "sub_one_with_the_word": {
      if (!has(sheet.conditions, MANIFEST_MIND)) {
        return { error: `One with the Word works while ${sheet.name}'s Manifest Mind is summoned, and it is not (use_resource Manifest Mind summons it). Nothing was spent.`, refused: "rules" };
      }
      const record = damageOn(campaign.id, sheet, "one with the word");
      if (!record) {
        return { error: `One with the Word prevents damage ${sheet.name} has just taken, and the server has none on record. Nothing was spent.`, refused: "rules" };
      }
      return {
        apply: () => {
          const settled = settle(input, record, record.swings.map((swing) => ({ ...swing, raw: 0 })), "one with the word");
          const levels = rollCard(campaign, turn, sheet.id, "custom", `${sheet.name}: One with the Word`, "3d6", null).total;
          const now = getSheetById(sheet.id) ?? sheet;
          const cleared = removeConditions(now.conditions, now.conditionMeta, [MANIFEST_MIND]);
          patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
          publishSheet(campaign, sheet.id);
          return {
            applied: `All of that damage is prevented: ${settled.given} hit points come back. HP ${settled.hp}. The Manifest Mind is dismissed.`,
            spellbook: `Spells of ${sheet.name}'s choice with ${levels} or more spell levels between them vanish from the book until 1d6 long rests pass, and cannot be cast meanwhile. The player names them; the lead takes them off the sheet's book.`,
          };
        },
      };
    }
    case "sub_warding_maneuver": {
      const target = input.targetCharacterId ? (getSheetById(input.targetCharacterId) ?? null) : sheet;
      if (!target) {
        return { error: "Warding Maneuver protects the fighter or a creature within 5 feet: pass that creature's targetCharacterId. Nothing was spent.", retry: true };
      }
      const encounter = getActiveEncounter(campaign.id);
      const apart = encounter && target.id !== sheet.id ? tilesBetween(encounter.id, sheet.id, target.id) : null;
      if (apart !== null && apart > 1) {
        return { error: `${target.name} is ${apart * 5} ft from ${sheet.name}; Warding Maneuver covers a creature within 5 feet. Nothing was spent.`, refused: "rules" };
      }
      const armed = Boolean(acBreakdownFor(sheet).shieldName) || sheet.equipment.some((item) => item.equipped && matchWeapon(item)?.kind === "melee");
      if (!armed) {
        return { error: `Warding Maneuver needs ${sheet.name} wielding a melee weapon or a shield. Nothing was spent.`, refused: "rules" };
      }
      const record = freshLastHit(campaign.id, target.id);
      const index = record && record.source === "attack" && !record.answered.includes("warding maneuver")
        ? record.swings.reduce((best, swing, at) => (swing.hit && (best < 0 || swing.raw > record.swings[best].raw) ? at : best), -1)
        : -1;
      if (!record || index < 0) {
        return { error: `Warding Maneuver answers an attack that has just hit ${target.name}, and the server has none on record. Nothing was spent.`, refused: "rules" };
      }
      return {
        apply: () => {
          const die = rollCard(campaign, turn, sheet.id, "custom", `${sheet.name}: Warding Maneuver`, "1d8", null).total;
          const swing = record.swings[index];
          const missed = swing.natural !== 20 && swing.total < swing.vsAc + die;
          const corrected = record.swings.map((entry, at) =>
            at !== index ? entry : missed ? { ...entry, hit: false, raw: 0 } : { ...entry, raw: Math.floor(entry.raw / 2) },
          );
          const settled = settle(input, record, corrected, "warding maneuver");
          return {
            rolled: `1d8: ${die}`,
            applied: missed
              ? `AC ${swing.vsAc} + ${die} turns the ${swing.total} into a miss on ${target.name}: ${settled.given} hit points come back. HP ${settled.hp}.`
              : `AC ${swing.vsAc} + ${die} against ${swing.total}: the attack still hits, and ${target.name} resists its damage: ${settled.given} hit points come back. HP ${settled.hp}.`,
          };
        },
      };
    }
    case "sub_necrotic_husk":
      return {
        apply: () => {
          // Back up to 1 through the heal path, which wakes them.
          const level = Math.max(1, classLevelFor(sheet, "warlock") || sheet.level);
          const now = getSheetById(sheet.id) ?? sheet;
          const woke = patchSheet(sheet.id, { currentHp: 1, deathSaves: null, ...wake(now) });
          const tired = woke ? exhaustionPatch(woke, (woke.exhaustion ?? 0) + 1) : null;
          const rests = rollCard(campaign, turn, sheet.id, "custom", `${sheet.name}: Necrotic Husk recharge (long rests)`, "1d4", null).total;
          const after = getSheetById(sheet.id) ?? sheet;
          const marker = `${HUSK_RECOVERING} (${rests})`;
          patchSheet(sheet.id, {
            ...(tired ?? {}),
            conditions: [...after.conditions.filter((entry) => !isConditionNamed(entry, HUSK_RECOVERING)), marker],
          });
          publishSheet(campaign, sheet.id);
          const burst = huskBurst(campaign, input, level);
          return {
            applied: `${sheet.name} drops to 1 hit point instead of 0 and gains a level of exhaustion. Necrotic Husk returns after ${rests} long rest${rests === 1 ? "" : "s"}.`,
            ...burst,
          };
        },
      };
    case "sub_strength_before_death":
      return {
        apply: () => {
          const record = freshLastHit(campaign.id, sheet.id);
          const now = getSheetById(sheet.id) ?? sheet;
          const keepProne = Boolean(record && has(record.before.conditions, PRONE));
          const cleared = removeConditions(now.conditions, now.conditionMeta, keepProne ? [UNCONSCIOUS] : [UNCONSCIOUS, PRONE]);
          patchSheet(sheet.id, {
            conditions: [...cleared.conditions.filter((entry) => entry.toLowerCase() !== HOLDING_ON), HOLDING_ON],
            conditionMeta: { ...cleared.meta, [HOLDING_ON]: { untilTurnEndOf: sheet.id } },
          });
          publishSheet(campaign, sheet.id);
          const placed = extraTurnNow(campaign, sheet, "Strength before Death");
          return {
            applied: `${sheet.name} puts off falling unconscious and takes an extra turn now${placed ? "" : " (no fight is running, so there is no turn to give)"}. At 0 hit points during it, damage still causes death saving throw failures. When it ends they fall unconscious if still at 0 hit points.`,
          };
        },
      };
    default:
      return null;
  }
}

function wake(sheet: CharacterSheet) {
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, [UNCONSCIOUS]);
  return { conditions: cleared.conditions, conditionMeta: cleared.meta };
}

// Necrotic Husk's eruption: 2d10 + the warlock level necrotic damage to each
// creature of their choice within 30 feet, read as every living enemy there.
function huskBurst(campaign: Campaign, input: Input, level: number): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  const turn = getDmTurn(input.turnId);
  if (!encounter || !turn) {
    return { burst: `Each creature of the warlock's choice within 30 feet takes 2d10 + ${level} necrotic damage.` };
  }
  const caught = listEnemies(encounter.id).filter((enemy) => {
    if (enemy.status !== "alive") return false;
    const apart = tilesBetween(encounter.id, input.sheet.id, enemy.id);
    return apart === null || apart <= 6;
  });
  if (!caught.length) {
    return { burst: "No enemy is within 30 feet for the eruption to reach." };
  }
  const total = Math.max(0, rollCard(campaign, turn, input.sheet.id, "damage", `${input.sheet.name}: Necrotic Husk`, `2d10+${level}`, { kind: "sheet", id: input.sheet.id, name: input.sheet.name }).total);
  const lines = caught.map((enemy) => {
    const applied = applyEnemyDamage(campaign, turn, encounter, enemy, total, input.sheets, input.sheetsById, "necrotic", { magical: true });
    return `${enemy.displayName}: ${total} necrotic${(applied as { dead?: boolean }).dead ? ", and it falls" : ""}`;
  });
  publishEncounter(campaign.id);
  return { burst: lines };
}

// An extra turn taken at once (Strength before Death): a second entry for the
// character right after the combatant whose turn it is, which the pointer
// reaches next and which goes when the round ends, like Thief's Reflexes' own.
function extraTurnNow(campaign: Campaign, sheet: CharacterSheet, feature: string): boolean {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !encounter.orderReady) {
    return false;
  }
  const own = encounter.order.find((entry) => entry.kind === "pc" && entry.characterId === sheet.id);
  if (!own || own.kind !== "pc") {
    return false;
  }
  const current = encounter.order[encounter.turnIndex];
  const extra = { ...own, initiative: current?.initiative ?? own.initiative, reflex: true, extra: feature };
  encounter.order = [...encounter.order.slice(0, encounter.turnIndex + 1), extra, ...encounter.order.slice(encounter.turnIndex + 1)];
  saveEncounter(encounter);
  publishEncounter(campaign.id);
  return true;
}
