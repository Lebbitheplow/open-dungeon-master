// What a spell on either side of an enemy's swing does to it (SRD 5.1),
// called from the enemy attack (src/lib/dm/enemy-attack.ts):
//   - a one-shot rider on the attacker is spent by the roll it rode
//     (Vicious Mockery's disadvantage on "the next attack roll");
//   - Ray of Enfeeblement halves the damage of the attacker's Strength
//     weapon attacks;
//   - Fire Shield answers a melee hit from within 5 feet with 2d8 of the
//     shield's element, and Holy Aura answers a fiend's or an undead's with
//     a Constitution save against blindness.
// Ray of Enfeeblement's hit is laid by the spell attack's riders
// (src/lib/dm/spell-attack-riders.ts) through layEnfeeblement.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { spellSaveDcFor } from "@/lib/srd";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { conditionRollRiders, type ConditionRollRiders } from "@/lib/srd/condition-effects";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";

// The riders of the attacker's next swing, with what this one spent taken
// off the creature (the spent condition leaves its row).
export function spendEnemyRiders(enemy: EncounterEnemy, riders: ConditionRollRiders): ConditionRollRiders {
  if (!riders.spent.length) {
    return riders;
  }
  const live = getEnemy(enemy.id) ?? enemy;
  const cleared = removeConditions(live.conditions, live.conditionMeta, riders.spent);
  patchEnemyConditions(live.id, cleared.conditions, cleared.meta);
  return conditionRollRiders(cleared.conditions, "attack");
}

// Ray of Enfeeblement's hit: enfeebled, a Constitution save at the end of
// each of the creature's turns against the caster's DC ending it, and the
// spell's concentration holding it (the meta records the spell and caster).
export function layEnfeeblement(
  campaign: Campaign,
  rule: { condition: string; ability: "con" },
  enemyId: string,
  casterId: string,
): string | null {
  const enemy = getEnemy(enemyId);
  const caster = getSheetById(casterId);
  if (!enemy || enemy.status !== "alive" || !caster) {
    return null;
  }
  const dc = spellSaveDcFor(caster, "Ray of Enfeeblement") ?? 13;
  const meta: ConditionMetaMap = {
    ...(enemy.conditionMeta as ConditionMetaMap),
    [rule.condition]: { spell: "Ray of Enfeeblement", source: casterId, saveEnds: { ability: rule.ability, dc } },
  };
  const conditions = enemy.conditions.includes(rule.condition) ? enemy.conditions : [...enemy.conditions, rule.condition];
  patchEnemyConditions(enemy.id, conditions, meta);
  publishEncounter(campaign.id);
  return `${enemy.displayName} is enfeebled: its Strength weapon attacks deal half damage until it makes a ${rule.ability.toUpperCase()} save (DC ${dc}) at the end of one of its turns.`;
}

// Whether a creature's weapon attack uses Strength: a melee weapon attack
// whose attacker is no nimbler than strong (a block with no scores counts
// as Strength).
function usesStrength(enemy: EncounterEnemy, attack: EnemyAttack, ranged: boolean): boolean {
  if (ranged || attack.spellAttack) {
    return false;
  }
  const str = enemy.stats.abilities?.str;
  const dex = enemy.stats.abilities?.dex;
  return str === undefined || dex === undefined || str >= dex;
}

// The damage an enfeebled creature's blow deals.
export function enfeebledBlow(enemy: EncounterEnemy, attack: EnemyAttack, ranged: boolean, amount: number): number {
  return enemy.conditions.includes("enfeebled") && usesStrength(enemy, attack, ranged) ? Math.floor(amount / 2) : amount;
}

// Fire Shield and Holy Aura answering a melee hit on the character. Returns
// the line for the swing, or null.
export function spellRetort(
  campaign: Campaign,
  turn: DmTurn,
  attacker: EncounterEnemy,
  targetId: string,
  melee: boolean,
  withinFive: boolean,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): string | null {
  const target = getSheetById(targetId);
  const encounter = getActiveEncounter(campaign.id);
  if (!target || !encounter || !melee) {
    return null;
  }
  const lines: string[] = [];
  const shield = target.conditions.find((entry) => entry.toLowerCase().startsWith("fire shield"));
  if (shield && withinFive) {
    // The warm shield resists cold and burns; the chill shield resists fire
    // and freezes.
    const type = /\(fire\)/i.test(shield) ? "cold" : "fire";
    const live = getEnemy(attacker.id);
    if (live?.status === "alive") {
      // The shield's bearer deals it.
      const rolled = rollCard(campaign, turn, target.id, "damage", rollAgainst("Fire Shield", live.displayName), "2d8", sheetAttacker(target)).total;
      const applied = applyEnemyDamage(campaign, turn, encounter, live, rolled, sheets, sheetsById, type, { magical: true });
      lines.push(`${target.name}'s Fire Shield sears ${live.displayName} for ${applied.damageApplied ?? rolled} ${type} damage.`);
    }
  }
  const aura = target.conditions.find((entry) => entry.toLowerCase() === "holy aura");
  if (aura && /fiend|undead/i.test(attacker.stats.type ?? "")) {
    const live = getEnemy(attacker.id);
    const casterId = (target.conditionMeta as ConditionMetaMap)[aura]?.source ?? target.id;
    const caster = getSheetById(casterId) ?? target;
    const dc = spellSaveDcFor(caster, "Holy Aura") ?? 13;
    if (live?.status === "alive") {
      const save = rollEnemySave(campaign.id, live, "con", dc, {
        magical: true,
        resist: true,
        record: { turn, detail: `${live.displayName}: CON save against Holy Aura` },
      });
      if (!save.success && !live.conditions.includes("blinded")) {
        const meta: ConditionMetaMap = { ...(live.conditionMeta as ConditionMetaMap), blinded: { spell: "Holy Aura", source: caster.id } };
        patchEnemyConditions(live.id, [...live.conditions, "blinded"], meta);
        publishEncounter(campaign.id);
        lines.push(`Holy Aura flares: ${live.displayName} is blinded until the spell ends.`);
      }
    }
  }
  return lines.length ? lines.join(" ") : null;
}

// ---- Bestow Curse ----

// Whether the creature attacks under Bestow Curse's attack curse laid by
// this character: disadvantage against them, and only them.
export function cursedAgainst(enemy: EncounterEnemy, targetId: string): boolean {
  const meta = enemy.conditionMeta as ConditionMetaMap;
  return enemy.conditions.includes("cursed (attacks)") && meta["cursed (attacks)"]?.source === targetId;
}

// The necrotic curse's die on a hit by the one who laid it, or null.
export function curseRider(enemy: EncounterEnemy, attackerId: string): { dice: string; type: string } | null {
  const meta = enemy.conditionMeta as ConditionMetaMap;
  return enemy.conditions.includes("cursed (necrotic)") && meta["cursed (necrotic)"]?.source === attackerId
    ? { dice: "1d8", type: "necrotic" }
    : null;
}

// The same die when the curser's spell harms the creature (cast_at_enemy,
// aoe_damage). Returns the line for the result, or null.
export function curseBurn(
  campaign: Campaign,
  turn: DmTurn,
  enemyId: string,
  casterId: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): string | null {
  const encounter = getActiveEncounter(campaign.id);
  const enemy = getEnemy(enemyId);
  const rider = enemy && enemy.status === "alive" ? curseRider(enemy, casterId) : null;
  if (!encounter || !enemy || !rider) {
    return null;
  }
  const caster = getSheetById(casterId);
  const rolled = rollCard(campaign, turn, caster?.id ?? null, "damage", rollAgainst("Bestow Curse", enemy.displayName), rider.dice, caster ? sheetAttacker(caster) : null).total;
  applyEnemyDamage(campaign, turn, encounter, enemy, rolled, sheets, sheetsById, rider.type, { magical: true });
  return `Bestow Curse: ${rolled} necrotic more to ${enemy.displayName}.`;
}
