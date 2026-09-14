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
  setTokenMovement,
  type BattleMap,
} from "@/lib/db/battle-maps";
import { planTeleportFx } from "@/lib/battlemap/fx-plan";
import { publishFx } from "@/lib/dm/fx";
import { generateBattleMap, fnv1a } from "@/lib/battlemap/generate";
import { findPath, speedToTiles, walkPathWithBudget } from "@/lib/battlemap/movement";
import { coverBetween, hasLineOfSight } from "@/lib/battlemap/los";
import { bestFiringPosition } from "@/lib/battlemap/tactics";
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
import { publishEphemeral } from "@/lib/events";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { resolvePcOpportunityAttacks } from "@/lib/dm/opportunity";
import { effectiveSpeed } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { z } from "zod";

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
      "Move a combatant to a tile WITHOUT walking: Misty Step, Dimension Door, Thunder Step, a trap door, a shove through a portal. No path is needed and no movement is spent, but the tile must be open floor with nobody on it. Pass rangeFeet for a spell so the server refuses a jump past its range.",
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
        rangeFeet: {
          type: "integer",
          minimum: 5,
          maximum: 1000,
          description: "The spell's range, when a spell did it; omitted for a DM's own hand.",
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
      "Record that a combatant is now flying, burrowing or back on foot (Fly spell, wings, Wild Shape into a bird, a burrowing worm). Flying creatures pass over ground obstacles and are missed by tremorsense; the board draws them lifted.",
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
  if (args.rangeFeet !== undefined && distanceFeet > args.rangeFeet) {
    return {
      error: `(${args.x},${args.y}) is ${distanceFeet} ft away, past the ${args.rangeFeet} ft range. Pick a tile within range.`,
    };
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
      "Move a combatant on the battle map: an enemy taking its movement, or a character being pushed, pulled, or carried (forced movement only; players walk their own tokens). The server enforces walls, occupancy, and speed; enemy moves clamp to the farthest legal tile toward the target.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tokenName: {
          type: "string",
          description:
            "Enemy name or enemyId, or character name/characterId for forced movement, exactly as shown on the battle map in GAME STATE.",
        },
        x: { type: "integer", description: "Destination column." },
        y: { type: "integer", description: "Destination row." },
        forced: {
          type: "boolean",
          description: "True only when a character is moved against their will.",
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
  reason: z.string().optional(),
});

function resolveMoveTarget(
  map: BattleMap,
  encounterId: string,
  ref: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { token: BattleToken; kind: "pc" | "enemy"; speedTiles: number } | null {
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
  const speedTiles =
    effectiveSpeed(enemy.conditions, 1) === 0 ? 0 : speedToTiles(enemy.stats.speed);
  return token ? { token, kind: "enemy", speedTiles } : null;
}

export function handleMoveToken(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
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
    return {
      error: `${resolved.token.name} is a player character; players move their own tokens. Pass forced:true only when something pushes, drags, or carries them.`,
    };
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
  const path = findPath(
    map.terrain,
    map.width,
    map.height,
    occupied,
    resolved.token,
    { x: args.x, y: args.y },
    moverFootprint,
    resolved.token.movement === "fly",
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
  // enemy movement clamps to the round's remaining budget along the path.
  let landing = { x: args.x, y: args.y };
  let spent = 0;
  let clamped = false;
  if (resolved.kind === "enemy") {
    const budget = Math.max(0, resolved.speedTiles - resolved.token.movedThisRound);
    const walk = walkPathWithBudget(map.terrain, map.width, path, budget);
    if (!walk.at) {
      return {
        error: `${resolved.token.name} has no movement left this round (speed ${resolved.speedTiles * 5} ft).`,
      };
    }
    landing = walk.at;
    spent = walk.spent;
    clamped = !walk.reachedEnd;
  }
  const origin = { x: resolved.token.x, y: resolved.token.y };
  moveToken(
    resolved.token.id,
    landing.x,
    landing.y,
    resolved.kind === "enemy" ? resolved.token.movedThisRound + spent : resolved.token.movedThisRound,
  );
  publishBattleMapUpdate(campaign.id);

  // An enemy breaking away from a character eats their opportunity attack,
  // exactly as the reverse does when a player walks off. Forced movement
  // (a shove, a gust of wind) provokes nothing.
  const opportunity =
    resolved.kind === "enemy" && !args.forced
      ? resolvePcOpportunityAttacks(campaign, resolved.token.refId, origin, landing)
      : [];
  // Fresh ranges from the landing tile, so the model narrates the new
  // distances instead of remembering the pre-move map.
  const opposing = tokens.filter(
    (other) => other.id !== resolved.token.id && other.kind !== resolved.kind,
  );
  const distances = opposing.map((other) => {
    const tilesApart = Math.max(Math.abs(landing.x - other.x), Math.abs(landing.y - other.y));
    return `${other.name}: ${tilesApart <= 1 ? "ADJACENT (5 ft)" : `${tilesApart * 5} ft`}`;
  });
  return {
    ok: true,
    name: resolved.token.name,
    at: `(${landing.x},${landing.y})`,
    ...(distances.length ? { distancesNow: distances.join("; ") } : {}),
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
  };
}

// ---- spatial checks for pc_attack ----

// Sneak Attack's second trigger: another enemy of the target is within 5 ft
// of it, meaning any PC token other than the attacker standing adjacent.
// Null map = no spatial information, so the caller falls back to the
// advantage trigger alone rather than guessing.
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
      chebyshev(token.x, token.y, target.x, target.y) <= 1,
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
    cover: coverBetween(map.terrain, map.width, map.height, attacker.x, attacker.y, target.x, target.y),
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
  options: { ranged: boolean; rangeTiles: number; reachTiles: number; thrown: boolean },
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
  if (!options.ranged && distance <= options.reachTiles) {
    return null;
  }
  const sighted = hasLineOfSight(
    map.terrain,
    map.width,
    map.height,
    attacker.x,
    attacker.y,
    target.x,
    target.y,
  );
  // The SRD long-range rule: a ranged weapon reaches twice its normal range,
  // at disadvantage. Past that it cannot reach at all.
  if ((options.ranged || options.thrown) && distance <= options.rangeTiles * 2) {
    return sighted
      ? null
      : `${attacker.name} has no line of sight to ${target.name}; something blocks the shot. They must move their token to a sightline first or pick another target.`;
  }
  if (options.ranged || options.thrown) {
    return `${attacker.name} is ${distance * 5} ft from ${target.name}, beyond this attack's ${options.rangeTiles * 10} ft maximum range. They must move their token closer or pick another target.`;
  }
  return `${attacker.name} is ${distance * 5} ft from ${target.name}, out of melee reach (${options.reachTiles * 5} ft). They must move their token adjacent first or attack with a ranged weapon.`;
}

// ---- spatial checks for enemy_attack ----

const RANGED_ATTACK_RE =
  /bow|crossbow|sling|dart|javelin|thrown|spit|spine|rifle|pistol|gun|blast|bolt|ray|breath|web|rock|spear of|longarm/i;
const RANGED_TILES = 12;

// Whether an enemy attack name reads as a ranged attack (shared with the
// condition engine's melee/ranged advantage rules).
export function isRangedAttackName(attackName: string): boolean {
  return RANGED_ATTACK_RE.test(attackName);
}

// Melee attackers step toward their target automatically so a model that
// never calls move_token still produces spatially coherent combat. Returns
// null when the attack may proceed; otherwise a result explaining why not.
export function approachForAttack(
  campaign: Campaign,
  encounterId: string,
  enemyId: string,
  targetCharacterId: string,
  attackName: string,
): { blocked?: Record<string, unknown>; movedTo?: string } | null {
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return null;
  }
  const attacker = getTokenByRef(map.id, enemyId);
  const target = getTokenByRef(map.id, targetCharacterId);
  if (!attacker || !target) {
    return null;
  }
  const distance = chebyshev(attacker.x, attacker.y, target.x, target.y);
  const ranged = RANGED_ATTACK_RE.test(attackName);
  if (ranged) {
    const sighted = hasLineOfSight(
      map.terrain,
      map.width,
      map.height,
      attacker.x,
      attacker.y,
      target.x,
      target.y,
    );
    if (distance <= RANGED_TILES && sighted) {
      return null;
    }
    // Out of range or sight: auto-reposition to the nearest reachable tile
    // that has both, so ranged enemies keep spatially coherent tokens the
    // same way melee attackers auto-approach.
    const enemy = listEnemies(encounterId).find((entry) => entry.id === enemyId);
    const budget =
      enemy && effectiveSpeed(enemy.conditions, 1) === 0
        ? 0
        : Math.max(0, speedToTiles(enemy?.stats.speed) - attacker.movedThisRound);
    const tokens = listTokens(map.id);
    const occupied = occupiedTiles(map, tokens, attacker);
    const spot =
      budget > 0
        ? bestFiringPosition(
            map.terrain,
            map.width,
            map.height,
            occupied,
            attacker,
            target,
            budget,
            RANGED_TILES,
          )
        : null;
    if (spot) {
      moveToken(attacker.id, spot.at.x, spot.at.y, attacker.movedThisRound + spot.cost);
      publishBattleMapUpdate(campaign.id);
      return { movedTo: `(${spot.at.x},${spot.at.y})` };
    }
    return {
      blocked: {
        error: sighted
          ? `${attacker.name} is ${distance * 5} ft from ${target.name}, beyond this attack's ${RANGED_TILES * 5} ft range, and cannot close the gap this round. Pick another target or action.`
          : `${attacker.name} has no line of sight to ${target.name} and cannot reach a firing position this round. Pick another target or action.`,
      },
    };
  }
  if (distance <= 1) {
    return null;
  }

  const enemy = listEnemies(encounterId).find((entry) => entry.id === enemyId);
  const budget =
    enemy && effectiveSpeed(enemy.conditions, 1) === 0
      ? 0
      : Math.max(0, speedToTiles(enemy?.stats.speed) - attacker.movedThisRound);
  const tokens = listTokens(map.id);
  const occupied = occupiedTiles(map, tokens, attacker);
  const path = findPath(map.terrain, map.width, map.height, occupied, attacker, target);
  // Path targets the occupied tile; stop one step short of it.
  const approach = path ? path.slice(0, -1) : null;
  let landed = { x: attacker.x, y: attacker.y };
  if (approach && approach.length && budget > 0) {
    const walk = walkPathWithBudget(map.terrain, map.width, approach, budget);
    if (walk.at) {
      landed = walk.at;
      moveToken(attacker.id, walk.at.x, walk.at.y, attacker.movedThisRound + walk.spent);
      publishBattleMapUpdate(campaign.id);
    }
  }
  const remaining = chebyshev(landed.x, landed.y, target.x, target.y);
  if (remaining <= 1) {
    return { movedTo: `(${landed.x},${landed.y})` };
  }
  return {
    blocked: {
      error: `${attacker.name} is ${remaining * 5} ft from ${target.name} and cannot reach them this round${
        landed.x !== attacker.x || landed.y !== attacker.y
          ? `; it moved to (${landed.x},${landed.y})`
          : ""
      }. Use a ranged option or a different target.`,
    },
  };
}
