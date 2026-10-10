// What a character's save spell does besides its damage and its condition
// (SRD 5.1), for cast_at_enemy and aoe_damage alike:
//   - the save itself: Charm Person's target saves with advantage while the
//     party fights it, a plant saves against Blight at disadvantage, a
//     creature that needs no breath shrugs off Stinking Cloud;
//   - the damage: Blight's maximum on a plant, Harm's floor of 1 hit point;
//   - what a failed save leaves: Thunderwave's push, Harm's shrunken
//     maximum, Stinking Cloud's lost action, Divine Word's tiers;
//   - what the area does to anyone caught: Sleet Storm's concentration save;
//   - how long a condition lasts when the spell says so (Vicious Mockery to
//     the end of the target's next turn, Sunbeam to the caster's next turn),
//     a chosen word or form (Command, Eyebite), and the marks the engine
//     keeps for what comes at a turn's end (src/lib/dm/spell-turn-end.ts).
//
// Must not be imported by enemy-damage.ts or mutations.ts (it imports both
// through its callers' paths).

import type { Campaign } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, setEnemyConcentration, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { addConditionInstance, damageAdjust, resistsAllDamage, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { breakConcentration, clearSpellConditionsByName } from "@/lib/dm/concentration";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollCharacterSave, rollEnemySave } from "@/lib/dm/forced-save";
import { maximumOf } from "@/lib/dm/heal-spell";
import { pushTokenAway } from "@/lib/dm/map-tools";
import { spellConditionMeta, type SpellSource } from "@/lib/dm/spell-effects";
import { untilTurnEnd } from "@/lib/dm/turn-end";
import type { SpellCondition, SpellMech } from "@/lib/srd/spell-mech-types";
import type { SaveAbilityId } from "@/lib/srd/condition-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { sendHome } from "@/lib/dm/spell-planes";

const FEET_PER_TILE = 5;

const typeOf = (enemy: EncounterEnemy) => String(enemy.stats.type ?? "").toLowerCase();
const isType = (enemy: EncounterEnemy, types: string[] | undefined) =>
  Boolean(types?.length && types.some((type) => typeOf(enemy).includes(type)));

// ---- the save ----

// How the creature's save against the spell is rolled, beyond its own
// conditions and traits.
export function spellSaveOptions(mech: SpellMech | null, enemy: EncounterEnemy): { advantage?: boolean; disadvantage?: boolean } {
  const riders = mech?.riders;
  return {
    // Every creature a character's spell reaches through these tools is in
    // the fight the party is having with it.
    ...(riders?.advantageInFight ? { advantage: true } : {}),
    ...(isType(enemy, riders?.saveDisadvantageFor) ? { disadvantage: true } : {}),
  };
}

// Why the creature succeeds with no roll, or null (Stinking Cloud: poison
// cannot touch it).
export function spellAutoSave(mech: SpellMech | null, enemy: EncounterEnemy): string | null {
  if (!mech?.riders?.losesAction) {
    return null;
  }
  const immune = `${enemy.stats.immune ?? ""} ${enemy.stats.conditionImmune ?? ""}`.toLowerCase();
  return /poison/.test(immune) ? `${enemy.displayName} is immune to poison: the cloud cannot touch it.` : null;
}

// ---- the damage ----

// The dice's maximum for a creature the spell withers (Blight on a plant),
// or null.
export function maximizedDamage(mech: SpellMech | null, enemy: EncounterEnemy, expression: string): number | null {
  return isType(enemy, mech?.riders?.maxDamageFor) ? maximumOf(expression) : null;
}

// Harm: the damage after the creature's resistances, held so it cannot drop
// the creature below the floor. Null when the spell has no floor; the
// caller then lets applyEnemyDamage weigh the resistances itself.
export function flooredDamage(
  mech: SpellMech | null,
  enemy: EncounterEnemy,
  amount: number,
  type: string | undefined,
): number | null {
  const floor = mech?.riders?.hpFloor;
  if (!floor) {
    return null;
  }
  const adjusted = damageAdjust(amount, type, enemy.stats.resist, enemy.stats.immune, enemy.stats.vulnerable, {
    magical: true,
    resistAll: resistsAllDamage(enemy.conditions),
  }).amount;
  return Math.max(0, Math.min(adjusted, enemy.currentHp - floor));
}

// ---- the condition ----

// The chosen form of a condition, and what it lays with it: Command's word
// (Grovel: prone), Eyebite's form (Sickened: its own rules). The caller's
// word is kept only when the spell offers it.
export function chosenCondition(
  condition: SpellCondition,
  wanted: string | null,
): { name: string; extra: string[]; rules: Partial<SpellCondition> } {
  const word = (wanted ?? "").trim().toLowerCase();
  const choice = condition.choices?.[word];
  // A variant named whole ("cursed (wis)") or by what its parentheses hold
  // ("wis", "attacks").
  const variant =
    condition.variants?.find((entry) => entry === word || entry.endsWith(`(${word})`)) ?? condition.name;
  return {
    name: choice ? condition.name : variant,
    extra: choice ?? [],
    rules: condition.variantRules?.[variant] ?? {},
  };
}

// The meta one creature's condition is stored with: the spell's duration,
// or the turn it lasts to (Vicious Mockery: the end of the target's next
// turn; Sunbeam: the caster's next turn).
export function conditionMetaFor(
  condition: SpellCondition,
  rules: Partial<SpellCondition>,
  source: SpellSource,
  save: { ability: SaveAbilityId; dc: number },
  targetId: string,
): ConditionMeta {
  const merged = { ...condition, ...rules };
  const meta = spellConditionMeta(merged, source, save);
  // A turn bound replaces the count and the repeat save.
  const bound: ConditionMeta = { ...meta };
  delete bound.rounds;
  delete bound.saveEnds;
  if (merged.endsWith === "target turn end") {
    return untilTurnEnd(targetId, bound);
  }
  if (merged.endsWith === "caster turn start") {
    return { ...bound, untilTurnOf: source.casterId };
  }
  return meta;
}

// The mark a spell leaves for the end of the target's turn (Phantasmal
// Killer's dread, Flesh to Stone's count): a condition named for the spell,
// ended and read by src/lib/dm/spell-turn-end.ts.
export function turnEndMark(condition: SpellCondition | undefined, source: SpellSource, targetId: string): [string, ConditionMeta] | null {
  if (!condition?.turnEnd) {
    return null;
  }
  return [
    source.spell.toLowerCase(),
    untilTurnEnd(targetId, {
      spell: source.spell.slice(0, 80),
      source: source.casterId,
      ...(source.slotLevel ? { slotLevel: source.slotLevel } : {}),
    }),
  ];
}

// Lays conditions (each with its own meta) on a living enemy, leaving the
// ones it is immune to or already holds. Returns what landed.
export function layOnEnemy(enemyId: string, entries: Array<[string, ConditionMeta]>): string[] {
  const enemy = getEnemy(enemyId);
  if (!enemy || enemy.status !== "alive") {
    return [];
  }
  const immune = (enemy.stats.conditionImmune ?? "").toLowerCase();
  const landing = entries.filter(([name]) => !immune.includes(name));
  if (!landing.length) {
    return [];
  }
  // A condition the creature already holds from another source holds from
  // this one too, each with its own lifetime (condition-logic.ts).
  let conditions = enemy.conditions;
  let meta: ConditionMetaMap = { ...(enemy.conditionMeta as ConditionMetaMap) };
  for (const [name, entry] of landing) {
    const laid = addConditionInstance(conditions, meta, name, entry);
    conditions = laid.conditions;
    meta = laid.meta;
  }
  patchEnemyConditions(enemy.id, conditions, meta);
  return landing.map(([name]) => name);
}

// ---- after the save ----

export type SaveAftermath = {
  campaign: Campaign;
  turn: DmTurn;
  mech: SpellMech | null;
  spell: string;
  caster: CharacterSheet;
  enemy: EncounterEnemy;
  saved: boolean;
  // Damage the creature took from this casting, after its resistances.
  taken: number;
  dc: number;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
};

// What a failed save leaves beyond damage and the condition. Returns lines
// for the tool result.
export function afterEnemySave(input: SaveAftermath): string[] {
  const riders = input.mech?.riders;
  const lines: string[] = [];
  if (!riders || input.saved) {
    return lines;
  }
  const encounter = getActiveEncounter(input.campaign.id);
  const standing = getEnemy(input.enemy.id);
  if (!encounter || !standing || standing.status !== "alive") {
    return lines;
  }
  if (riders.pushFeet) {
    let moved = 0;
    for (let step = 0; step < Math.floor(riders.pushFeet / FEET_PER_TILE); step += 1) {
      const pushed = pushTokenAway(input.campaign, encounter.id, input.caster.id, standing.id);
      if (!pushed.moved) {
        break;
      }
      moved += FEET_PER_TILE;
    }
    if (moved) {
      lines.push(`${standing.displayName} is pushed ${moved} feet away from ${input.caster.name}.`);
    }
  }
  if (riders.shrinksMaxHp && input.taken > 0) {
    const max = Math.max(1, standing.maxHp - input.taken);
    getDatabase().prepare("UPDATE encounter_enemies SET max_hp = ? WHERE id = ?").run(max, standing.id);
    lines.push(`${standing.displayName}'s hit point maximum drops by ${input.taken} to ${max} for an hour.`);
  }
  if (riders.losesAction) {
    const source = { spell: input.spell, casterId: input.caster.id };
    if (layOnEnemy(standing.id, [["retching", untilTurnEnd(standing.id, { spell: source.spell, source: source.casterId })]]).length) {
      lines.push(`${standing.displayName} spends its action retching on its turn.`);
    }
  }
  // Divine Word sends an extraplanar creature home (spell-planes.ts).
  const home = riders.returnsHome && !riders.hpTiers?.some((tier) => tier.dies && standing.currentHp <= tier.atMost)
    ? sendHome(input.campaign, input.turn, standing, riders.returnsHome, input.spell, input.sheets, input.sheetsById)
    : null;
  if (home) {
    lines.push(home);
    publishEncounter(input.campaign.id);
    return lines;
  }
  if (riders.hpTiers) {
    const tier = [...riders.hpTiers].sort((a, b) => a.atMost - b.atMost).find((entry) => standing.currentHp <= entry.atMost);
    if (tier?.dies) {
      applyEnemyDamage(input.campaign, input.turn, encounter, standing, standing.currentHp, input.sheets, input.sheetsById, undefined, { death: true });
      lines.push(`${standing.displayName} has ${standing.currentHp} hit points or fewer and is slain by ${input.spell}.`);
    } else if (tier) {
      const meta: ConditionMeta = { spell: input.spell, source: input.caster.id, ...(tier.rounds ? { rounds: tier.rounds } : {}) };
      const landed = layOnEnemy(standing.id, tier.conditions.map((name) => [name, meta]));
      if (landed.length) {
        lines.push(`${standing.displayName} is ${landed.join(", ")}.`);
      }
    }
  }
  if (lines.length) {
    publishEncounter(input.campaign.id);
  }
  return lines;
}

// Sleet Storm: a concentrating creature caught saves against the caster's
// DC or loses its concentration, whatever became of its other save.
export function concentrationShaken(
  campaign: Campaign,
  turn: DmTurn,
  mech: SpellMech | null,
  dc: number,
  caught: { enemies: EncounterEnemy[]; characters: CharacterSheet[] },
): string[] {
  const ability = mech?.riders?.concentrationSave;
  if (!ability) {
    return [];
  }
  const lines: string[] = [];
  for (const stale of caught.enemies) {
    const enemy = getEnemy(stale.id);
    if (!enemy?.concentration || enemy.status !== "alive") {
      continue;
    }
    const save = rollEnemySave(campaign.id, enemy, ability, dc, { magical: true, record: { turn, detail: `${enemy.displayName}: ${ability.toUpperCase()} save to keep concentrating` } });
    if (!save.success) {
      const spell = enemy.concentration;
      setEnemyConcentration(enemy.id, null);
      clearSpellConditionsByName(campaign, spell, undefined, enemy.id);
      lines.push(`${enemy.displayName} loses its concentration on ${spell}.`);
    }
  }
  for (const stale of caught.characters) {
    const sheet = getSheetById(stale.id);
    if (!sheet?.concentratingOn) {
      continue;
    }
    const save = rollCharacterSave(campaign, turn, sheet, ability, dc, `${sheet.name}: ${ability.toUpperCase()} save to keep concentrating`);
    if (!save.success) {
      const spell = breakConcentration(campaign, turn.id, sheet.id, "the storm broke it");
      if (spell) {
        lines.push(`${sheet.name} loses concentration on ${spell}.`);
      }
    }
  }
  return lines;
}

// Heat Metal: the holder saves or drops what it holds; one that keeps it,
// or wears it, has disadvantage on attacks and checks until the caster's
// next turn. `worn` is the caller's word that the object cannot be dropped.
export function heatMetalGrip(
  campaign: Campaign,
  turn: DmTurn,
  mech: SpellMech | null,
  enemy: EncounterEnemy,
  source: SpellSource,
  dc: number,
  worn: boolean,
): string | null {
  const ability = mech?.riders?.gripSave;
  const standing = getEnemy(enemy.id);
  if (!ability || !standing || standing.status !== "alive") {
    return null;
  }
  const save = rollEnemySave(campaign.id, standing, ability, dc, { magical: true, record: { turn, detail: `${standing.displayName}: ${ability.toUpperCase()} save against ${source.spell}` } });
  if (!worn && !save.success) {
    return `${standing.displayName} drops the searing object (${ability.toUpperCase()} save failed).`;
  }
  layOnEnemy(standing.id, [["searing metal", { spell: source.spell, source: source.casterId, untilTurnOf: source.casterId }]]);
  publishEncounter(campaign.id);
  return `${standing.displayName} keeps hold of the searing metal: disadvantage on attack rolls and ability checks until ${source.spell}'s caster's next turn.`;
}

// The conditions one creature of an area spell gets on a failed save, each
// with its own meta (a duration to the end of its own turn, the spell's mark
// for what comes at its turn's end). Returns what landed.
export function layAreaConditions(
  plan: { spell: string; caster: { id: string }; slotLevel: number | null; mech: SpellMech | null; conditions: string[] },
  enemyId: string,
  save: { ability: SaveAbilityId; dc: number },
): string[] {
  const condition = plan.mech?.condition;
  if (!condition || !plan.conditions.length) {
    return [];
  }
  const source = { spell: plan.spell, casterId: plan.caster.id, slotLevel: plan.slotLevel };
  const meta = conditionMetaFor(condition, {}, source, save, enemyId);
  const mark = turnEndMark(condition, source, enemyId);
  const entries: Array<[string, ConditionMeta]> = plan.conditions.map((name) => [name, meta]);
  return layOnEnemy(enemyId, mark ? [...entries, mark] : entries).filter((name) => name !== mark?.[0]);
}
