// An enemy dragging the character it grapples (SRD 5.1, Grappling: Moving a
// Grappled Creature), for move_token with drag: the walk costs double unless
// every creature held is two sizes smaller, and each one is set down beside
// the enemy where it stops (src/lib/dm/drag.ts). The player's side is the
// battle-map move route's `drag`, and move_token walking a character on their
// own turn (token-rules.ts walkCharacter).

import type { BattleMap } from "@/lib/db/battle-maps";
import { listSheets } from "@/lib/db/sheets";
import type { EncounterEnemy } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { sizeForRace } from "@/lib/srd";
import { occupiedTiles } from "@/lib/battlemap/view";
import type { Footprint } from "@/lib/battlemap/footprint";
import type { BattleToken, XY } from "@/lib/battlemap/types";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { dragCostFactor, dragPlacements, grappledBy } from "@/lib/dm/drag";

export type EnemyDrag = { factor: 1 | 2; held: BattleToken[] };

// The characters this enemy holds on the board and what dragging them costs,
// or the refusal when it holds nobody.
export function enemyDrag(campaignId: string, enemy: EncounterEnemy, tokens: BattleToken[]): EnemyDrag | { error: string } {
  const sheets = listSheets(campaignId).filter((sheet) =>
    grappledBy({ id: sheet.id, conditions: sheet.conditions, conditionMeta: sheet.conditionMeta as ConditionMetaMap }, enemy.id),
  );
  const held = sheets
    .map((sheet) => tokens.find((token) => token.refId === sheet.id))
    .filter((token): token is BattleToken => Boolean(token));
  if (!held.length) {
    return { error: `${enemy.displayName} is not grappling anyone on the board, so there is nothing to drag. Move it without drag.` };
  }
  const factor = dragCostFactor(
    enemy.stats.size,
    sheets.map((sheet) => ({ refId: sheet.id, name: sheet.name, size: sizeForRace(sheet.race) })),
  );
  return { factor, held };
}

// The enemies this character holds on the board and what dragging them
// costs, as the move route prices it, or the refusal when they hold nobody.
export function characterDrag(sheet: CharacterSheet, enemies: EncounterEnemy[], tokens: BattleToken[]): EnemyDrag | { error: string } {
  const gripped = enemies.filter((enemy) => enemy.status === "alive" && grappledBy(enemy, sheet.id));
  const held = gripped
    .map((enemy) => tokens.find((token) => token.refId === enemy.id))
    .filter((token): token is BattleToken => Boolean(token));
  if (!held.length) {
    return { error: `${sheet.name} is not grappling anyone on the board, so there is nothing to drag. Move them without drag.` };
  }
  const factor = dragCostFactor(
    sizeForRace(sheet.race),
    gripped.map((enemy) => ({ refId: enemy.id, name: enemy.displayName, size: enemy.stats.size })),
  );
  return { factor, held };
}

// Where the held creatures go once the grappler lands; null when there is no
// room beside it.
export function dragLandings(input: {
  map: BattleMap;
  tokens: BattleToken[];
  mover: BattleToken;
  landing: XY;
  walked: XY[];
  held: BattleToken[];
  footprintOf: (token: BattleToken) => Footprint;
}): Array<{ token: BattleToken; at: XY }> | null {
  const heldIds = new Set(input.held.map((token) => token.id));
  const landed = input.tokens
    .filter((token) => !heldIds.has(token.id))
    .map((token) => (token.id === input.mover.id ? { ...token, x: input.landing.x, y: input.landing.y } : token));
  return dragPlacements({
    terrain: input.map.terrain,
    width: input.map.width,
    height: input.map.height,
    occupied: occupiedTiles(input.map, landed, null, input.footprintOf),
    landing: input.landing,
    walked: input.walked,
    dragged: input.held.map((token) => ({ token, footprint: input.footprintOf(token) })),
  });
}
