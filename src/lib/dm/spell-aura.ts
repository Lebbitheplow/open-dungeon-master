// What a running spell does at the start of a creature's turn (SRD 5.1):
//
//   Spirit Guardians: an enemy that starts its turn within 15 feet of the
//     caster makes a Wisdom save or takes 3d8 radiant (+1d8 a slot level
//     above 3rd), half on a success. Read off the battle map; with no map
//     there is no distance to hold it to, and the table narrates.
//   Phantasmal Killer: the frightened target saves at the start of each of
//     its turns or takes 4d10 psychic; a success ends the spell for it.
//   Heroism: the target gains temporary hit points equal to the caster's
//     spellcasting modifier at the start of each of its turns.
//   Black Tentacles: a creature it holds takes 3d6 at the start of its turn.
//   Confusion: the confused creature rolls a d10 for what it does.
//   Regenerate: the target regains 1 hit point.
// What comes at the END of the target's turn is src/lib/dm/spell-turn-end.ts.
//
// Called from condition-tick.ts startTurnConditions with the combatants
// whose turns are starting. The damage lands straight on the enemy row (this
// clock path must not import enemy-damage.ts, which imports it): the
// resistances, a concentration save, death and the token all follow here.

import { sheetSpellAuthors } from "@/lib/dm/spell-authors";
import { dmRoll, rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, listEnemies, patchEnemyConditions, patchEnemyHp, setEnemyConcentration, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { restoreOwnForm } from "@/lib/db/enemy-form";
import { getBattleMapForEncounter, removeTokenByRef } from "@/lib/db/battle-maps";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived, spellSaveDcFor } from "@/lib/srd";
import { spellMechanicsFor } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { addDice } from "@/lib/srd/spell-scaling";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { rollCharacterSave, rollEnemySave } from "@/lib/dm/forced-save";
import { damageAdjust, instancesOf, removeConditionInstances, resistsAllDamage, withTempHpClaim, type ConditionMetaMap, type SaveAbilityId } from "@/lib/dm/condition-logic";
import { createDmTurn, saveDmTurn } from "@/lib/db/dm-turns";
import type { RollAttacker } from "@/lib/db/rolls";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { healDeathHook } from "@/lib/dm/death";
import { regainBlockedBy } from "@/lib/dm/vitals-logic";
import { clearSpellConditionsByName } from "@/lib/dm/concentration";
import { spellEffectsOnEnemyDamage } from "@/lib/dm/spell-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { rollAgainst } from "@/lib/roll-labels";
import { textKey } from "@/lib/language/text-logic";

const FEET_PER_TILE = 5;

// Damage from a running spell landing on an enemy: its resistances, the
// hit points, a concentration save, and death. Returns the line for the table.
export function hurtEnemy(campaign: Campaign, encounter: Encounter, enemy: EncounterEnemy, amount: number, type: string, why: string): string {
  const adjusted = damageAdjust(amount, type, enemy.stats.resist, enemy.stats.immune, enemy.stats.vulnerable, {
    magical: true,
    resistAll: resistsAllDamage(enemy.conditions),
  });
  if (adjusted.amount <= 0) {
    return `${enemy.displayName} takes no damage from ${why}.`;
  }
  // A Polymorph's beast dropped to 0 reverts, the excess carrying over to
  // the creature's own hit points (enemy-damage.ts does the same).
  const own = enemy.stats.polymorphedFrom;
  if (own && adjusted.amount >= enemy.currentHp) {
    restoreOwnForm(enemy.id, own);
    const reverted = getEnemy(enemy.id);
    const excess = adjusted.amount - enemy.currentHp;
    const line = `${enemy.displayName}'s ${own.form} form drops to 0 hit points from ${why} and its own form returns.`;
    return reverted && excess > 0 ? `${line} ${hurtEnemy(campaign, encounter, reverted, excess, "", why)}` : line;
  }
  const hp = Math.max(0, enemy.currentHp - adjusted.amount);
  patchEnemyHp(enemy.id, hp, hp <= 0 ? "dead" : "alive");
  if (enemy.concentration) {
    const dc = Math.max(10, Math.floor(adjusted.amount / 2));
    // The same save the damage path rolls (enemy-damage.ts): its conditions
    // count, and the DM sees the roll.
    const kept = hp > 0 && rollEnemySave(campaign.id, enemy, "con", dc, { record: { detail: `${enemy.displayName}: concentration on ${enemy.concentration} (CON save)` } }).success;
    if (!kept) {
      setEnemyConcentration(enemy.id, null);
      clearSpellConditionsByName(campaign, enemy.concentration, undefined, enemy.id);
    }
  }
  if (hp <= 0) {
    const map = getBattleMapForEncounter(encounter.id);
    if (map) {
      removeTokenByRef(map.id, enemy.id);
    }
    return `${enemy.displayName} takes ${adjusted.amount}${type ? ` ${type}` : ""} damage from ${why} and falls.`;
  }
  spellEffectsOnEnemyDamage(enemy.id);
  return `${enemy.displayName} takes ${adjusted.amount}${type ? ` ${type}` : ""} damage from ${why}.`;
}

// Spirit Guardians and its kind, around every caster holding one.
function auraHits(campaign: Campaign, encounter: Encounter, enemy: EncounterEnemy, lines: string[]) {
  for (const stale of listSheets(campaign.id)) {
    const caster = getSheetById(stale.id) ?? stale;
    if (caster.currentHp <= 0 || caster.deathSaves?.dead) {
      continue;
    }
    const meta = caster.conditionMeta as ConditionMetaMap;
    for (const condition of caster.conditions) {
      const spell = meta[condition]?.spell ?? (condition.toLowerCase() === "spirit guardians" ? "Spirit Guardians" : null);
      const aura = spell ? spellMechanicsFor({ spell, userIds: sheetSpellAuthors(caster) }) : null;
      if (!aura?.mech.aura) {
        continue;
      }
      const ring = aura.mech.aura;
      const apart = tilesBetween(encounter.id, caster.id, enemy.id);
      if (apart === null || apart > Math.floor(ring.radiusFeet / FEET_PER_TILE)) {
        continue;
      }
      const live = getEnemy(enemy.id);
      if (!live || live.status !== "alive") {
        return;
      }
      const dc = spellSaveDcFor(caster, aura.name) ?? 13;
      const slot = meta[condition]?.slotLevel ?? ring.baseLevel;
      const dice = ring.perSlotLevel ? addDice(ring.dice, ring.perSlotLevel, Math.max(0, slot - ring.baseLevel)) : ring.dice;
      const save = rollEnemySave(campaign.id, live, ring.save, dc, {
        magical: true,
        record: { detail: `${live.displayName}: ${ring.save.toUpperCase()} save against ${aura.name}` },
      });
      // Each creature's damage is its own roll, and its own card.
      const rolled = rollCard(campaign, null, caster.id, "damage", rollAgainst(aura.name, live.displayName), dice, sheetAttacker(caster)).total;
      const amount = save.success ? (ring.halfOnSave ? Math.floor(rolled / 2) : 0) : rolled;
      lines.push(
        `${live.displayName} starts its turn in ${caster.name}'s ${aura.name}: ${ring.save.toUpperCase()} save ${save.success ? "made" : "failed"} (DC ${dc}).`,
      );
      if (amount > 0) {
        lines.push(hurtEnemy(campaign, encounter, live, amount, ring.type, aura.name));
      }
    }
  }
}

// The spells holding a creature that hurt it as its turn starts (Black
// Tentacles' crushing grip): each casting once, read from every instance of
// every condition (condition-logic.ts), cast by a character or a creature.
type TurnStartHold = {
  tag: string;
  spell: string;
  save: SaveAbilityId | undefined;
  noSave: boolean;
  dice: string;
  type: string;
  dc: number;
  attacker: RollAttacker;
  casterSheetId: string | null;
};

function turnStartHolds(campaign: Campaign, conditions: string[], meta: ConditionMetaMap): TurnStartHold[] {
  const holds: TurnStartHold[] = [];
  const seen = new Set<string>();
  for (const condition of conditions) {
    for (const entry of instancesOf(meta[condition])) {
      if (!entry.spell || !entry.source) {
        continue;
      }
      const tag = `${textKey(entry.spell)}|${entry.source}`;
      if (seen.has(tag)) {
        continue;
      }
      seen.add(tag);
      const resolved = spellMechanicsFor({ spell: entry.spell, userIds: spellAuthorsFor(campaign) });
      const hurt = resolved?.mech.condition?.turnStart;
      const casterSheet = getSheetById(entry.source);
      const casterEnemy = casterSheet ? null : getEnemy(entry.source);
      if (!resolved || !hurt || (!casterSheet && !casterEnemy) || (!hurt.noSave && !resolved.mech.save)) {
        continue;
      }
      const slot = entry.slotLevel ?? hurt.baseLevel;
      holds.push({
        tag,
        spell: resolved.name,
        save: resolved.mech.save,
        noSave: Boolean(hurt.noSave),
        dice: hurt.perSlotLevel ? addDice(hurt.dice, hurt.perSlotLevel, Math.max(0, slot - hurt.baseLevel)) : hurt.dice,
        type: hurt.type,
        dc: casterSheet ? (spellSaveDcFor(casterSheet, resolved.name) ?? 13) : (casterEnemy?.stats.spellcasting?.dc ?? 13),
        attacker: casterSheet ? sheetAttacker(casterSheet) : { kind: "enemy", id: casterEnemy!.id, name: casterEnemy!.displayName },
        casterSheetId: casterSheet?.id ?? null,
      });
    }
  }
  return holds;
}

// The conditions one casting holds on a creature, taken off (a save ended it).
function withoutHold(conditions: string[], meta: ConditionMetaMap, tag: string) {
  let next = { conditions, meta };
  for (const name of conditions) {
    const result = removeConditionInstances(next.conditions, next.meta, name, (entry) => Boolean(entry.spell) && `${textKey(entry.spell ?? "")}|${entry.source ?? ""}` === tag);
    next = { conditions: result.conditions, meta: result.meta };
  }
  return next;
}

// Phantasmal Killer and its kind: damage at the start of the target's turn
// unless it saves, a save ending the spell for it. Black Tentacles crushes
// what it holds, no save to escape the damage.
function turnStartDamage(campaign: Campaign, encounter: Encounter, enemy: EncounterEnemy, lines: string[]) {
  for (const hold of turnStartHolds(campaign, enemy.conditions, enemy.conditionMeta as ConditionMetaMap)) {
    const live = getEnemy(enemy.id);
    if (!live || live.status !== "alive") {
      return;
    }
    if (!hold.noSave && hold.save) {
      const save = rollEnemySave(campaign.id, live, hold.save, hold.dc, {
        magical: true,
        record: { detail: `${live.displayName}: ${hold.save.toUpperCase()} save against ${hold.spell}` },
      });
      if (save.success) {
        const cleared = withoutHold(live.conditions, live.conditionMeta as ConditionMetaMap, hold.tag);
        patchEnemyConditions(live.id, cleared.conditions, cleared.meta);
        lines.push(`${live.displayName} masters its terror: ${hold.spell} ends for it (${hold.save.toUpperCase()} save vs DC ${hold.dc}).`);
        continue;
      }
    }
    lines.push(hurtEnemy(campaign, encounter, live, rollCard(campaign, null, hold.casterSheetId, "damage", rollAgainst(hold.spell, live.displayName), hold.dice, hold.attacker).total, hold.type, hold.spell));
  }
}

// The same at the start of a character's turn, whoever cast it: a monster's
// Black Tentacles crushes the character it holds as it crushes a monster.
function characterTurnStartDamage(campaign: Campaign, sheet: CharacterSheet, lines: string[]) {
  const holds = turnStartHolds(campaign, sheet.conditions, sheet.conditionMeta as ConditionMetaMap);
  if (!holds.length) {
    return;
  }
  const turn = createDmTurn(campaign.id, [], "human_dm");
  try {
    for (const hold of holds) {
      const live = getSheetById(sheet.id);
      if (!live || live.deathSaves?.dead) {
        return;
      }
      if (!hold.noSave && hold.save) {
        const save = rollCharacterSave(campaign, turn, live, hold.save, hold.dc, `${hold.save.toUpperCase()} save against ${hold.spell}`, { magical: true });
        if (save.success) {
          const cleared = withoutHold(live.conditions, live.conditionMeta as ConditionMetaMap, hold.tag);
          const updated = patchSheet(live.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
          if (updated) {
            publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
          }
          lines.push(`${live.name} breaks ${hold.spell}'s hold (${hold.save.toUpperCase()} save vs DC ${hold.dc}).`);
          continue;
        }
      }
      const amount = rollCard(campaign, turn, live.id, "damage", rollAgainst(hold.spell, live.name), hold.dice, hold.attacker).total;
      applyPcDamage(campaign, turn.id, live, { amount, type: hold.type, magical: true, spell: true, reason: hold.spell });
      lines.push(`${live.name} takes ${amount} ${hold.type} damage from ${hold.spell}.`);
    }
  } finally {
    turn.status = "done";
    saveDmTurn(turn);
  }
}

// Heroism: the caster's spellcasting modifier in temporary hit points, which
// do not stack; the higher value stands.
function heroism(campaign: Campaign, sheet: CharacterSheet) {
  const meta = sheet.conditionMeta as ConditionMetaMap;
  let best = 0;
  let owner: { name: string; spell: string; source: string } | null = null;
  for (const condition of sheet.conditions) {
    const entry = meta[condition];
    const resolved = entry?.spell ? spellMechanicsFor({ spell: entry.spell, userIds: spellAuthorsFor(campaign) }) : null;
    if (!resolved?.mech.buff?.tempHpEachTurn || !entry?.source || !entry.spell) {
      continue;
    }
    const caster = getSheetById(entry.source);
    const ability = caster?.spellcasting?.ability;
    const each = caster && ability ? computeSheetDerived(caster).abilityMods[ability] : 0;
    if (each > best) {
      best = each;
      owner = { name: condition, spell: entry.spell, source: entry.source };
    }
  }
  if (best > sheet.tempHp && owner) {
    patchSheet(sheet.id, { tempHp: best });
    // Heroism's pool goes when Heroism does (SRD 5.1; sheets.ts).
    const granted = getSheetById(sheet.id);
    const updated = granted
      ? patchSheet(sheet.id, { conditionMeta: withTempHpClaim(granted.conditionMeta as ConditionMetaMap, owner.name, owner, best) })
      : null;
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
}

// Confusion: at the start of its turn the creature rolls a d10. 1: it moves
// at random and takes no action; 2 to 6: it neither moves nor acts; 7 or 8:
// it spends its action attacking a creature in reach at random; 9 or 10: it
// acts as it chooses. What it may not do is laid down until its turn ends.
function confusionRoll(enemy: EncounterEnemy, lines: string[]) {
  const meta = enemy.conditionMeta as ConditionMetaMap;
  const entry = meta.confused;
  if (!enemy.conditions.includes("confused") || !entry) {
    return;
  }
  // The creature's own roll: the DM sees the die, the table what it does.
  const roll = dmRoll(enemy.campaignId, null, "custom", `${enemy.displayName}: Confusion`, "1d10").total;
  const lost = roll === 1 ? "wandering" : roll <= 6 ? "halted" : null;
  if (lost && !enemy.conditions.includes(lost)) {
    // Until the end of this turn (src/lib/dm/turn-end.ts reads the mark).
    const next: ConditionMetaMap = { ...meta, [lost]: { spell: entry.spell, source: entry.source, untilTurnEndOf: enemy.id } };
    patchEnemyConditions(enemy.id, [...enemy.conditions, lost], next);
  }
  lines.push(
    `${enemy.displayName} is confused and rolls ${roll} on the d10: ${
      roll === 1
        ? "it moves in a random direction and takes no action"
        : roll <= 6
          ? "it does not move and takes no action"
          : roll <= 8
            ? "it uses its action to attack a random creature in reach, or does nothing if none is"
            : "it acts as it chooses"
    }.`,
  );
}

// Bestow Curse's will curse: a WIS save against the caster's DC at the start
// of each of its turns; on a failure it wastes its action until the turn ends.
function curseOfWill(campaign: Campaign, enemy: EncounterEnemy, lines: string[]) {
  const meta = enemy.conditionMeta as ConditionMetaMap;
  const entry = meta["cursed (will)"];
  const caster = entry?.source ? getSheetById(entry.source) : null;
  if (!enemy.conditions.includes("cursed (will)") || !caster) {
    return;
  }
  const dc = spellSaveDcFor(caster, "Bestow Curse") ?? 13;
  const save = rollEnemySave(campaign.id, enemy, "wis", dc, { magical: true, record: { detail: `${enemy.displayName}: WIS save against Bestow Curse` } });
  if (save.success || enemy.conditions.includes("dazed")) {
    return;
  }
  patchEnemyConditions(enemy.id, [...enemy.conditions, "dazed"], {
    ...meta,
    dazed: { spell: entry?.spell ?? "Bestow Curse", source: caster.id, untilTurnEndOf: enemy.id },
  });
  lines.push(`${enemy.displayName} fails its WIS save against Bestow Curse and wastes its action.`);
}

// Regenerate: 1 hit point at the start of each of the target's turns while
// the spell lasts, and only while they are up (a dying creature is healed by
// the heal tool, which also wakes it).
// Regenerate's hit point at the start of each of the target's turns: a
// creature at 0 still living gets it, and with it is no longer dying (the
// heal tool's settlement, death.ts healDeathHook); the dead and a creature
// that cannot regain hit points get nothing.
function regenerate(campaign: Campaign, sheet: CharacterSheet) {
  const entry = (sheet.conditionMeta as ConditionMetaMap).regenerating;
  if (!sheet.conditions.includes("regenerating") || !entry?.spell || sheet.deathSaves?.dead || regainBlockedBy(sheet)) {
    return;
  }
  const each = spellMechanicsFor({ spell: entry.spell, userIds: spellAuthorsFor(campaign) })?.mech.regainEachTurn ?? 0;
  const currentHp = Math.min(effectiveMaxHp(sheet), Math.max(0, sheet.currentHp) + each);
  if (currentHp > sheet.currentHp) {
    const updated = patchSheet(sheet.id, { currentHp });
    healDeathHook(campaign, null, sheet);
    const now = getSheetById(sheet.id) ?? updated;
    if (now) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: now });
    }
  }
}

export function spellTurnStart(campaign: Campaign, encounter: Encounter, combatantIds: string[]): string[] {
  const lines: string[] = [];
  const enemies = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  for (const id of combatantIds) {
    const enemy = enemies.get(id);
    if (enemy) {
      if (enemy.status !== "alive") {
        continue;
      }
      auraHits(campaign, encounter, enemy, lines);
      const live = getEnemy(enemy.id);
      if (live?.status === "alive") {
        turnStartDamage(campaign, encounter, live, lines);
      }
      const after = getEnemy(enemy.id);
      if (after?.status === "alive") {
        confusionRoll(after, lines);
      }
      const cursed = getEnemy(enemy.id);
      if (cursed?.status === "alive") {
        curseOfWill(campaign, cursed, lines);
      }
      continue;
    }
    const sheet = getSheetById(id);
    if (sheet && !sheet.deathSaves?.dead) {
      heroism(campaign, sheet);
      characterTurnStartDamage(campaign, getSheetById(id) ?? sheet, lines);
      regenerate(campaign, getSheetById(id) ?? sheet);
    }
  }
  return lines;
}
