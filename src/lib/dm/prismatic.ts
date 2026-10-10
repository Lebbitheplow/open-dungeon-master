// Prismatic Spray (SRD 5.1): "Each creature in a 60-foot cone must make a
// Dexterity saving throw. For each target, roll a d8 to determine which color
// ray affects it."
//
//   1-5  red fire, orange acid, yellow lightning, green poison, blue cold:
//        10d6 on a failed save, half on a success.
//   6    indigo: on a failed save, restrained; a Constitution save at the end
//        of each of its turns, three successes free it and three failures
//        petrify it (the "Indigo Ray" row and mark, spell-turn-end.ts).
//   7    violet: on a failed save, blinded; a Wisdom save at the start of the
//        caster's next turn ends the blindness, and a failure sends the
//        creature to another plane (it leaves the fight).
//   8    two rays: roll twice more, rerolling any 8.
//
// aoe_damage hands a player's casting here once the slot is paid
// (src/lib/dm/aoe-damage.ts); condition-tick.ts calls violetRayTurnStart as a
// turn starts. One save per creature, which both of a double strike use.

import { saveDamageTaken } from "@/lib/srd/trait-rules";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import { spellMechanicsFor } from "@/lib/content";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { applyDmMutation } from "@/lib/dm/mutations";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { rollCharacterSave, rollEnemySave } from "@/lib/dm/forced-save";
import { rollCard } from "@/lib/dm/action-common";
import type { RollAttacker } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import { layOnEnemy, turnEndMark } from "@/lib/dm/spell-riders";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { VIOLET, VIOLET_MARK } from "@/lib/dm/prismatic-violet";

// The turn-start save lives in its own module so condition-tick.ts can reach it
// without loading the mutation dispatcher (an import cycle through the clock).
export { VIOLET, violetRayTurnStart } from "@/lib/dm/prismatic-violet";

export const PRISMATIC_SPRAY = "prismatic spray";
export const INDIGO = "Indigo Ray";

const RAYS: Array<{ color: string; type?: string }> = [
  { color: "red", type: "fire" },
  { color: "orange", type: "acid" },
  { color: "yellow", type: "lightning" },
  { color: "green", type: "poison" },
  { color: "blue", type: "cold" },
  { color: "indigo" },
  { color: "violet" },
];

export const isPrismaticSpray = (spell: string | undefined) => (spell ?? "").trim().toLowerCase() === PRISMATIC_SPRAY;

// The rays one creature is struck by: one d8, or on an 8 two more, each 8
// rolled again. `d8` rolls one die (a card, in a cast).
export function rollRays(d8: () => number = () => rollExpression("1d8").total): number[] {
  const first = d8();
  if (first !== 8) {
    return [first];
  }
  const rays: number[] = [];
  for (let guard = 0; rays.length < 2 && guard < 40; guard += 1) {
    const next = d8();
    if (next !== 8) {
      rays.push(next);
    }
  }
  return rays;
}

export type PrismaticCast = {
  campaign: Campaign;
  turn: DmTurn;
  caster: CharacterSheet;
  dc: number;
  enemies: EncounterEnemy[];
  characters: CharacterSheet[];
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
};

// The d8 that picks a creature's ray, as a card the table sees.
const rayDie = (input: PrismaticCast, characterId: string, target: string) => () =>
  rollCard(input.campaign, input.turn, characterId, "custom", `Prismatic Spray: the ray that strikes ${target}`, "1d8", null).total;

// A damaging ray's 10d6, a dice card as a weapon's damage is. characterId
// is the PC the roll concerns: the caster on an enemy, the PC a ray hits.
function rayDamage(input: PrismaticCast, characterId: string, color: string, target: string): number {
  const caster: RollAttacker = { kind: "sheet", id: input.caster.id, name: input.caster.name };
  return rollCard(input.campaign, input.turn, characterId, "damage", rollAgainst(`Prismatic Spray (${color})`, target), "10d6", caster).total;
}

// Every creature caught: its save, its rays, what each does. Returns the
// result rows for aoe_damage.
export function castPrismaticSpray(input: PrismaticCast): Array<Record<string, unknown>> {
  const { campaign, turn, caster, dc } = input;
  const encounter = getActiveEncounter(campaign.id);
  const rows: Array<Record<string, unknown>> = [];
  const indigo = spellMechanicsFor({ spell: INDIGO })?.mech.condition;
  for (const stale of input.enemies) {
    const enemy = getEnemy(stale.id) ?? stale;
    if (!encounter || enemy.status !== "alive") {
      continue;
    }
    const save = rollEnemySave(campaign.id, enemy, "dex", dc, { magical: true, record: { turn, detail: `${enemy.displayName}: DEX save against Prismatic Spray` } });
    const rays = rollRays(rayDie(input, caster.id, enemy.displayName));
    const row: Record<string, unknown> = { target: enemy.displayName, save: save.total, success: save.success, rays: rays.map((ray) => RAYS[ray - 1].color) };
    const notes: string[] = [];
    for (const ray of rays) {
      const now = getEnemy(enemy.id);
      if (!now || now.status !== "alive") {
        break;
      }
      const { color, type } = RAYS[ray - 1];
      if (type) {
        const rolled = rayDamage(input, caster.id, color, enemy.displayName);
        const amount = save.success ? Math.floor(rolled / 2) : rolled;
        const applied = applyEnemyDamage(campaign, turn, encounter, now, amount, input.sheets, input.sheetsById, type, { magical: true });
        notes.push(`${color}: ${amount} ${type}`);
        row.health = applied.health;
        if (applied.dead) {
          row.dead = true;
        }
      } else if (!save.success && color === "indigo") {
        const mark = turnEndMark(indigo, { spell: INDIGO, casterId: caster.id }, now.id);
        const landed = layOnEnemy(now.id, [["restrained", { spell: INDIGO, source: caster.id }], ...(mark ? [mark] : [])]);
        notes.push(landed.includes("restrained") ? "indigo: restrained (CON saves at the end of its turns: three failures petrify it)" : "indigo: no effect");
      } else if (!save.success && color === "violet") {
        const landed = layOnEnemy(now.id, [["blinded", { spell: VIOLET, source: caster.id }], [VIOLET_MARK, { spell: VIOLET, source: caster.id }]]);
        notes.push(landed.includes("blinded") ? "violet: blinded (WIS save at the start of the caster's next turn, or it is sent to another plane)" : "violet: no effect");
      } else {
        notes.push(`${color}: resisted`);
      }
    }
    row.effects = notes;
    rows.push(row);
  }
  publishEncounter(campaign.id);
  for (const stale of input.characters) {
    const sheet = getSheetById(stale.id) ?? stale;
    if (sheet.deathSaves?.dead) {
      continue;
    }
    const save = rollCharacterSave(campaign, turn, sheet, "dex", dc, "DEX save against Prismatic Spray", "spell");
    const rays = rollRays(rayDie(input, sheet.id, sheet.name));
    const notes: string[] = [];
    for (const ray of rays) {
      const { color, type } = RAYS[ray - 1];
      if (type) {
        const rolled = rayDamage(input, sheet.id, color, sheet.name);
        // A DEX save for half: Evasion turns it to none or half.
        const amount = saveDamageTaken({ total: rolled, saved: save.success, halfOnSave: true, ability: "dex", sheet }).damage;
        applyDmMutation(campaign, turn.id, "apply_damage", JSON.stringify({ characterId: sheet.id, amount, type, spell: "Prismatic Spray", reason: `Prismatic Spray's ${color} ray` }), input.sheets, input.sheetsById);
        notes.push(`${color}: ${amount} ${type}`);
      } else if (!save.success && (color === "indigo" || color === "violet")) {
        const condition = color === "indigo" ? "restrained" : "blinded";
        const spell = color === "indigo" ? INDIGO : VIOLET;
        handleSetCondition(campaign, turn.id, getSheetById(sheet.id) ?? sheet, { condition }, `Prismatic Spray's ${color} ray`, { spellEffect: { spell, source: caster.id } });
        if (color === "violet") {
          markSheet(campaign, sheet.id, VIOLET_MARK, { spell, source: caster.id });
        }
        notes.push(color === "indigo" ? "indigo: restrained (a character's CON saves at the end of each turn are the DM's to call)" : "violet: blinded (WIS save at the start of the caster's next turn)");
      } else {
        notes.push(`${color}: resisted`);
      }
    }
    rows.push({ target: sheet.name, save: save.total, success: save.success, rays: rays.map((ray) => RAYS[ray - 1].color), effects: notes });
  }
  return rows;
}

function markSheet(campaign: Campaign, sheetId: string, mark: string, meta: ConditionMetaMap[string]) {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return;
  }
  const updated = patchSheet(sheet.id, {
    conditions: sheet.conditions.includes(mark) ? sheet.conditions : [...sheet.conditions, mark],
    conditionMeta: { ...(sheet.conditionMeta as ConditionMetaMap), [mark]: meta },
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}
