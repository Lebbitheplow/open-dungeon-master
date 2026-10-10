// The moments of a fight the authored subclass features act on
// (src/lib/srd/authored-effects.ts), for the combat engines to call:
//
//   an enemy's attack on a character (authoredIncomingAttack): Among the
//     Dead's disadvantage, Fungal Body's no critical, the marks of Ancestral
//     Protectors, Unwavering Mark and the thunder gauntlets (the marked
//     creature attacks anyone else at disadvantage), Totemic Attunement's
//     bear; and after it lands (authoredAfterHit), Raging Storm's desert
//     and Emissary of Redemption's damage back;
//   a character's attack (authoredAttackSituation): Assassinate, Avenging
//     Angel, Versatile Trickster, Mortal Bulwark, the wolf totem; and its hit
//     (authoredOnHit): the marks, Order's Wrath's curse, Emissary of
//     Redemption set aside, Touch of Death and Keeper of Souls on a kill;
//   a turn's start and end (authoredTurnStart, authoredTurnEnd): Elder
//     Champion, Aura of Conquest, Dread Lord, Protective Spirit;
//   a rest (authoredRestTempHp): Celestial Resilience;
//   damage landing on a character (authoredAuraResistances): Aura of
//     Warding, Shielding Storm.
//
// Damage to a creature lands through spell-aura.ts hurtEnemy (resistance,
// hit points, concentration, death, the token), so this module never imports
// enemy-damage.ts, which reaches it.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, listTokens } from "@/lib/db/battle-maps";
import { tilesApart } from "@/lib/dm/board-reach";

import {
  getActiveEncounter,
  getEnemy,
  listEnemies,
  patchEnemyConditions,
  turnKey,
  type Encounter,
  type EncounterEnemy,
} from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import type { Advantage } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { activeAuthored, resolveFormula } from "@/lib/srd/authored-effects";
import { effectiveMaxHp, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { withinFeet } from "@/lib/dm/authored-saves";
import { naturalWeaponOnHit } from "@/lib/dm/authored-attacks";
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

function metaOf(enemy: EncounterEnemy, condition: string) {
  return (enemy.conditionMeta as ConditionMetaMap)[condition];
}

function publishSheet(campaign: Campaign, sheetId: string) {
  const updated = patchSheet(sheetId, {});
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

function setTempHp(campaign: Campaign, sheet: CharacterSheet, amount: number): boolean {
  if (amount <= sheet.tempHp) {
    return false;
  }
  patchSheet(sheet.id, { tempHp: amount });
  publishSheet(campaign, sheet.id);
  return true;
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

// ---- an enemy attacks a character ----

// The marks a character's hit leaves on a creature, which make it attack
// anyone but the marker at disadvantage.
const GUARD_MARKS = ["ancestral protectors", "unwavering mark", "thunder gauntlets"];

export function authoredIncomingAttack(input: {
  campaignId: string;
  encounterId: string;
  attacker: EncounterEnemy;
  target: CharacterSheet;
}): { sources: Advantage[]; notes: string[]; noCrit: string | null; halve: string | null } {
  const { attacker, target } = input;
  const sources: Advantage[] = [];
  const notes: string[] = [];
  let halve: string | null = null;
  const type = lower(attacker.stats.type);
  for (const { effect, held } of activeAuthored(target, "attacked_disadv")) {
    if (effect.from.some((kind) => type.includes(kind))) {
      sources.push("disadvantage");
      notes.push(`${held.feature}: a ${type} attacks ${target.name} at disadvantage`);
    }
  }
  for (const name of GUARD_MARKS) {
    const condition = attacker.conditions.find((entry) => lower(entry) === name);
    const meta = condition ? metaOf(attacker, condition) : undefined;
    if (condition && meta?.source && meta.source !== target.id) {
      sources.push("disadvantage");
      notes.push(`${condition}: it attacks anyone but its marker at disadvantage`);
      if ((meta as { halve?: boolean }).halve) {
        halve = condition;
      }
    }
  }
  // Totemic Attunement (Bear): a creature within 5 feet of the raging
  // barbarian attacks anyone else at disadvantage.
  for (const guardian of fielded(input.campaignId)) {
    if (guardian.id === target.id) {
      continue;
    }
    for (const { effect, held } of activeAuthored(guardian, "guard_aura")) {
      if (withinFeet(input.encounterId, guardian.id, attacker.id, effect.rangeFt)) {
        sources.push("disadvantage");
        notes.push(`${held.feature}: within ${effect.rangeFt} feet of ${guardian.name}, it attacks anyone else at disadvantage`);
      }
    }
  }
  const crit = activeAuthored(target, "crit_immune")[0];
  return { sources, notes, noCrit: crit ? crit.held.feature : null, halve };
}

// After an enemy's attack has dealt `dealt` to the character: the damage the
// character's features send back.
export function authoredAfterHit(
  campaign: Campaign,
  input: { encounter: Encounter; attacker: EncounterEnemy; target: CharacterSheet; dealt: number },
): string[] {
  const lines: string[] = [];
  if (input.dealt <= 0) {
    return lines;
  }
  const target = getSheetById(input.target.id) ?? input.target;
  for (const { effect, held } of activeAuthored(target, "retaliate")) {
    const live = getEnemy(input.attacker.id);
    if (!live || live.status !== "alive") {
      break;
    }
    const amount =
      effect.formula === "half_dealt"
        ? Math.floor(input.dealt / 2)
        : Number(rollCard(campaign, null, target.id, "damage", rollAgainst(held.feature, live.displayName), resolveFormula(effect.formula, held.level, modsOf(target)), sheetAttacker(target)).total);
    if (amount > 0) {
      lines.push(hurtEnemy(campaign, input.encounter, live, amount, effect.type, held.feature));
    }
  }
  return lines;
}

// ---- a character attacks ----

export function authoredAttackSituation(input: {
  campaignId: string;
  encounter: Encounter;
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  melee: boolean;
}): { sources: Advantage[]; notes: string[]; autoCrit: string | null } {
  const { encounter, sheet, enemy } = input;
  const sources: Advantage[] = [];
  const notes: string[] = [];
  let autoCrit: string | null = null;
  const type = lower(enemy.stats.type);
  for (const { effect, held } of activeAuthored(sheet, "attack_adv")) {
    let applies = false;
    if (effect.vs === "not_acted") {
      const at = encounter.orderReady
        ? encounter.order.findIndex((entry) => entry.kind === "enemy" && entry.enemyId === enemy.id)
        : -1;
      applies =
        encounter.round <= 1 &&
        (encounter.surprisedIds.includes(enemy.id) || (at >= 0 && at > encounter.turnIndex));
    } else if (effect.vs === "frightened_by_self") {
      const condition = enemy.conditions.find((entry) => lower(entry) === "frightened");
      applies = Boolean(condition && metaOf(enemy, condition)?.source === sheet.id);
    } else if (effect.vs === "distracted") {
      const condition = enemy.conditions.find((entry) => lower(entry) === "distracted");
      applies = Boolean(condition && metaOf(enemy, condition)?.source === sheet.id);
    } else if (effect.vs === "types") {
      applies = (effect.types ?? []).some((kind) => type.includes(kind));
    }
    if (applies) {
      sources.push("advantage");
      notes.push(`${held.feature}: advantage`);
    }
  }
  for (const { held } of activeAuthored(sheet, "auto_crit")) {
    if (encounter.surprisedIds.includes(enemy.id)) {
      autoCrit = held.feature;
      notes.push(`${held.feature}: a hit on a surprised creature is a critical hit`);
    }
  }
  // Totem Spirit (Wolf): an ally's melee attack on a creature within 5 feet
  // of the raging barbarian has advantage.
  if (input.melee) {
    for (const wolf of fielded(input.campaignId)) {
      if (wolf.id === sheet.id) {
        continue;
      }
      for (const { effect, held } of activeAuthored(wolf, "pack_adv")) {
        if (withinFeet(encounter.id, wolf.id, enemy.id, effect.rangeFt)) {
          sources.push("advantage");
          notes.push(`${held.feature}: ${wolf.name}'s totem gives advantage on melee attacks against it`);
        }
      }
    }
  }
  return { sources, notes, autoCrit };
}

// A character's attack has hit (and may have killed). Returns the lines for
// the tool result.
export function authoredOnHit(
  campaign: Campaign,
  // `melee` unknown (a parked roll): read off the board. `weapon` false for
  // a spell attack, which lays no mark.
  input: { encounter: Encounter; sheet: CharacterSheet; enemy: EncounterEnemy; melee?: boolean; weapon?: boolean; weaponName?: string; dead: boolean },
): string[] {
  const lines: string[] = [];
  const sheet = getSheetById(input.sheet.id) ?? input.sheet;
  const encounter = getActiveEncounter(campaign.id) ?? input.encounter;
  // Form of the Beast's bite (src/lib/dm/authored-attacks.ts).
  lines.push(...naturalWeaponOnHit(campaign, encounter, sheet, input.weaponName));
  // Emissary of Redemption holds only while the paladin harms nobody.
  if (activeAuthored(sheet, "resist").some(({ held }) => held.feature === "Emissary of Redemption")) {
    patchSheet(sheet.id, {
      conditions: [...sheet.conditions, "emissary lapsed"],
      conditionMeta: { ...sheet.conditionMeta, "emissary lapsed": { rounds: 14400 } },
    });
    publishSheet(campaign, sheet.id);
    lines.push("Emissary of Redemption: attacking sets its resistance and radiance aside until a long rest.");
  }
  const enemy = getEnemy(input.enemy.id);
  if (enemy && enemy.status === "alive") {
    // Order's Wrath: another's hit calls down the cleric's curse.
    const cursed = enemy.conditions.find((entry) => lower(entry) === "order's wrath");
    const curse = cursed ? (metaOf(enemy, cursed) as { source?: string; dice?: string; type?: string } | undefined) : undefined;
    if (cursed && curse?.source && curse.source !== sheet.id) {
      const cleared = enemy.conditions.filter((entry) => entry !== cursed);
      const meta = { ...(enemy.conditionMeta as ConditionMetaMap) };
      delete meta[cursed];
      patchEnemyConditions(enemy.id, cleared, meta);
      const cleric = getSheetById(curse.source);
      const amount = rollCard(campaign, null, cleric?.id ?? null, "damage", rollAgainst("Order's Wrath", enemy.displayName), curse.dice ?? "2d8", cleric ? sheetAttacker(cleric) : null).total;
      const fresh = getEnemy(enemy.id);
      if (fresh) {
        lines.push(hurtEnemy(campaign, encounter, fresh, amount, curse.type ?? "psychic", "Order's Wrath"));
      }
    }
    if (input.weapon !== false) {
      const melee = input.melee ?? withinFeet(encounter.id, sheet.id, enemy.id, 5);
      lines.push(...markEnemy(campaign, encounter, sheet, enemy, melee));
    }
  }
  if (input.dead) {
    lines.push(...authoredOnKill(campaign, encounter, input.enemy, sheet.id, input.melee ?? false));
  }
  return lines;
}

// The marks this character's hit lays on the creature it hit, once a turn
// where the feature says so.
function markEnemy(campaign: Campaign, encounter: Encounter, sheet: CharacterSheet, target: EncounterEnemy, melee: boolean): string[] {
  const lines: string[] = [];
  for (const { effect, held } of activeAuthored(sheet, "mark")) {
    if (effect.melee && !melee) {
      continue;
    }
    if (effect.firstRoundOnly && encounter.round > 1) {
      continue;
    }
    const stamp = turnKey(encounter);
    if (effect.oncePerTurn) {
      const already = listEnemies(encounter.id).some((other) =>
        other.conditions.some((entry) => {
          const meta = metaOf(other, entry) as { source?: string; stamp?: string } | undefined;
          return lower(entry) === effect.condition && meta?.source === sheet.id && meta.stamp === stamp;
        }),
      );
      if (already) {
        continue;
      }
    }
    const fresh = getEnemy(target.id);
    if (!fresh || fresh.status !== "alive") {
      break;
    }
    const kept = fresh.conditions.filter((entry) => lower(entry) !== effect.condition);
    const meta = {
      ...(fresh.conditionMeta as ConditionMetaMap),
      [effect.condition]: {
        source: sheet.id,
        stamp,
        ...(effect.effect === "save_disadv" ? { untilTurnEndOf: sheet.id } : { untilTurnOf: sheet.id }),
        ...(effect.halve ? { halve: true } : {}),
        ...(effect.dice ? { dice: effect.dice, type: effect.damageType ?? "" } : {}),
      },
    };
    patchEnemyConditions(fresh.id, [...kept, effect.condition], meta as typeof fresh.conditionMeta);
    lines.push(`${held.feature}: ${fresh.displayName} is marked (${effect.condition}).`);
  }
  return lines;
}

// Keeper of Souls works once a turn: the turn it last worked, per holder.
const KEEPER_USED = new Map<string, string>();

// A creature dropped to 0: Touch of Death for a monk within 5 feet (the
// killer off the board), Keeper of Souls for a Grave cleric within 60.
export function authoredOnKill(
  campaign: Campaign,
  encounter: Encounter,
  enemy: EncounterEnemy,
  killerId: string | null,
  killerMelee = false,
): string[] {
  const lines: string[] = [];
  const board = getBattleMapForEncounter(encounter.id) !== null;
  // The fallen creature's token is already gone from the board, so its place
  // is read from the one who felled it: within 5 feet is the killer's own
  // melee blow; a wider reach is measured from the killer.
  const near = (holder: CharacterSheet, feet: number) =>
    feet <= 5
      ? holder.id === killerId && killerMelee
      : !board || !killerId || holder.id === killerId || withinFeet(encounter.id, holder.id, killerId, feet);
  const stamp = `${encounter.id}:${turnKey(encounter)}`;
  for (const holder of fielded(campaign.id)) {
    for (const { effect, held } of activeAuthored(holder, "kill_temp_hp")) {
      if (!near(holder, 5)) {
        continue;
      }
      const amount = Math.max(1, Number(resolveFormula(effect.formula, held.level, modsOf(holder))) || 1);
      if (setTempHp(campaign, getSheetById(holder.id) ?? holder, amount)) {
        lines.push(`${held.feature}: ${holder.name} gains ${amount} temporary hit points.`);
      }
    }
    for (const { effect, held } of activeAuthored(holder, "death_heal")) {
      if (!near(holder, effect.rangeFt) || KEEPER_USED.get(holder.id) === stamp) {
        continue;
      }
      const party = fielded(campaign.id).filter((ally) => !board || withinFeet(encounter.id, holder.id, ally.id, effect.rangeFt));
      const hurt = party.sort((a, b) => a.currentHp / effectiveMaxHp(a) - b.currentHp / effectiveMaxHp(b))[0];
      if (!hurt || hurt.currentHp >= effectiveMaxHp(hurt)) {
        continue;
      }
      const given = heal(campaign, hurt, hitDiceOf(enemy));
      if (given > 0) {
        KEEPER_USED.set(holder.id, stamp);
        lines.push(`${held.feature}: ${hurt.name} regains ${given} hit points from the fallen creature's life.`);
      }
    }
  }
  return lines;
}

// A stat block's Hit Dice, from its hit points: the die its size rolls
// (d4 Tiny to d20 Gargantuan) plus its CON modifier, per die.
export function hitDiceOf(enemy: EncounterEnemy): number {
  const die: Record<string, number> = { tiny: 2.5, small: 3.5, medium: 4.5, large: 5.5, huge: 6.5, gargantuan: 10.5 };
  const size = lower(enemy.stats.size ?? "medium");
  const con = Math.floor(((enemy.stats.abilities?.con ?? 10) - 10) / 2);
  const each = Math.max(1, (die[size] ?? 4.5) + con);
  return Math.max(1, Math.round(enemy.maxHp / each));
}

// Sneak Attack with no advantage and no ally: against the creature the
// Inquisitive read with Insightful Fighting, or in Rakish Audacity's duel
// (the rogue within 5 feet of the target and nobody else within 5 feet of
// the rogue, on the board). The feature's name, or null.
export function authoredSneakEdge(encounterId: string, sheetId: string, enemyId: string): string | null {
  const sheet = getSheetById(sheetId);
  const enemy = getEnemy(enemyId);
  if (!sheet || !enemy) {
    return null;
  }
  const read = enemy.conditions.find((entry) => lower(entry) === "insightful fighting");
  if (read && metaOf(enemy, read)?.source === sheetId) {
    return "Insightful Fighting";
  }
  const duel = activeAuthored(sheet, "sneak_duel")[0];
  const map = duel ? getBattleMapForEncounter(encounterId) : null;
  if (!duel || !map) {
    return null;
  }
  const tokens = listTokens(map.id);
  const me = tokens.find((token) => token.refId === sheetId);
  const target = tokens.find((token) => token.refId === enemyId);
  if (!me || !target || tilesApart(me, target) > 1) {
    return null;
  }
  const crowded = tokens.some(
    (token) => token.refId !== sheetId && token.refId !== enemyId && tilesApart(me, token) <= 1,
  );

  return crowded ? null : duel.held.feature;
}
