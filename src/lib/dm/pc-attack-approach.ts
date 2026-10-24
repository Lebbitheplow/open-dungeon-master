import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import type { Encounter } from "@/lib/db/encounters";
import { footprintForSize } from "@/lib/battlemap/footprint";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { openSquaresBeside } from "@/lib/dm/companion-approach";
import { checkPcAttackRange } from "@/lib/dm/map-tools";
import type { PcAttackArgs } from "@/lib/dm/pc-attack";
import { buildAttackProfile } from "@/lib/dm/pc-attack-profile";
import { walkCharacter } from "@/lib/dm/token-rules";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The move and the end of the turn a player declares around their attack,
// carried on the attack itself, so the turn the table plays most ("I close
// in on the goblin and stab it, then I end my turn") is one pc_attack call
// instead of three. On the skirmish smoke (2026-10-20) gpt-oss-20b and
// Qwen3.6-35B lost turns between the refused swing, the move_token after it
// and the second swing (a token named "A", the four-call budget spent, an
// empty reply after the walk), and left the turns their players had ended
// running, so the next player's word went to the same character again.
//
// approach walks the attacker the way move_token walks a character on their
// own turn (token-rules.ts walkCharacter: speed, prone, fear, the
// opportunity attacks it draws) to the nearest open square beside the
// target from which the swing can follow. Only a melee attack refused for
// reach alone walks (pc-attack.ts asks the plan again with reach set aside,
// so nobody spends their movement on a swing that would be refused anyway:
// Qwen3.6-35B sent a fighter's approach with a monk's bonus strike, walked
// him, and lost his turn to the refusal), and only on the model's word
// that the player declared the move: the board is the player's otherwise
// (pc-attack-plan.ts). Out of reach for the whole turn, they close in as
// far as the movement goes and nothing is attacked, as an enemy's
// enemy_attack walks (enemy-approach.ts).

export type Approach =
  // The walk the swing follows, as move_token reports it.
  | { walked: ToolResult }
  // No swing this turn: why, with the walk toward the target when one was
  // made (an endTurn on the attack still ends the turn then).
  // outOfReach marks the one refusal an endTurn still ends the turn on.
  | { refused: ToolError & { approached?: ToolResult; outOfReach?: true } };

export function approachForAttack(
  campaign: Campaign,
  encounter: Encounter,
  sheet: CharacterSheet,
  args: PcAttackArgs,
  // Why the attack's plan refused it from where they stand.
  refusal: ToolError,
): Approach | null {
  if (!args.approach || !encounter.orderReady) {
    return null;
  }
  // Their own turn only: off it the plan refuses the attack, walk or not.
  const current = encounter.order[encounter.turnIndex];
  if (current?.kind !== "pc" || current.characterId !== sheet.id) {
    return null;
  }
  const found = resolveTargetFoe(campaign.id, encounter, args.targetEnemyId);
  const enemy = found && found.status === "alive" ? found : null;
  const map = getBattleMapForEncounter(encounter.id);
  const me = map ? getTokenByRef(map.id, sheet.id) : null;
  const them = map && enemy ? getTokenByRef(map.id, enemy.id) : null;
  if (!enemy || !map || !me || !them) {
    return null;
  }
  const built = buildAttackProfile(campaign.id, sheet, args, { apart: tilesBetween(encounter.id, sheet.id, enemy.id) });
  if ("error" in built || built.profile.ranged) {
    return null;
  }
  const { profile } = built;
  // A thrown dagger in range, or a blade already in reach, needs no walk.
  const blocked = checkPcAttackRange(encounter.id, sheet.id, enemy.id, {
    ranged: profile.ranged,
    rangeTiles: profile.rangeTiles,
    reachTiles: profile.reachTiles,
    thrown: profile.thrown,
    longRangeTiles: profile.longRangeTiles,
  });
  if (!blocked || blocked.error !== refusal.error) {
    return null;
  }
  const squares = openSquaresBeside(encounter.id, map, me, them, footprintForSize(enemy.stats.size));
  for (const square of squares) {
    const walked = walkCharacter(campaign, encounter, map, sheet, me, square, { whole: true });
    if (!walked.error) {
      return { walked };
    }
  }
  const [nearest] = squares;
  if (!nearest) {
    return { refused: { error: `Every square beside ${enemy.displayName} is taken, so ${sheet.name} cannot close in to strike it. Nothing was attacked.`, refused: "rules" } };
  }
  const walked = walkCharacter(campaign, encounter, map, sheet, me, nearest);
  if (walked.error) {
    return { refused: toolError(walked) };
  }
  return {
    refused: {
      error: `${sheet.name} closes in on ${enemy.displayName} as far as their movement goes and is still out of reach, so nothing was attacked this turn.`,
      refused: "rules",
      approached: walkOf(walked),
      outOfReach: true,
    },
  };
}

// What the walk did, as the attack's result carries it.
function walkOf(walked: ToolResult): ToolResult {
  return Object.fromEntries(Object.entries(walked).filter(([key]) => key !== "ok" && key !== "name"));
}

// The walk folded into the attack's result, beside what it says itself.
export function withApproach(result: ToolResult, walked: ToolResult): ToolResult {
  return { ...result, approached: walkOf(walked) };
}

// The character whose turn the attack's call says ends with it (endTurn),
// or null.
export function endTurnAsked(rawArguments: string): string | null {
  try {
    const args = JSON.parse(rawArguments || "{}") as { endTurn?: unknown; characterId?: unknown };
    const asked = args.endTurn === true || args.endTurn === "true";
    return asked && typeof args.characterId === "string" ? args.characterId : null;
  } catch {
    return null;
  }
}
