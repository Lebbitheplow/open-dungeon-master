// A character fighting on the other side casting at a party member through
// cast_at_player (issue 503). cast_at_player names the caster in
// casterEnemyId like any foe; when that is a character, the cast is the
// caster's, from their sheet (their slot, their DC, their concentration), and
// the target's save and harm are the target's, which is what cast_at_enemy
// resolves for a character fighting the party (src/lib/dm/sheet-foe.ts). One
// engine for both directions.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { handleCastAtEnemy } from "@/lib/dm/cast-at-enemy";
import { resolveCombatant } from "@/lib/dm/combatant";
import type { ToolResult } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// What of a cast_at_player call carries over to the caster's own cast.
export type SheetCasterArgs = {
  casterEnemyId?: string;
  spell?: string;
  saveAbility: string;
  damage?: string;
  damageType?: string;
  halfOnSave?: boolean;
  condition?: string;
  rounds?: number;
  reason?: string;
};

// The cast from the caster's sheet at `targetId`, or null when
// casterEnemyId names no character (an enemy row, or nobody), so the call
// goes on as an enemy's.
export function castFromFoeSheet(
  campaign: Campaign,
  turn: DmTurn,
  targetId: string,
  args: SheetCasterArgs,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult | null {
  const caster = args.casterEnemyId ? resolveCombatant(campaign.id, getActiveEncounter(campaign.id), args.casterEnemyId) : null;
  if (caster?.kind !== "sheet") {
    return null;
  }
  if (!args.spell) {
    return { error: `${caster.name} is a character: name the spell they cast in spell.`, retry: true };
  }
  return handleCastAtEnemy(
    campaign,
    turn,
    JSON.stringify({
      characterId: caster.id,
      targetEnemyId: targetId,
      spell: args.spell,
      saveAbility: args.saveAbility,
      ...(args.damage ? { damage: args.damage } : {}),
      ...(args.damageType ? { damageType: args.damageType } : {}),
      ...(args.halfOnSave !== undefined ? { halfOnSave: args.halfOnSave } : {}),
      ...(args.condition ? { condition: args.condition } : {}),
      ...(args.rounds ? { rounds: args.rounds } : {}),
      ...(args.reason ? { reason: args.reason } : {}),
    }),
    sheets,
    sheetsById,
  );
}
