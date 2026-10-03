// What a spell area does to a creature (SRD 5.1), at the three moments the
// spells name: entering it for the first time on a turn (or every 5 feet
// moved in it, Spike Growth), starting a turn in it, and ending one there.
// The row (src/lib/battlemap/zones-spells.ts) says which moments, who, the
// save, the damage and what a failure lays down; the caster's DC and slot
// level ride the stored zone.
//
//   zonesAfterMove: the move route, move_token, an enemy's approach and a
//     companion's walk call it with the squares walked.
//   zoneTurnStart:  the pointer's turn starts (condition-tick.ts), after the
//     areas that ran out are cleared and the drifting clouds have moved.
//   zoneTurnEnd:    a turn ends (turn-end.ts).
//
// A character's save is a roll card and its damage goes through the damage
// path (resistances, concentration, death); an enemy's save is a DM-only
// roll row and its damage lands through spell-aura.ts hurtEnemy. Returns
// the lines for the table.

import type { Campaign } from "@/lib/db/campaigns";
import { createDmTurn, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { getBattleMapForEncounter, listHiddenRefIds, listTokens, moveToken, type BattleMap } from "@/lib/db/battle-maps";
import type { RollAttacker } from "@/lib/db/rolls";
import { rollCard } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";
import { getActiveEncounter, getEnemy, patchEnemyConditions, setEnemyConcentration, turnKey, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { spellSaveDcFor } from "@/lib/srd";
import { addDice } from "@/lib/srd/spell-scaling";
import { blocksMove, chebyshev, tileAt, tileIndex, type BattleToken, type XY } from "@/lib/battlemap/types";
import { hostileTo, layZone, type SpellZone } from "@/lib/battlemap/zones";
import { zoneRowFor, type ZoneMoment, type ZoneRow, type ZoneTrigger } from "@/lib/battlemap/zones-spells";
import { holdGasesBack } from "@/lib/battlemap/zones-walls";
import { isQuake, quakeFissures, quakeShake } from "@/lib/dm/zone-quake";
import { rollCharacterSave, rollEnemySave } from "@/lib/dm/forced-save";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { breakConcentration, clearSpellConditionsByName } from "@/lib/dm/concentration";
import { laySpellConditionsOnEnemy } from "@/lib/dm/spell-effects";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { liveZones, publishZones, saveZones } from "@/lib/dm/zone-store";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A turn for a character's saves and damage, closed once used, as an
// opportunity attack's is (src/lib/dm/opportunity-strike.ts).
function withZoneTurn<T>(campaignId: string, run: (turn: DmTurn) => T): T {
  const turn = createDmTurn(campaignId, [], "human_dm");
  try {
    return run(turn);
  } finally {
    turn.status = "done";
    saveDmTurn(turn);
  }
}

type Victim = { kind: "pc" | "enemy"; id: string };

function victimOf(token: BattleToken): Victim | null {
  return token.kind === "pc" || token.kind === "enemy" ? { kind: token.kind, id: token.refId } : null;
}

function dcOf(zone: SpellZone): number {
  if (zone.dc) {
    return zone.dc;
  }
  const caster = zone.casterKind === "pc" ? getSheetById(zone.casterId) : null;
  return (caster && spellSaveDcFor(caster, zone.spell)) ?? 13;
}

function diceOf(trigger: ZoneTrigger, row: ZoneRow, zone: SpellZone, times: number): string | null {
  if (!trigger.dice) {
    return null;
  }
  const above = Math.max(0, (zone.slotLevel ?? row.level) - row.level);
  const one = trigger.perSlot ? addDice(trigger.dice, trigger.perSlot, above) : trigger.dice;
  if (times <= 1) {
    return one;
  }
  const match = /^(\d+)d(\d+)$/.exec(one);
  return match ? `${Number(match[1]) * times}d${match[2]}` : Array.from({ length: times }, () => one).join("+");
}

const holds = (conditions: string[], name: string) => conditions.some((entry) => entry.toLowerCase() === name);

// Pushes a creature `feet` along the line away from the zone's caster,
// square by square, stopping at a wall, the edge or another creature.
function pushAlong(map: BattleMap, zone: SpellZone, token: BattleToken, feet: number): XY | null {
  const toward = zone.toward ?? token;
  const distance = Math.max(1, chebyshev(zone.origin.x, zone.origin.y, toward.x, toward.y));
  const ux = Math.round((toward.x - zone.origin.x) / distance);
  const uy = Math.round((toward.y - zone.origin.y) / distance);
  const taken = new Set(listTokens(map.id).filter((other) => other.id !== token.id).map((other) => tileIndex(map.width, other.x, other.y)));
  let at: XY = { x: token.x, y: token.y };
  for (let step = 0; step < Math.floor(feet / 5); step += 1) {
    const next = { x: at.x + ux, y: at.y + uy };
    if (
      next.x < 0 || next.y < 0 || next.x >= map.width || next.y >= map.height ||
      blocksMove(tileAt(map.terrain, map.width, next.x, next.y)) ||
      taken.has(tileIndex(map.width, next.x, next.y))
    ) {
      break;
    }
    at = next;
  }
  if (at.x === token.x && at.y === token.y) {
    return null;
  }
  moveToken(token.id, at.x, at.y, token.movedThisRound);
  return at;
}

// One creature suffers one area once: the save, the damage, what a failure
// lays down. `times` multiplies the dice (Spike Growth's squares).
function strike(
  campaign: Campaign,
  encounter: Encounter,
  map: BattleMap,
  zone: SpellZone,
  victim: Victim,
  moment: ZoneMoment,
  times = 1,
): string[] {
  const row = zoneRowFor(zone.spell);
  const trigger = row?.trigger;
  if (!row || !trigger) {
    return [];
  }
  const dc = dcOf(zone);
  const why = moment === "enter" ? `entering ${zone.spell}` : moment === "each5" ? `moving through ${zone.spell}` : `${zone.spell}`;
  const dice = diceOf(trigger, row, zone, times);
  const lines: string[] = [];
  // The zone's damage card names its caster, unless the players cannot see
  // an enemy caster's token (src/lib/dm/aoe-damage.ts names it the same way).
  const by: RollAttacker =
    zone.casterKind === "pc"
      ? { kind: "sheet", id: zone.casterId, name: zone.casterName }
      : { kind: "enemy", id: zone.casterId, name: listHiddenRefIds(map.id).includes(zone.casterId) ? "Someone unseen" : zone.casterName };
  if (victim.kind === "enemy") {
    const enemy = getEnemy(victim.id);
    if (!enemy || enemy.status !== "alive") {
      return [];
    }
    if (trigger.condition && holds(enemy.conditions, trigger.condition) && !dice) {
      return [];
    }
    const immune = trigger.immuneSucceeds && new RegExp(`\\b${trigger.immuneSucceeds}\\b`, "i").test(enemy.stats.immune ?? "");
    const save = trigger.save && !immune
      ? rollEnemySave(campaign.id, enemy, trigger.save, dc, { magical: true, record: { detail: `${enemy.displayName}: ${trigger.save.toUpperCase()} save against ${zone.spell}` } })
      : null;
    const failed = trigger.save ? !immune && !save?.success : true;
    if (trigger.save) {
      lines.push(`${enemy.displayName} ${failed ? "fails" : "makes"} its ${trigger.save.toUpperCase()} save against ${zone.spell} (DC ${dc}).`);
    }
    let dealt = 0;
    if (dice && (failed || (trigger.half && !trigger.damageOnFail))) {
      const rolled = rollCard(campaign, null, zone.casterKind === "pc" ? zone.casterId : null, "damage", rollAgainst(zone.spell, enemy.displayName), dice, by).total;
      dealt = failed ? rolled : Math.floor(rolled / 2);
      if (dealt > 0) {
        const before = enemy.currentHp;
        lines.push(hurtEnemy(campaign, encounter, enemy, dealt, trigger.type ?? "force", why));
        dealt = Math.max(0, before - (getEnemy(enemy.id)?.currentHp ?? before));
      }
    }
    zone.dealt = (zone.dealt ?? 0) + dealt;
    const standing = getEnemy(enemy.id);
    if (failed && standing?.status === "alive") {
      lines.push(...afterFailOnEnemy(campaign, map, zone, trigger, standing, dc));
    }
    return lines;
  }
  const sheet = getSheetById(victim.id);
  if (!sheet || sheet.deathSaves?.dead) {
    return [];
  }
  if (trigger.condition && holds(sheet.conditions, trigger.condition) && !dice) {
    return [];
  }
  return withZoneTurn(campaign.id, (turn) => {
    const save = trigger.save
      ? rollCharacterSave(campaign, turn, sheet, trigger.save, dc, `${trigger.save.toUpperCase()} save against ${zone.spell}`, [trigger.type, "spell"].filter(Boolean).join(" "))
      : null;
    const failed = trigger.save ? !save?.success : true;
    if (trigger.save) {
      lines.push(`${sheet.name} ${failed ? "fails" : "makes"} the ${trigger.save.toUpperCase()} save against ${zone.spell} (DC ${dc}).`);
    }
    if (dice && (failed || (trigger.half && !trigger.damageOnFail))) {
      const rolled = rollCard(campaign, turn, sheet.id, "damage", rollAgainst(zone.spell, sheet.name), dice, by).total;
      const amount = failed ? rolled : Math.floor(rolled / 2);
      if (amount > 0) {
        const hurt = applyPcDamage(campaign, turn.id, getSheetById(sheet.id) ?? sheet, {
          amount,
          type: trigger.type,
          magical: true,
          spell: true,
          reason: why,
        });
        const taken = typeof hurt.damageApplied === "number" ? hurt.damageApplied : amount;
        zone.dealt = (zone.dealt ?? 0) + taken;
        lines.push(`${sheet.name} takes ${amount} ${trigger.type ?? ""} damage from ${why}.`.replace("  ", " "));
      }
    }
    const standing = getSheetById(sheet.id);
    if (failed && standing && !standing.deathSaves?.dead) {
      lines.push(...afterFailOnCharacter(campaign, turn, map, zone, trigger, standing, dc));
    }
    return lines;
  });
}

// What a failed save lays on an enemy: a condition (restrained is the
// spell's and ends with it; prone is the ground's and stays), a lost
// action, a lost concentration, a push.
function afterFailOnEnemy(campaign: Campaign, map: BattleMap, zone: SpellZone, trigger: ZoneTrigger, enemy: EncounterEnemy, dc: number): string[] {
  const lines: string[] = [];
  if (trigger.condition) {
    const meta = trigger.condition === "prone" ? {} : { spell: zone.spell, source: zone.casterId, ...(zone.slotLevel ? { slotLevel: zone.slotLevel } : {}) };
    if (laySpellConditionsOnEnemy(enemy.id, [trigger.condition], meta).length) {
      lines.push(`${enemy.displayName} is ${trigger.condition} by ${zone.spell}.`);
    }
  }
  if (trigger.losesAction && !holds(enemy.conditions, "retching")) {
    const meta: ConditionMetaMap = { ...(enemy.conditionMeta as ConditionMetaMap), retching: { spell: zone.spell, source: zone.casterId, untilTurnEndOf: enemy.id, turnBegun: true } };
    patchEnemyConditions(enemy.id, [...enemy.conditions, "retching"], meta);
    lines.push(`${enemy.displayName} spends its action this turn retching.`);
  }
  if (trigger.concentrationSave && enemy.concentration) {
    const kept = rollEnemySave(campaign.id, enemy, "con", dc, { magical: true, record: { detail: `${enemy.displayName}: CON save to keep concentration in ${zone.spell}` } });
    if (!kept.success) {
      const spell = enemy.concentration;
      setEnemyConcentration(enemy.id, null);
      clearSpellConditionsByName(campaign, spell, undefined, enemy.id);
      lines.push(`${enemy.displayName} loses its concentration on ${spell}.`);
    }
  }
  if (trigger.pushFeet) {
    const token = listTokens(map.id).find((entry) => entry.refId === enemy.id);
    const at = token ? pushAlong(map, zone, token, trigger.pushFeet) : null;
    if (at) {
      lines.push(`${enemy.displayName} is pushed to (${at.x},${at.y}).`);
    }
  }
  return lines;
}

function afterFailOnCharacter(campaign: Campaign, turn: DmTurn, map: BattleMap, zone: SpellZone, trigger: ZoneTrigger, sheet: CharacterSheet, dc: number): string[] {
  const lines: string[] = [];
  if (trigger.condition && !holds(sheet.conditions, trigger.condition)) {
    const spellEffect = trigger.condition === "prone" ? undefined : { spell: zone.spell, source: zone.casterId };
    const laid = handleSetCondition(campaign, turn.id, sheet, { condition: trigger.condition }, `${zone.spell}`, spellEffect ? { spellEffect } : undefined);
    if (!("error" in laid)) {
      lines.push(`${sheet.name} is ${trigger.condition} by ${zone.spell}.`);
    }
  }
  if (trigger.losesAction && !holds(sheet.conditions, "retching")) {
    const updated = patchSheet(sheet.id, {
      conditions: [...sheet.conditions, "retching"],
      conditionMeta: { ...(sheet.conditionMeta as ConditionMetaMap), retching: { spell: zone.spell, source: zone.casterId, untilTurnEndOf: sheet.id, turnBegun: true } },
    });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    lines.push(`${sheet.name} spends their action this turn retching.`);
  }
  if (trigger.concentrationSave && sheet.concentratingOn) {
    const kept = rollCharacterSave(campaign, turn, sheet, "con", dc, `CON save to keep concentration in ${zone.spell}`);
    if (!kept.success) {
      const spell = breakConcentration(campaign, turn.id, sheet.id, `lost in ${zone.spell}`);
      if (spell) {
        lines.push(`${sheet.name} loses their concentration on ${spell}.`);
      }
    }
  }
  if (trigger.pushFeet) {
    const token = listTokens(map.id).find((entry) => entry.refId === sheet.id);
    const at = token ? pushAlong(map, zone, token, trigger.pushFeet) : null;
    if (at) {
      lines.push(`${sheet.name} is pushed to (${at.x},${at.y}).`);
    }
  }
  return lines;
}

// The zone's creature filter: hostile-only areas spare the caster's side,
// and nobody suffers their own aura.
function touches(zone: SpellZone, trigger: ZoneTrigger, victim: Victim): boolean {
  if (victim.id === zone.casterId && zoneRowFor(zone.spell)?.shape === "aura") {
    return false;
  }
  return trigger.who !== "hostile" || hostileTo(zone, victim.kind);
}

// Writes the areas back after a pass: running totals, who was struck, and
// a Guardian of Faith that has spent itself gone.
function settle(campaign: Campaign, map: BattleMap, zones: SpellZone[]) {
  const kept = zones.filter((zone) => {
    const budget = zoneRowFor(zone.spell)?.budget;
    return !budget || (zone.dealt ?? 0) < budget;
  });
  saveZones(map.id, kept);
  publishZones(campaign.id);
}

// A creature walked `walked` from `start`: the areas it entered, and the
// feet it moved inside Spike Growth. A creature an area restrains stops on
// the square it was caught on.
export function zonesAfterMove(
  campaign: Campaign,
  encounterId: string,
  mover: { kind: string; refId: string },
  start: XY,
  walked: XY[],
): string[] {
  const encounter = getActiveEncounter(campaign.id);
  const map = getBattleMapForEncounter(encounterId);
  const victim = mover.kind === "pc" || mover.kind === "enemy" ? { kind: mover.kind, id: mover.refId } as Victim : null;
  if (!encounter || encounter.id !== encounterId || !map || !victim || !walked.length) {
    return [];
  }
  const zones = liveZones(map, encounter);
  const armed = zones.filter((zone) => zoneRowFor(zone.spell)?.trigger?.on.some((moment) => moment === "enter" || moment === "each5"));
  if (!armed.length) {
    return [];
  }
  const lines: string[] = [];
  const key = turnKey(encounter);
  let stopAt: XY | null = null;
  for (const zone of armed) {
    const trigger = zoneRowFor(zone.spell)?.trigger as ZoneTrigger;
    if (!touches(zone, trigger, victim)) {
      continue;
    }
    let wasIn = zone.cells.includes(tileIndex(map.width, start.x, start.y));
    let enteredAt: XY | null = null;
    let inside = 0;
    for (const step of walked) {
      const nowIn = zone.cells.includes(tileIndex(map.width, step.x, step.y));
      if (nowIn) {
        inside += 1;
      }
      if (nowIn && !wasIn && !enteredAt) {
        enteredAt = step;
      }
      wasIn = nowIn;
    }
    if (trigger.on.includes("each5") && inside > 0) {
      lines.push(...strike(campaign, encounter, map, zone, victim, "each5", inside));
    }
    const struckKey = `${victim.id}:enter`;
    if (trigger.on.includes("enter") && enteredAt && zone.struck?.[struckKey] !== key) {
      zone.struck = { ...(zone.struck ?? {}), [struckKey]: key };
      lines.push(...strike(campaign, encounter, map, zone, victim, "enter"));
      if (trigger.condition === "restrained" && stillHeld(victim)) {
        stopAt = stopAt ?? enteredAt;
      }
    }
  }
  if (stopAt) {
    const token = listTokens(map.id).find((entry) => entry.refId === victim.id);
    if (token && (token.x !== stopAt.x || token.y !== stopAt.y)) {
      moveToken(token.id, stopAt.x, stopAt.y, token.movedThisRound);
      lines.push(`It is held fast at (${stopAt.x},${stopAt.y}).`);
    }
  }
  settle(campaign, map, zones);
  return lines;
}

function stillHeld(victim: Victim): boolean {
  const conditions = victim.kind === "enemy" ? getEnemy(victim.id)?.conditions : getSheetById(victim.id)?.conditions;
  return holds(conditions ?? [], "restrained");
}

// The areas at a turn's start: the ones that ran out are gone, a drifting
// cloud moves away from its caster when the caster's turn starts, and each
// creature whose turn starts inside an area suffers it.
export function zoneTurnStart(campaign: Campaign, encounter: Encounter, combatantIds: string[]): string[] {
  const map = getBattleMapForEncounter(encounter.id);
  if (!map?.spellZones.length || !combatantIds.length) {
    return [];
  }
  const zones = liveZones(map, encounter);
  const tokens = listTokens(map.id);
  const lines: string[] = [];
  for (const zone of zones) {
    const row = zoneRowFor(zone.spell);
    const caster = tokens.find((token) => token.refId === zone.casterId);
    if (!row?.drifts || !caster || !combatantIds.includes(zone.casterId)) {
      continue;
    }
    const steps = Math.floor(row.drifts / 5);
    const dx = Math.sign(zone.origin.x - caster.x) || (zone.origin.y === caster.y ? 1 : 0);
    const dy = Math.sign(zone.origin.y - caster.y);
    const origin = {
      x: Math.max(0, Math.min(map.width - 1, zone.origin.x + dx * steps)),
      y: Math.max(0, Math.min(map.height - 1, zone.origin.y + dy * steps)),
    };
    zone.origin = origin;
    // A Wind Wall in its path holds it back (zones-walls.ts).
    zone.cells = holdGasesBack([...zones.filter((other) => other !== zone), { ...zone, cells: layZone(row, { origin, slotLevel: zone.slotLevel }, map).cells }], map.width).at(-1)?.cells ?? [];
    lines.push(`${zone.spell} drifts 10 feet away from ${zone.casterName} to (${origin.x},${origin.y}).`);
  }
  // The turns now starting, for the areas that strike as a turn ends: an
  // enemy's turn ends when the table has played it, which the pointer only
  // knows afterwards (src/lib/dm/turn-end.ts), so its end strikes once for
  // each turn it began.
  const key = turnKey(encounter);
  for (const zone of zones) {
    if (zoneRowFor(zone.spell)?.trigger?.on.includes("end") || isQuake(zone)) {
      zone.struck = { ...(zone.struck ?? {}), ...Object.fromEntries(combatantIds.map((id) => [`${id}:begun`, key])) };
    }
  }
  // Earthquake's fissures open as its caster's next turn starts (zone-quake.ts).
  for (const zone of zones) {
    if (isQuake(zone) && combatantIds.includes(zone.casterId) && !zone.struck?.["quake:fissures"] && encounter.round > zone.castRound) {
      zone.struck = { ...(zone.struck ?? {}), "quake:fissures": key };
      lines.push(...quakeFissures(campaign, encounter, map, zone, dcOf(zone)));
    }
  }
  lines.push(...momentFor(campaign, encounter, map, zones, tokens, combatantIds, "start"));
  settle(campaign, map, zones);
  return lines;
}

// Each creature whose turn is ending inside an area that strikes then (and
// within 10 feet of a Wall of Fire's burning side).
export function zoneTurnEnd(campaign: Campaign, encounterId: string, combatantIds: string[]): string[] {
  const encounter = getActiveEncounter(campaign.id);
  const map = getBattleMapForEncounter(encounterId);
  if (!encounter || encounter.id !== encounterId || !map?.spellZones.length || !combatantIds.length) {
    return [];
  }
  const zones = liveZones(map, encounter);
  const lines = momentFor(campaign, encounter, map, zones, listTokens(map.id), combatantIds, "end");
  // Earthquake shakes the ground again as its caster's turn ends
  // (zone-quake.ts): once a turn, an enemy caster's once for each turn begun.
  let shook = false;
  for (const zone of zones.filter((entry) => isQuake(entry) && combatantIds.includes(entry.casterId))) {
    const turn = zone.casterKind === "enemy" ? zone.struck?.[`${zone.casterId}:begun`] : turnKey(encounter);
    if (!turn || zone.struck?.[`${zone.casterId}:quake`] === turn) {
      continue;
    }
    zone.struck = { ...(zone.struck ?? {}), [`${zone.casterId}:quake`]: turn };
    shook = true;
    lines.push(`The ground heaves under ${zone.spell}.`, ...quakeShake(campaign, map, zone, dcOf(zone)));
  }
  if (lines.length || shook) {
    settle(campaign, map, zones);
  }
  return lines;
}

function momentFor(
  campaign: Campaign,
  encounter: Encounter,
  map: BattleMap,
  zones: SpellZone[],
  tokens: BattleToken[],
  combatantIds: string[],
  moment: "start" | "end",
): string[] {
  const lines: string[] = [];
  for (const id of combatantIds) {
    const token = tokens.find((entry) => entry.refId === id);
    const victim = token ? victimOf(token) : null;
    if (!token || !victim) {
      continue;
    }
    const cell = tileIndex(map.width, token.x, token.y);
    for (const zone of zones) {
      const trigger = zoneRowFor(zone.spell)?.trigger;
      if (!trigger?.on.includes(moment) || !touches(zone, trigger, victim)) {
        continue;
      }
      const inArea = zone.cells.includes(cell) || (moment === "end" && Boolean(zone.hot?.includes(cell)));
      if (inArea && moment === "end" && victim.kind === "enemy") {
        const begun = zone.struck?.[`${id}:begun`];
        if (!begun || zone.struck?.[`${id}:end`] === begun) {
          continue;
        }
        zone.struck = { ...(zone.struck ?? {}), [`${id}:end`]: begun };
      }
      // Black Tentacles' hold crushes what it already restrains at the start
      // of its turn on its own (src/lib/dm/spell-aura.ts); it saves no more.
      if (!inArea || (trigger.condition === "restrained" && trigger.dice && stillHeld(victim))) {
        continue;
      }
      if (trigger.once) {
        if (zone.struck?.[`${id}:once`]) {
          continue;
        }
        zone.struck = { ...(zone.struck ?? {}), [`${id}:once`]: turnKey(encounter) };
      }
      lines.push(...strike(campaign, encounter, map, zone, victim, moment));
    }
  }
  return lines;
}
