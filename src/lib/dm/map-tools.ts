import { carriedLight, lightPlacement } from "@/lib/dm/light-timers";
import { getClock } from "@/lib/db/clock";
import type { Campaign } from "@/lib/db/campaigns";
import {
  getActiveBoard,
  getActiveEncounter,
  listEnemies,
  type Encounter,
  type EncounterEnemy,
} from "@/lib/db/encounters";
import {
  createBattleMap,
  getBattleMapForEncounter,
  getTokenByRef,
  listTokens,
  moveToken,
  placeToken,
  placeTokens,
  resetTurnBudgets,
  setTokenMovement,
  type BattleMap,
} from "@/lib/db/battle-maps";
import { planTeleportFx } from "@/lib/battlemap/fx-plan";
import { publishFx } from "@/lib/dm/fx";
import { generateBattleMap, fnv1a } from "@/lib/battlemap/generate";
import { findPath, speedToTiles, squeezedAt, walkPathWithBudget } from "@/lib/battlemap/movement";
import { coverBetween, hasLineOfSight } from "@/lib/battlemap/los";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import {
  blocksMove,
  chebyshev,
  tileAt,
  tileIndex,
  TILE_FEET,
  TOKEN_MOVEMENTS,
  type BattleToken,
} from "@/lib/battlemap/types";
import { getCurrentLocation } from "@/lib/db/locations";
import { getSheetById } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { resolvePcOpportunityAttacks } from "@/lib/dm/opportunity";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { isIncapacitated } from "@/lib/dm/condition-logic";
import { canEnemyAct } from "@/lib/dm/can-act";
import { awayFromFear, enemyMoveTraits, fearSourceAt, standUpIfProne } from "@/lib/dm/enemy-approach";
import { enemySpeedTiles } from "@/lib/dm/enemy-speed";
import { enemyTurnRefusal } from "@/lib/dm/enemy-turn-order";
import { declaredThisTurn } from "@/lib/dm/player-word";
import { distancesFrom, payForTeleport, spendEnemyDisengage, stillAt, teleportRangeFeet, walkCharacter } from "@/lib/dm/token-rules";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { z } from "zod";
import { zonesAfterMove } from "@/lib/dm/zone-triggers";
import { zoneCoverBetween } from "@/lib/dm/zone-rules";
import { dragLandings, enemyDrag } from "@/lib/dm/drag-move";
import { flightOf, markSqueezing } from "@/lib/dm/token-state";

export { landTheFlightless } from "@/lib/dm/token-state";

// Battle-map lifecycle and the move_token DM tool. Kept separate from
// encounter-tools.ts to hold both files under the size limit; this module
// must not import encounter-tools (the import points the other way).

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

// Contentless ping: with per-character fog even token coordinates are
// secret, so clients re-fetch their own filtered projection.
export function publishBattleMapUpdate(campaignId: string) {
  publishEphemeral(campaignId, "battle_map_updated", {});
}

// A carried light matters only in dim/dark maps; inferred from equipment.
export function carriedLightRadius(sheet: CharacterSheet): number {
  return carriedLight(sheet).radius;
}

// The token fields for that light, lit as the party steps onto the board.
export function carriedLightFields(campaignId: string, sheet: CharacterSheet) {
  return lightPlacement(carriedLight(sheet), getClock(campaignId).instant);
}

export function createBattleMapForEncounter(
  campaign: Campaign,
  encounter: Encounter,
  enemies: EncounterEnemy[],
  sheets: CharacterSheet[],
  battlefield: string | undefined,
): BattleMap | null {
  const location = getCurrentLocation(campaign.id);
  const generated = generateBattleMap({
    seed: fnv1a(encounter.id),
    genre: campaign.gameSettings.genre,
    locationName: location?.name,
    layoutDescription: location?.layoutDescription,
    hint: battlefield,
    pcCount: sheets.length,
    enemyCount: enemies.length,
  });
  const map = createBattleMap({
    encounterId: encounter.id,
    campaignId: campaign.id,
    width: generated.width,
    height: generated.height,
    terrain: generated.terrain,
    ambient: generated.ambient,
    theme: generated.theme,
    lights: generated.lights,
    seed: fnv1a(encounter.id),
  });
  placeTokens(map.id, campaign.id, [
    ...sheets.map((sheet, index) => ({
      kind: "pc" as const,
      refId: sheet.id,
      name: sheet.name,
      spot: generated.pcSpawns[index] ?? generated.pcSpawns[0],
      ...carriedLightFields(campaign.id, sheet),
    })),
    ...enemies.map((enemy, index) => ({
      kind: "enemy" as const,
      refId: enemy.id,
      name: enemy.displayName,
      spot: generated.enemySpawns[index] ?? generated.enemySpawns[0],
    })),
  ]);
  publishBattleMapUpdate(campaign.id);
  return map;
}

// ---- teleport_token and set_movement tools ----

export const teleportTokenTool: ToolDef = {
  type: "function",
  function: {
    name: "teleport_token",
    description:
      "Move a combatant to a tile WITHOUT walking: Misty Step, Dimension Door, Thunder Step, a trap door, a portal. It is the spell or the hazard that does it: pass spell with casterId for a character's spell (the server casts it, spending the slot and the casting time, and refuses a jump past the spell's range) or with casterEnemyId for a spell or ability on the enemy's block, or cause 'hazard' for a trap door or a portal. A teleport with none of these is refused. The tile must be open floor with nobody on it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tokenName: {
          type: "string",
          description: "Character or enemy name or id, exactly as shown on the battle map.",
        },
        x: { type: "integer", description: "Destination column." },
        y: { type: "integer", description: "Destination row." },
        spell: { type: "string", description: "The teleport spell or ability, e.g. Misty Step." },
        casterId: { type: "string", description: "The character casting it (characterId)." },
        casterEnemyId: { type: "string", description: "The enemy using it (enemyId)." },
        cause: {
          type: "string",
          enum: ["hazard"],
          description: "A trap door, a portal or another hazard moved them; no spell.",
        },
        rangeFeet: {
          type: "integer",
          minimum: 5,
          maximum: 1000,
          description: "The range, for a spell the server does not know.",
        },
        reason: { type: "string" },
      },
      required: ["tokenName", "x", "y"],
    },
  },
};

export const setMovementTool: ToolDef = {
  type: "function",
  function: {
    name: "set_movement",
    description:
      "Record that a combatant is now flying, burrowing or back on foot (Fly spell, wings, Wild Shape into a bird, a burrowing worm). Only a creature with a flying speed takes to the air (the Fly spell cast with cast_buff, wings, a flying form, a stat block's fly); the server refuses the rest. A flying character moves at their flying speed (Fly: 60 feet), and one whose flight ends comes down prone. Flying creatures pass over ground obstacles and are missed by tremorsense; the board draws them lifted.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tokenName: { type: "string", description: "Character or enemy name or id." },
        movement: { type: "string", enum: ["walk", "fly", "burrow"] },
        reason: { type: "string" },
      },
      required: ["tokenName", "movement"],
    },
  },
};

const teleportArgsSchema = z.object({
  tokenName: z.string(),
  x: z.coerce.number().int(),
  y: z.coerce.number().int(),
  rangeFeet: z.coerce.number().int().optional(),
  spell: z.string().max(80).optional(),
  casterId: z.string().max(80).optional(),
  casterEnemyId: z.string().max(80).optional(),
  cause: z.enum(["hazard"]).optional(),
  reason: z.string().optional(),
});

const movementArgsSchema = z.object({
  tokenName: z.string(),
  movement: z.enum(TOKEN_MOVEMENTS),
  reason: z.string().optional(),
});

// Any combatant on the board by name or id, PC or enemy, alive or not:
// a teleport works on whoever is asked for, unlike a walk.
function resolveAnyToken(
  map: BattleMap,
  encounterId: string,
  ref: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): BattleToken | null {
  const trimmed = ref.trim();
  const sheet = resolveSheetRef(trimmed, sheets, sheetsById);
  if (sheet) {
    return getTokenByRef(map.id, sheet.id);
  }
  const enemies = listEnemies(encounterId);
  const enemy =
    enemies.find((entry) => entry.id === trimmed) ??
    enemies.find((entry) => entry.displayName.toLowerCase() === trimmed.toLowerCase()) ??
    enemies.find((entry) => entry.displayName.toLowerCase().includes(trimmed.toLowerCase()));
  if (enemy) {
    return getTokenByRef(map.id, enemy.id);
  }
  // The DM's own pieces, by name.
  return listTokens(map.id).find((token) => token.name.toLowerCase() === trimmed.toLowerCase()) ?? null;
}

export function handleTeleportToken(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // The DM turn behind the call: the AI's teleport is a spell cast and paid
  // for (token-rules.ts); a person at the console moves pieces freely.
  turn?: DmTurn,
): Record<string, unknown> {
  const board = getActiveBoard(campaign.id);
  if (!board) {
    return { error: "There is no board on the table." };
  }
  const map = getBattleMapForEncounter(board.id);
  if (!map) {
    return { error: "This board has no battle map." };
  }
  let args: z.infer<typeof teleportArgsSchema>;
  try {
    args = teleportArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: teleport_token needs tokenName, x, and y." };
  }
  const token = resolveAnyToken(map, board.id, args.tokenName, sheets, sheetsById);
  if (!token) {
    return { error: `Unknown combatant "${args.tokenName}"; use a name from the battle map.` };
  }
  if (args.x < 0 || args.y < 0 || args.x >= map.width || args.y >= map.height) {
    return { error: `(${args.x},${args.y}) is outside the ${map.width}x${map.height} map.` };
  }
  if (blocksMove(tileAt(map.terrain, map.width, args.x, args.y))) {
    return { error: `(${args.x},${args.y}) is a wall; a teleport needs open floor.` };
  }
  const tokens = listTokens(map.id);
  const occupied = occupiedTiles(map, tokens, token);
  if (occupied.has(tileIndex(map.width, args.x, args.y))) {
    return { error: `(${args.x},${args.y}) is occupied by another combatant.` };
  }
  const distanceFeet = Math.max(Math.abs(args.x - token.x), Math.abs(args.y - token.y)) * TILE_FEET;
  const rangeFeet = (args.spell ? teleportRangeFeet(args.spell) : null) ?? args.rangeFeet;
  if (rangeFeet !== undefined && rangeFeet !== null && distanceFeet > rangeFeet) {
    return {
      error: `(${args.x},${args.y}) is ${distanceFeet} ft away, past the ${rangeFeet} ft range. Pick a tile within range.`,
    };
  }
  // Every refusal above spends nothing; the spell is cast (or the enemy's
  // block checked) only now.
  if (turn?.actor === "ai") {
    const refused = payForTeleport(
      campaign,
      turn,
      getActiveEncounter(campaign.id),
      token,
      args,
      sheets,
      sheetsById,
    );
    if (refused) {
      return { error: refused };
    }
  }
  const from = { x: token.x, y: token.y };
  placeToken(token.id, args.x, args.y);
  publishBattleMapUpdate(campaign.id);
  publishFx(campaign.id, planTeleportFx({ from, to: { x: args.x, y: args.y }, tokenId: token.id }));
  return {
    ok: true,
    name: token.name,
    from: `(${from.x},${from.y})`,
    at: `(${args.x},${args.y})`,
    distanceFeet,
    note: "No movement was spent; the board already shows the new position.",
  };
}

export function handleSetMovement(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // The AI takes to the air only what has a flying speed; a person at the
  // console keeps a free hand (a turn left out is theirs).
  turn?: Pick<DmTurn, "actor">,
): Record<string, unknown> {
  const board = getActiveBoard(campaign.id);
  if (!board) {
    return { error: "There is no board on the table." };
  }
  const map = getBattleMapForEncounter(board.id);
  if (!map) {
    return { error: "This board has no battle map." };
  }
  let args: z.infer<typeof movementArgsSchema>;
  try {
    args = movementArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: set_movement needs tokenName and movement (walk, fly or burrow)." };
  }
  const token = resolveAnyToken(map, board.id, args.tokenName, sheets, sheetsById);
  if (!token) {
    return { error: `Unknown combatant "${args.tokenName}"; use a name from the battle map.` };
  }
  if (token.movement === args.movement) {
    return { ok: true, name: token.name, movement: args.movement, note: "Already so." };
  }
  if (turn?.actor === "ai" && args.movement === "fly" && flightOf(board.id, token) === null) {
    return {
      error: `${token.name} has no flying speed, so they cannot take to the air: a creature flies with a flying speed (the Fly spell, wings, a flying Wild Shape form, a stat block's fly). Nothing changed.`,
    };
  }
  setTokenMovement(token.id, args.movement);
  publishBattleMapUpdate(campaign.id);
  return {
    ok: true,
    name: token.name,
    movement: args.movement,
    note:
      args.movement === "fly"
        ? `${token.name} is airborne: ground hazards and tremorsense no longer apply.`
        : args.movement === "burrow"
          ? `${token.name} is underground: unseen from above unless it surfaces.`
          : `${token.name} is back on foot.`,
  };
}

// ---- move_token tool ----

export const moveTokenTool: ToolDef = {
  type: "function",
  function: {
    name: "move_token",
    description:
      "Move a combatant on the battle map. A walk (no forced): an enemy taking its movement, or a character on their own turn, either an AI companion or a player character walking the move their player just declared; it spends their speed, stands them from prone for what standing costs, and draws opportunity attacks. A forced move (forced:true): a character pushed, pulled, or carried. The server enforces walls, occupancy, speed, and that a frightened creature never walks closer to what it fears; moves clamp to the farthest legal tile toward the target. A walking enemy passes through its allies' spaces and a character's two sizes apart at double cost (never stopping in one), and a Large or bigger one squeezes through a gap one size too small at double cost and is squeezing there (attacks against it have advantage).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tokenName: {
          type: "string",
          description:
            "Enemy name or enemyId, or character name or characterId, exactly as shown on the battle map in GAME STATE.",
        },
        x: { type: "integer", description: "Destination column." },
        y: { type: "integer", description: "Destination row." },
        forced: {
          type: "boolean",
          description: "True only when a character is moved against their will.",
        },
        disengage: {
          type: "boolean",
          description:
            "An enemy Disengages before it walks, so leaving reach draws no opportunity attack: a bonus action for a creature with Nimble Escape (once a round), its action for anyone else.",
        },
        drag: {
          type: "boolean",
          description:
            "An enemy drags the character it grapples along: its speed is halved (unless the character is two sizes smaller) and the server sets the character down beside it, so the grapple holds. Without drag, walking out of reach lets go.",
        },
        reason: { type: "string" },
      },
      required: ["tokenName", "x", "y"],
    },
  },
};

const moveArgsSchema = z.object({
  tokenName: z.string(),
  x: z.coerce.number().int(),
  y: z.coerce.number().int(),
  forced: z.coerce.boolean().optional(),
  disengage: z.coerce.boolean().optional(),
  drag: z.boolean().optional(),
  reason: z.string().optional(),
});

function resolveMoveTarget(
  map: BattleMap,
  encounterId: string,
  ref: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { token: BattleToken; kind: "pc" | "enemy"; speedTiles: number; enemy?: EncounterEnemy } | null {
  const trimmed = ref.trim();
  const sheet = resolveSheetRef(trimmed, sheets, sheetsById);
  if (sheet) {
    const token = getTokenByRef(map.id, sheet.id);
    return token ? { token, kind: "pc", speedTiles: speedToTiles(sheet.speed) } : null;
  }
  const enemies = listEnemies(encounterId);
  const enemy =
    enemies.find((entry) => entry.id === trimmed) ??
    enemies.find((entry) => entry.displayName.toLowerCase() === trimmed.toLowerCase()) ??
    enemies.find((entry) => entry.displayName.toLowerCase().includes(trimmed.toLowerCase()));
  if (!enemy || enemy.status !== "alive") {
    return null;
  }
  const token = getTokenByRef(map.id, enemy.id);
  // Grappled/restrained/stunned... = speed 0; the budget clamp refuses the
  // move with the standard "no movement left" error.
  return token ? { token, kind: "enemy", speedTiles: enemySpeedTiles(enemy), enemy } : null;
}

// The squares of a path up to and including the one landed on.
function walkedPart(path: Array<{ x: number; y: number }>, landing: { x: number; y: number }) {
  const at = path.findIndex((step) => step.x === landing.x && step.y === landing.y);
  return at >= 0 ? path.slice(0, at + 1) : path;
}

export function handleMoveToken(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  turn: Pick<DmTurn, "id" | "actor">,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return { error: "This encounter has no battle map." };
  }
  let args: z.infer<typeof moveArgsSchema>;
  try {
    args = moveArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: move_token needs tokenName, x, and y." };
  }
  const resolved = resolveMoveTarget(map, encounter.id, args.tokenName, sheets, sheetsById);
  if (!resolved) {
    return { error: `Unknown combatant "${args.tokenName}"; use a name from the battle map.` };
  }
  if (resolved.kind === "pc" && !args.forced) {
    // An AI companion walks on its own turn as a player walks from the
    // board: its speed, standing from prone, fear, opportunity attacks. So
    // does a character whose player just typed the move on their own turn.
    const walker = resolveSheetRef(args.tokenName, sheets, sheetsById);
    const fresh = walker ? (getSheetById(walker.id) ?? walker) : null;
    const current = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;
    const declared = fresh && turn.actor === "ai" && declaredThisTurn(campaign.id, fresh.id);
    if (fresh && (fresh.isCompanion || declared) && current?.kind === "pc" && current.characterId === fresh.id) {
      return walkCharacter(campaign, encounter, map, fresh, resolved.token, { x: args.x, y: args.y }, { drag: args.drag });
    }
    return {
      error: fresh?.isCompanion
        ? `${resolved.token.name} walks on their own turn only; pass forced:true when something pushes, drags, or carries them.`
        : `${resolved.token.name} is a player character; players move their own tokens, and move_token walks one only on their own turn, for the move their player just declared. Pass forced:true only when something pushes, drags, or carries them.`,
    };
  }
  // On their own turn the player moves from the board; a "forced" move here
  // is the model walking a character for them (issue 17: a token that moved
  // with no input). Pushes and drags happen on somebody else's turn.
  if (resolved.kind === "pc" && args.forced && encounter.orderReady) {
    const current = encounter.order[encounter.turnIndex];
    if (current?.kind === "pc" && current.characterId === resolved.token.refId) {
      return {
        error: `It is ${resolved.token.name}'s own turn; they move their own token from the board (a companion walks with move_token and no forced). Forced movement is for a push, drag or carry on someone else's turn.`,
      };
    }
  }
  // An enemy walking is an enemy acting: a surprised one stands where it is
  // through round 1. A push or a drag moves whoever it moves.
  if (resolved.kind === "enemy" && resolved.enemy && !args.forced) {
    const allowed = canEnemyAct({ enemy: resolved.enemy, encounter, kind: "reaction" });
    if (!allowed.ok && allowed.reason === "surprised") {
      return { error: allowed.error };
    }
    // Movement belongs to its turn, and every turn now brings its own
    // (advancePointer): a walk taken before its turn would be given back when
    // its turn starts. A legendary creature may still move on a legendary
    // action.
    const early = encounter.legendary.pools[resolved.enemy.id] ? null : enemyTurnRefusal(encounter, resolved.enemy, turn);
    if (early) {
      return { error: early };
    }
  }
  if (args.x < 0 || args.y < 0 || args.x >= map.width || args.y >= map.height) {
    return { error: `(${args.x},${args.y}) is outside the ${map.width}x${map.height} map.` };
  }

  const tokens = listTokens(map.id);
  // Large creatures cover their whole footprint, so an ogre neither walks
  // through a one-tile gap nor stops where its second row would overlap.
  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const footprints = footprintLookup(enemiesById);
  const occupied = occupiedTiles(map, tokens, resolved.token, footprints);
  const moverFootprint = footprints(resolved.token);
  if (occupied.has(tileIndex(map.width, args.x, args.y))) {
    return { error: `(${args.x},${args.y}) is occupied by another combatant.` };
  }
  // An enemy walking on its own passes its allies and squeezes where it
  // must (enemy-approach.ts enemyMoveTraits); a forced move does neither.
  const traits =
    resolved.kind === "enemy" && !args.forced
      ? enemyMoveTraits(map.width, tokens, resolved.token, encounter.id)
      : false;
  const path = findPath(
    map.terrain,
    map.width,
    map.height,
    occupied,
    resolved.token,
    { x: args.x, y: args.y },
    moverFootprint,
    resolved.token.movement === "fly",
    traits,
  );
  if (!path) {
    return {
      error:
        moverFootprint > 1
          ? `No path to (${args.x},${args.y}) for a creature ${moverFootprint} squares wide; walls or others block the way.`
          : `No path to (${args.x},${args.y}); walls block the way.`,
    };
  }

  // Forced movement ignores speed (the force decides the distance); normal
  // enemy movement clamps to the turn's remaining budget along the path.
  let landing = { x: args.x, y: args.y };
  let spent = 0;
  let clamped = false;
  // Dragging the character it grapples halves its speed (drag-move.ts).
  const drag = args.drag && !args.forced && resolved.enemy ? enemyDrag(campaign.id, resolved.enemy, tokens) : null;
  if (drag && "error" in drag) {
    return { error: drag.error };
  }
  if (resolved.kind === "enemy") {
    // Walking on its own: a prone creature stands first for half its speed,
    // and a frightened one never steps closer to what it fears.
    let standCost = 0;
    let steps = path;
    if (!args.forced && resolved.enemy) {
      const before = getTokenByRef(map.id, resolved.enemy.id)?.movedThisRound ?? 0;
      standUpIfProne(encounter.id, resolved.enemy);
      standCost = (getTokenByRef(map.id, resolved.enemy.id)?.movedThisRound ?? before) - before;
      steps = awayFromFear(
        resolved.token,
        path,
        fearSourceAt(map.id, resolved.enemy.conditions, resolved.enemy.conditionMeta as Record<string, { source?: string }>),
      );
    }
    const budget = Math.floor(Math.max(0, resolved.speedTiles - resolved.token.movedThisRound - standCost) / (drag?.factor ?? 1));
    const walk = walkPathWithBudget(map.terrain, map.width, steps, budget, traits, resolved.token);
    if (!walk.at) {
      return {
        error: `${resolved.token.name} has no movement left this turn (speed ${resolved.speedTiles * 5} ft)${steps.length < path.length ? ", and it will not move closer to what it fears" : ""}.${stillAt(tokens, resolved.token)}`,
      };
    }
    landing = walk.at;
    spent = walk.spent * (drag?.factor ?? 1);
    clamped = !walk.reachedEnd;
  }
  const origin = { x: resolved.token.x, y: resolved.token.y };
  const carried = drag ? dragLandings({ map, tokens, mover: resolved.token, landing, walked: [origin, ...walkedPart(path, landing)], held: drag.held, footprintOf: footprints }) : [];
  if (!carried) {
    return { error: `There is no room beside (${landing.x},${landing.y}) to set down the character ${resolved.token.name} drags. Choose another square.` };
  }
  // Disengage first, paid for (token-rules.ts): then leaving reach draws
  // nothing.
  let disengaged: string | null = null;
  let closesOwedTurn = false;
  if (args.disengage && resolved.kind === "enemy" && resolved.enemy && !args.forced) {
    const paid = spendEnemyDisengage(campaign.id, resolved.enemy);
    if ("error" in paid) {
      return { error: paid.error };
    }
    disengaged = paid.how;
    closesOwedTurn = Boolean(paid.closesOwedTurn);
  }
  moveToken(
    resolved.token.id,
    landing.x,
    landing.y,
    resolved.kind === "enemy"
      ? (getTokenByRef(map.id, resolved.token.refId)?.movedThisRound ?? resolved.token.movedThisRound) + spent
      : resolved.token.movedThisRound,
  );
  for (const entry of carried) {
    moveToken(entry.token.id, entry.at.x, entry.at.y, entry.token.movedThisRound);
  }
  // The Disengage and this walk were the turn it was owed; its own turn
  // follows on fresh movement (token-rules.ts spendEnemyDisengage).
  if (closesOwedTurn) {
    resetTurnBudgets(map.id, [resolved.token.refId]);
  }
  publishBattleMapUpdate(campaign.id);
  // Moving two creatures apart ends a grapple between them (src/lib/dm/grapple.ts).
  releaseGrapplesOutOfReach(campaign);
  // A large creature that ended its move where only one size smaller fits is
  // squeezing (SRD 5.1); one that has room again is not.
  if (resolved.kind === "enemy" && resolved.enemy) {
    markSqueezing(campaign.id, resolved.enemy.id, squeezedAt(map.terrain, map.width, map.height, occupied, landing, moverFootprint));
  }

  // An enemy breaking away from a character eats their opportunity attack,
  // exactly as the reverse does when a player walks off. Forced movement
  // (a shove, a gust of wind) provokes nothing.
  const opportunity =
    resolved.kind === "enemy" && !args.forced && !disengaged
      ? resolvePcOpportunityAttacks(
          campaign,
          resolved.token.refId,
          origin,
          landing,
          walkedPart(path, landing),
        )
      : [];
  // The spell areas walked (or pushed) into: their saves and damage (zone-triggers.ts).
  const zoneEffects = zonesAfterMove(campaign, encounter.id, resolved.token, origin, walkedPart(path, landing));
  return {
    ok: true,
    name: resolved.token.name,
    at: `(${landing.x},${landing.y})`,
    ...distancesFrom(tokens, resolved.token, landing),
    ...(zoneEffects.length ? { zoneEffects } : {}),
    ...(opportunity.length
      ? {
          opportunityAttacks: opportunity,
          opportunityNote:
            "The server already rolled and applied these; narrate them, and do not call pc_attack for them.",
        }
      : {}),
    ...(clamped
      ? {
          note: `Speed limited the move: ${resolved.token.name} stopped at (${landing.x},${landing.y}) short of (${args.x},${args.y}).`,
        }
      : {}),
    ...(disengaged ? { disengaged: `Disengaged with ${disengaged}: no opportunity attacks.` } : {}),
  };
}

// A shove: the target goes one square straight away from whoever pushed it.
// Forced movement, so nothing is spent and nothing is provoked. The square
// has to be open floor with nobody on it; otherwise the target stays.
export function pushTokenAway(
  campaign: Campaign,
  encounterId: string,
  pusherRef: string,
  targetRef: string,
): { moved: true; at: { x: number; y: number } } | { moved: false; reason: string } {
  const map = getBattleMapForEncounter(encounterId);
  const pusher = map ? getTokenByRef(map.id, pusherRef) : null;
  const target = map ? getTokenByRef(map.id, targetRef) : null;
  if (!map || !pusher || !target) {
    return { moved: false, reason: "there is no battle map to move it on" };
  }
  const at = {
    x: target.x + Math.sign(target.x - pusher.x),
    y: target.y + Math.sign(target.y - pusher.y),
  };
  if (at.x < 0 || at.y < 0 || at.x >= map.width || at.y >= map.height) {
    return { moved: false, reason: "the edge of the map is behind it" };
  }
  if (blocksMove(tileAt(map.terrain, map.width, at.x, at.y))) {
    return { moved: false, reason: "a wall is behind it" };
  }
  if (occupiedTiles(map, listTokens(map.id), target).has(tileIndex(map.width, at.x, at.y))) {
    return { moved: false, reason: "someone stands behind it" };
  }
  moveToken(target.id, at.x, at.y, target.movedThisRound);
  publishBattleMapUpdate(campaign.id);
  return { moved: true, at };
}

// ---- spatial checks for pc_attack ----

// Sneak Attack's second trigger: another enemy of the target is within 5 ft
// of it and is not incapacitated (SRD 5.1), meaning a PC token other than the
// attacker, standing adjacent, whose sheet is up and able to act; a party
// companion is a PC token too. Null map = no spatial information, so the
// caller falls back to the advantage trigger alone rather than guessing.
export function allyAdjacentToEnemy(
  encounterId: string,
  attackerCharacterId: string,
  enemyId: string,
): boolean {
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return false;
  }
  const target = getTokenByRef(map.id, enemyId);
  if (!target) {
    return false;
  }
  return listTokens(map.id).some(
    (token) =>
      token.kind === "pc" &&
      token.refId !== attackerCharacterId &&
      chebyshev(token.x, token.y, target.x, target.y) <= 1 &&
      allyCanThreaten(token.refId),
  );
}

// An ally standing up: above 0 hit points, alive, and not incapacitated.
function allyCanThreaten(characterId: string): boolean {
  const sheet = getSheetById(characterId);
  return Boolean(
    sheet && sheet.currentHp > 0 && !sheet.deathSaves?.dead && !isIncapacitated(sheet.conditions),
  );
}

// Read-only range gate for player attacks: PCs are never auto-moved (players
// walk their own tokens), so an out-of-reach attack is refused with the
// distance spelled out. No map = no spatial enforcement. Returns an error
// string, or null when the attack may proceed.
// What the map says about an attack beyond whether it is legal: the cover
// the target enjoys and whether the shot is past its normal range. Returned
// alongside the refusal so pc_attack can fold both into the roll.
export type AttackSpatials = {
  cover: 0 | 2 | 5;
  longRange: boolean;
  // Tiles between the two, and whether the board is under the sky, so the
  // weather riders can be applied (src/lib/srd/weather.ts). Zero and false
  // when there is no board.
  distanceTiles: number;
  outdoors: boolean;
};

export function pcAttackSpatials(
  encounterId: string,
  characterId: string,
  enemyId: string,
  options: { ranged: boolean; rangeTiles: number; thrown: boolean },
): AttackSpatials {
  const none: AttackSpatials = { cover: 0, longRange: false, distanceTiles: 0, outdoors: false };
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return none;
  }
  const attacker = getTokenByRef(map.id, characterId);
  const target = getTokenByRef(map.id, enemyId);
  if (!attacker || !target) {
    return none;
  }
  const distance = chebyshev(attacker.x, attacker.y, target.x, target.y);
  return {
    // Blade Barrier's three-quarters cover counts as a wall's (zone-rules.ts).
    cover: Math.max(coverBetween(map.terrain, map.width, map.height, attacker.x, attacker.y, target.x, target.y), zoneCoverBetween(encounterId, characterId, enemyId)) as 0 | 2 | 5,
    // Past the weapon's normal range but inside its long range: the SRD
    // penalty is disadvantage, and checkPcAttackRange allows up to double.
    longRange: (options.ranged || options.thrown) && distance > options.rangeTiles,
    distanceTiles: distance,
    outdoors: map.outdoors,
  };
}

export function checkPcAttackRange(
  encounterId: string,
  characterId: string,
  enemyId: string,
  options: {
    ranged: boolean;
    rangeTiles: number;
    reachTiles: number;
    thrown: boolean;
    // The weapon's printed long range. Absent, the attack reaches twice its
    // normal range, which is what an attack-roll spell and a homebrew weapon
    // saved without one still do.
    longRangeTiles?: number;
  },
): string | null {
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return null;
  }
  const attacker = getTokenByRef(map.id, characterId);
  const target = getTokenByRef(map.id, enemyId);
  if (!attacker || !target) {
    return null;
  }
  const distance = chebyshev(attacker.x, attacker.y, target.x, target.y);
  const maxTiles = options.longRangeTiles ?? options.rangeTiles * 2;
  const sighted = hasLineOfSight(
    map.terrain,
    map.width,
    map.height,
    attacker.x,
    attacker.y,
    target.x,
    target.y,
  );
  if (!options.ranged && distance <= options.reachTiles) {
    // In reach. Toe to toe nothing can stand between; a reach weapon at 10
    // feet does not strike through the wall square in the middle.
    return distance <= 1 || sighted
      ? null
      : `A wall stands between ${attacker.name} and ${target.name}; the blow cannot reach through it. They must move their token to a clear line first or pick another target.`;
  }
  // The SRD long-range rule: past its normal range a weapon shoots at
  // disadvantage out to its long range. Past that it cannot reach at all.
  if ((options.ranged || options.thrown) && distance <= maxTiles) {
    return sighted
      ? null
      : `${attacker.name} has no line of sight to ${target.name}; something blocks the shot. They must move their token to a sightline first or pick another target.`;
  }
  if (options.ranged || options.thrown) {
    return `${attacker.name} is ${distance * 5} ft from ${target.name}, beyond this attack's ${maxTiles * 5} ft maximum range. They must move their token closer or pick another target.`;
  }
  return `${attacker.name} is ${distance * 5} ft from ${target.name}, out of melee reach (${options.reachTiles * 5} ft). They must move their token adjacent first or attack with a ranged weapon.`;
}

// ---- spatial checks for enemy_attack ----

// An enemy's reach, range and walk-in live in src/lib/dm/enemy-profile.ts and
// src/lib/dm/enemy-approach.ts; the name reading is re-exported here for the
// callers that learned it from this module.
export { isRangedAttackName } from "@/lib/dm/enemy-profile";
