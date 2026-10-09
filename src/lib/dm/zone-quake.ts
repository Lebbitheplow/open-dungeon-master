// Earthquake (SRD 5.1) on the battle map, past the difficult ground its row
// lays (src/lib/battlemap/zones-spells.ts "earthquake"):
//
//   - "When you cast this spell and at the end of each of your turns you
//     spend concentrating on it, each creature on the ground in the area
//     must make a Dexterity saving throw. On a failed save, the creature is
//     knocked prone." A creature concentrating in the area "must make a
//     successful Constitution saving throw or lose concentration."
//   - "Fissures open throughout the spell's area at the start of your next
//     turn after you cast the spell. A total of 1d6 such fissures open ...
//     Each fissure is 1d10 x 10 feet deep, 10 feet wide, and extends from one
//     edge of the spell's area to the opposite side. A creature standing on a
//     spot where a fissure opens must succeed on a Dexterity saving throw or
//     fall in." Where they open is the DM's choice; the engine stands in for
//     it with dice: a d2 for the direction (1 across the area from west to
//     east, 2 from north to south) and a die the size of the area for the
//     row or column. A fall is 1d6 bludgeoning per 10 feet and lands prone.
//
// The collapse of structures is narrated: the board has no buildings with
// hit points. Called by zone-cast.ts (the casting), zone-triggers.ts (the
// caster's turn start and end). Must not import encounter-tools, map-tools
// or mutations.

import type { Campaign } from "@/lib/db/campaigns";
import { createDmTurn, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { listTokens, type BattleMap } from "@/lib/db/battle-maps";
import { getEnemy, setEnemyConcentration, type Encounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { tileIndex, type BattleToken } from "@/lib/battlemap/types";
import type { SpellZone } from "@/lib/battlemap/zones";
import { zoneRowFor } from "@/lib/battlemap/zones-spells";
import { rollCharacterSave, rollEnemySave } from "@/lib/dm/forced-save";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { breakConcentration, clearSpellConditionsByName } from "@/lib/dm/concentration";
import { laySpellConditionsOnEnemy } from "@/lib/dm/spell-effects";
import { rollCard } from "@/lib/dm/roll-card";
import { rollOn } from "@/lib/roll-labels";

function withQuakeTurn<T>(campaignId: string, run: (turn: DmTurn) => T): T {
  const turn = createDmTurn(campaignId, [], "human_dm");
  try {
    return run(turn);
  } finally {
    turn.status = "done";
    saveDmTurn(turn);
  }
}

export const isQuake = (zone: SpellZone) => Boolean(zoneRowFor(zone)?.quake);

const prone = (conditions: string[]) => conditions.some((entry) => entry.toLowerCase() === "prone");

// The creatures on the ground in `cells`: every token of a creature there
// that is not flying.
function groundedIn(map: BattleMap, cells: number[]): BattleToken[] {
  const inside = new Set(cells);
  return listTokens(map.id).filter(
    (token) => (token.kind === "pc" || token.kind === "enemy") && token.movement !== "fly" && inside.has(tileIndex(map.width, token.x, token.y)),
  );
}

// The shaking: a DEX save or prone for each creature on the ground in the
// area, and a CON save for each one concentrating there.
export function quakeShake(campaign: Campaign, map: BattleMap, zone: SpellZone, dc: number): string[] {
  const lines: string[] = [];
  const caught = groundedIn(map, zone.cells);
  if (!caught.length) {
    return lines;
  }
  withQuakeTurn(campaign.id, (turn) => {
    for (const token of caught) {
      if (token.kind === "enemy") {
        const enemy = getEnemy(token.refId);
        if (!enemy || enemy.status !== "alive") {
          continue;
        }
        if (!prone(enemy.conditions)) {
          const save = rollEnemySave(campaign.id, enemy, "dex", dc, { magical: true, record: { turn, detail: `${enemy.displayName}: DEX save against ${zone.spell}` } });
          if (!save.success && laySpellConditionsOnEnemy(enemy.id, ["prone"], {}).length) {
            lines.push(`${enemy.displayName} is knocked prone by ${zone.spell}.`);
          }
        }
        const standing = getEnemy(enemy.id);
        if (standing?.concentration) {
          const kept = rollEnemySave(campaign.id, standing, "con", dc, { magical: true, record: { turn, detail: `${standing.displayName}: CON save to keep concentration in ${zone.spell}` } });
          if (!kept.success) {
            const spell = standing.concentration;
            setEnemyConcentration(standing.id, null);
            clearSpellConditionsByName(campaign, spell, undefined, standing.id);
            lines.push(`${standing.displayName} loses its concentration on ${spell}.`);
          }
        }
        continue;
      }
      const sheet = getSheetById(token.refId);
      if (!sheet || sheet.deathSaves?.dead) {
        continue;
      }
      if (!prone(sheet.conditions)) {
        const save = rollCharacterSave(campaign, turn, sheet, "dex", dc, `DEX save against ${zone.spell}`, "spell");
        if (!save.success) {
          const laid = handleSetCondition(campaign, turn.id, getSheetById(sheet.id) ?? sheet, { condition: "prone" }, zone.spell);
          if (!("error" in laid)) {
            lines.push(`${sheet.name} is knocked prone by ${zone.spell}.`);
          }
        }
      }
      const standing = getSheetById(sheet.id);
      if (standing?.concentratingOn) {
        const kept = rollCharacterSave(campaign, turn, standing, "con", dc, `CON save to keep concentration in ${zone.spell}`);
        if (!kept.success) {
          const spell = breakConcentration(campaign, turn.id, standing.id, `lost in ${zone.spell}`);
          if (spell) {
            lines.push(`${standing.name} loses their concentration on ${spell}.`);
          }
        }
      }
    }
  });
  return lines;
}

// The fissures: 1d6 of them, each 10 feet wide across the whole area and
// 1d10 x 10 feet deep; a creature on the ground where one opens makes a DEX
// save or falls in.
export function quakeFissures(campaign: Campaign, encounter: Encounter, map: BattleMap, zone: SpellZone, dc: number): string[] {
  if (!zone.cells.length) {
    return [];
  }
  const xs = zone.cells.map((cell) => cell % map.width);
  const ys = zone.cells.map((cell) => Math.floor(cell / map.width));
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const count = rollExpression("1d6").total;
  const lines: string[] = [`${count} fissure${count === 1 ? "" : "s"} open${count === 1 ? "s" : ""} in the ${zone.spell}.`];
  const fallen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const across = rollExpression("1d2").total === 1;
    const span = across ? box.y1 - box.y0 + 1 : box.x1 - box.x0 + 1;
    const first = (across ? box.y0 : box.x0) + rollExpression(`1d${Math.max(2, span)}`).total - 1;
    const depth = 10 * rollExpression("1d10").total;
    // Ten feet wide: the row (or column) rolled and the next one.
    const band = new Set([first, first + 1]);
    const cells = zone.cells.filter((cell) => band.has(across ? Math.floor(cell / map.width) : cell % map.width));
    lines.push(`A fissure ${depth} feet deep opens ${across ? `along rows ${first} to ${first + 1}` : `along columns ${first} to ${first + 1}`}.`);
    for (const token of groundedIn(map, cells)) {
      if (fallen.has(token.refId)) {
        continue;
      }
      const line = fallIn(campaign, encounter, zone, token, dc, depth);
      if (line) {
        fallen.add(token.refId);
        lines.push(line);
      }
    }
  }
  lines.push("A fissure opening under a structure brings it down (narrate it); the board keeps the creatures that fell in where they stand, at the fissure's bottom.");
  return lines;
}

// One creature where a fissure opens: its DEX save, and on a failure the
// fall (1d6 bludgeoning per 10 feet, 20d6 at most) and prone. The line when
// it falls, else a line that it keeps its footing.
function fallIn(campaign: Campaign, encounter: Encounter, zone: SpellZone, token: BattleToken, dc: number, depth: number): string | null {
  const dice = `${Math.min(20, Math.max(1, Math.floor(depth / 10)))}d6`;
  // A fall: nobody made it, as an enemy's fall (src/lib/dm/enemy-fall.ts).
  const fall = `${depth} ft fall into a fissure (${dice} bludgeoning)`;
  if (token.kind === "enemy") {
    const enemy = getEnemy(token.refId);
    if (!enemy || enemy.status !== "alive") {
      return null;
    }
    const save = rollEnemySave(campaign.id, enemy, "dex", dc, { magical: true, record: { detail: `${enemy.displayName}: DEX save against a fissure of ${zone.spell}` } });
    if (save.success) {
      return `${enemy.displayName} keeps its footing at the fissure's edge.`;
    }
    const landed = rollCard(campaign, null, null, "damage", rollOn(fall, [enemy.displayName]), dice, null).total;
    const hurt = hurtEnemy(campaign, encounter, enemy, landed, "bludgeoning", `falling ${depth} feet into a fissure`);
    const standing = getEnemy(enemy.id);
    if (standing?.status === "alive") {
      laySpellConditionsOnEnemy(standing.id, ["prone"], {});
    }
    return `${enemy.displayName} falls ${depth} feet into the fissure and lands prone. ${hurt}`;
  }
  const sheet = getSheetById(token.refId);
  if (!sheet || sheet.deathSaves?.dead) {
    return null;
  }
  return withQuakeTurn(campaign.id, (turn) => {
    const save = rollCharacterSave(campaign, turn, sheet, "dex", dc, `DEX save against a fissure of ${zone.spell}`, "spell");
    if (save.success) {
      return `${sheet.name} keeps their footing at the fissure's edge.`;
    }
    const amount = rollCard(campaign, turn, sheet.id, "damage", rollOn(fall, [sheet.name]), dice, null).total;
    applyPcDamage(campaign, turn.id, getSheetById(sheet.id) ?? sheet, { amount, type: "bludgeoning", reason: `fell ${depth} feet into a fissure (${zone.spell})` });
    const standing = getSheetById(sheet.id);
    if (standing && !standing.deathSaves?.dead && !prone(standing.conditions)) {
      handleSetCondition(campaign, turn.id, standing, { condition: "prone" }, zone.spell);
    }
    return `${sheet.name} falls ${depth} feet into the fissure (${amount} bludgeoning) and lands prone.`;
  });
}
