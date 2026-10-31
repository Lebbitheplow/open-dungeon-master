// Spells that put a creature out of reach, or out of the fight (SRD 5.1):
//
//   - Blink: "Roll a d20 at the end of each of your turns for the duration
//     of the spell. On a roll of 11 or higher, you vanish from your current
//     plane of existence and appear in the Ethereal Plane ... At the start of
//     your next turn ... you return." The server rolls it as the turn ends
//     and lays "blinked" until the start of the caster's next turn.
//   - Etherealness, Maze, Imprisonment and Blink's vanishing: nothing on the
//     Material Plane can target the creature (the registry's `untargetable`).
//   - Calm Emotions, Fear's flight, Turn Undead, Wind Walk, Etherealness: the
//     creature makes no attacks (`noAttacks`); Feeblemind, Maze, Fear's
//     flight, Turn Undead: no spells (`noCasting`).
//
// The characters' own acts are guarded by can-act.ts (spellTurnHold); these
// are the refusals the enemy side and the targeting paths meet.

import type { AttackStop } from "@/lib/dm/turn-lines-logic";
import { rollCard } from "@/lib/dm/roll-card";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getBattleMapForEncounter, removeTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter, listEnemies, patchEnemyHp, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import {
  conditionBlocksAttacks,
  conditionBlocksCasting,
  conditionUntargetable,
} from "@/lib/srd/condition-effect-queries";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { finishEncounter } from "@/lib/dm/enemy-damage";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";

export const BLINK = "blink";
export const BLINKED = "blinked";

// The refusal an attack by `attacker` meets from what holds it (Calm
// Emotions, Fear's flight, Turn Undead), whoever it aims at, or null. The
// game saying no, and the way it can still act: the Dash it was pointed at
// did not exist for an enemy before issue #621.
// Tagged with what holds it (turn-lines-logic.ts), so a turn the server plays
// says so at the table instead of passing in silence (issue #666).
export function attackHold(attacker: { name: string; conditions: string[] }): (ToolError & { stop: AttackStop; stopBy: string }) | null {
  const held = conditionBlocksAttacks(attacker.conditions);
  return held
    ? { error: `${attacker.name} is ${held} and makes no attacks while it lasts. It can take another action: take_action with its enemyId (dash, disengage or dodge), then move_token.`, refused: "rules", stop: "calmed", stopBy: held }
    : null;
}

// The refusal an attack by `attacker` at `target` meets from a spell on
// either, or null.
export function spellAttackHold(
  attacker: { name: string; conditions: string[] },
  target: { name: string; conditions: string[] },
): (ToolError & { stop: AttackStop }) | null {
  return attackHold(attacker) ?? outOfReach(target);
}

// The refusal a spell cast at `target` meets when a spell has put it out of
// reach, or null. Another target may still be attacked ("target").
export function outOfReach(target: { name: string; conditions: string[] }): (ToolError & { stop: AttackStop }) | null {
  const gone = conditionUntargetable(target.conditions);
  return gone
    ? { error: `${target.name} is ${gone}: out of reach of attacks and spells from the Material Plane until it ends. Choose another target.`, refused: "rules", stop: "target" }
    : null;
}

// The refusal a creature's spell meets while a spell stops its casting, or
// the caster is off on another plane, or null.
export function castingHold(caster: { name: string; conditions: string[] }): ToolError | null {
  const held = conditionBlocksCasting(caster.conditions);
  if (held) {
    return { error: `${caster.name} is ${held} and cannot cast spells while it lasts. Nothing was spent.`, refused: "rules" };
  }
  const away = conditionUntargetable(caster.conditions);
  return away ? { error: `${caster.name} is ${away} and cannot affect creatures on the Material Plane. Nothing was spent.`, refused: "rules" } : null;
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
    const roll = rollCard(campaign, null, sheet.id, "custom", "Blink (11 or higher: to the Ethereal Plane)", "1d20", null).total;
    if (roll < 11) {
      lines.push(`${sheet.name}'s Blink: ${roll}, they stay on the Material Plane.`);
      continue;
    }
    const meta: ConditionMetaMap = { ...(sheet.conditionMeta as ConditionMetaMap), [BLINKED]: { spell: "Blink", source: sheet.id, untilTurnOf: sheet.id } };
    // Audited: the turn that moved the pointer takes it back (issue #622).
    patchSheetAudited(campaign.id, sheet.id, { conditions: [...sheet.conditions, BLINKED], conditionMeta: meta }, {
      kind: "set_condition",
      reason: `Blink: ${roll}`,
      delta: { condition: BLINKED },
    });
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
