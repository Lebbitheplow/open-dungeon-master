// Spells that put a creature out of reach, or out of the fight (SRD 5.1):
//
//   - Blink: "Roll a d20 at the end of each of your turns for the duration
//     of the spell. On a roll of 11 or higher, you vanish from your current
//     plane of existence and appear in the Ethereal Plane ... At the start of
//     your next turn ... you return." The server rolls it as the turn ends
//     and lays "blinked" until the start of the caster's next turn.
//   - Etherealness, Maze, Imprisonment and Blink's vanishing: nothing on the
//     Material Plane can target the creature (the registry's `untargetable`).
//   - Calm Emotions, Fear's flight, Wind Walk, Etherealness: the creature
//     makes no attacks (`noAttacks`); Feeblemind, Maze, Fear's flight: no
//     spells (`noCasting`).
//
// The characters' own acts are guarded by can-act.ts (spellTurnHold); these
// are the refusals the enemy side and the targeting paths meet.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getBattleMapForEncounter, removeTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter, listEnemies, patchEnemyHp, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import {
  conditionBlocksAttacks,
  conditionBlocksCasting,
  conditionUntargetable,
} from "@/lib/srd/condition-effect-queries";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { finishEncounter } from "@/lib/dm/enemy-damage";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const BLINK = "blink";
export const BLINKED = "blinked";

// The refusal an attack by `attacker` at `target` meets from a spell on
// either, or null.
export function spellAttackHold(
  attacker: { name: string; conditions: string[] },
  target: { name: string; conditions: string[] },
): string | null {
  const held = conditionBlocksAttacks(attacker.conditions);
  if (held) {
    return `${attacker.name} is ${held} and makes no attacks while it lasts. It may take another action (a calmed or fleeing creature may Dash).`;
  }
  return outOfReach(target);
}

// The refusal a spell cast at `target` meets when a spell has put it out of
// reach, or null.
export function outOfReach(target: { name: string; conditions: string[] }): string | null {
  const gone = conditionUntargetable(target.conditions);
  return gone
    ? `${target.name} is ${gone}: out of reach of attacks and spells from the Material Plane until it ends. Choose another target.`
    : null;
}

// The refusal a creature's spell meets while a spell stops its casting, or
// the caster is off on another plane, or null.
export function castingHold(caster: { name: string; conditions: string[] }): string | null {
  const held = conditionBlocksCasting(caster.conditions);
  if (held) {
    return `${caster.name} is ${held} and cannot cast spells while it lasts. Nothing was spent.`;
  }
  const away = conditionUntargetable(caster.conditions);
  return away ? `${caster.name} is ${away} and cannot affect creatures on the Material Plane. Nothing was spent.` : null;
}

const holds = (conditions: string[], name: string) => conditions.some((entry) => entry.trim().toLowerCase() === name);

// Blink at the end of each of the caster's turns: a d20, and on 11 or higher
// the caster is "blinked" until the start of their next turn. Returns the
// lines for the table.
export function blinkTurnEnd(campaign: Campaign, combatantIds: string[]): string[] {
  const lines: string[] = [];
  for (const id of combatantIds) {
    const sheet = getSheetById(id);
    if (!sheet || !holds(sheet.conditions, BLINK) || holds(sheet.conditions, BLINKED) || sheet.currentHp <= 0) {
      continue;
    }
    const roll = rollExpression("1d20").total;
    if (roll < 11) {
      lines.push(`${sheet.name}'s Blink: ${roll}, they stay on the Material Plane.`);
      continue;
    }
    const meta: ConditionMetaMap = { ...(sheet.conditionMeta as ConditionMetaMap), [BLINKED]: { spell: "Blink", source: sheet.id, untilTurnOf: sheet.id } };
    const updated = patchSheet(sheet.id, { conditions: [...sheet.conditions, BLINKED], conditionMeta: meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    lines.push(`${sheet.name}'s Blink: ${roll}, they vanish into the Ethereal Plane until the start of their next turn.`);
  }
  return lines;
}

// A creature of one of `types` ("any" for every creature) goes back to its
// home plane or off to another (Divine Word, Prismatic Spray's violet ray) and
// leaves the fight: its row is marked fled, its token taken off the board,
// and a fight with nobody left standing ends. The line, or null for a
// creature of another type.
export function sendHome(
  campaign: Campaign,
  turn: DmTurn,
  enemy: EncounterEnemy,
  types: string[] | "any",
  spell: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): string | null {
  const type = (enemy.stats.type ?? "").toLowerCase();
  if (types !== "any" && !types.some((entry) => type.includes(entry))) {
    return null;
  }
  const encounter = getActiveEncounter(campaign.id);
  patchEnemyHp(enemy.id, enemy.currentHp, "fled");
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (map) {
    removeTokenByRef(map.id, enemy.id);
  }
  if (encounter && !listEnemies(encounter.id).some((entry) => entry.status === "alive")) {
    finishEncounter(campaign, turn, encounter, "enemies_fled", sheets, sheetsById);
  }
  return `${enemy.displayName} is forced back to its home plane by ${spell} and cannot return for 24 hours.`;
}
