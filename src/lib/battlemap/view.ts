import { getCampaignById, getFloor } from "@/lib/db/campaigns";
import { actingSheetFor } from "@/lib/character-seat";
import { getClock } from "@/lib/db/clock";
import { lightRemaining } from "@/lib/dm/light-timers";
import { breakDown } from "@/lib/dm/calendar";
import { effectiveAmbient } from "@/lib/battlemap/daylight";
import { weatherObscurementTiles } from "@/lib/srd/weather";
import { listEffects } from "@/lib/db/active-effects";
import { getActiveBoard, getActiveEncounter, listEnemies, type Encounter } from "@/lib/db/encounters";
import { speedFor } from "@/lib/srd";
import { getMounts } from "@/lib/db/mounts";
import { effectiveMaxHp, effectiveSpeed, exhaustionSpeed } from "@/lib/dm/condition-logic";
import { budgetApplies } from "@/lib/dm/action-budget";
import { listSheets } from "@/lib/db/sheets";
import { footprintForSize, footprintIndexes, type Footprint } from "@/lib/battlemap/footprint";
import { healthWord } from "@/lib/battlemap/health-words";
import { orderEntryId } from "@/lib/db/encounters";
import {
  getBattleMapForEncounter,
  getExplored,
  getTokenByRef,
  listTokens,
  mergeExplored,
  type BattleMap,
} from "@/lib/db/battle-maps";
import {
  darkvisionTilesFromText,
  perceivesToken,
  visibleTiles,
  type Viewer,
} from "@/lib/battlemap/los";
import { cachedLitTiles } from "@/lib/battlemap/lit-cache";
import { sensesFromText, type Senses } from "@/lib/srd/senses";
import { reachableTiles, speedToTiles } from "@/lib/battlemap/movement";
import { pcMoveTraits } from "@/lib/battlemap/passage";
import { flyingSpeedOf, tileIndex, type BattleToken, type TokenMovement } from "@/lib/battlemap/types";
import { drawingsFor, labelsFor } from "@/lib/battlemap/scene";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { projectIntents } from "@/lib/dm/intent";
import { namesLookup } from "@/lib/battlemap/condition-notes";
import { characterHealthWord, characterStageRows, enemyStageRows } from "@/lib/battlemap/view-stage";
import { targetEdges } from "@/lib/battlemap/view-tactics";
import { lightsWithZones, sightTerrainFor, withZoneSteps } from "@/lib/dm/zone-rules";
import { viewZones } from "@/lib/dm/zone-view";
import { standUpTiles } from "@/lib/srd/authored-effects-more";
import { addSilenceChips, viewerMoves } from "@/lib/battlemap/view-moves";
import type { AuraTone, PlayerMapView } from "@/lib/battlemap/view-types";

export type { PlayerMapView } from "@/lib/battlemap/view-types";

// Per-player projection of the battle map. This is the ONLY battlemap
// module that touches the DB, and the only shape clients ever see: terrain
// is blanked outside explored tiles, enemy tokens are fog-gated, and ally
// PC tokens are always shown (the party coordinates aloud at the table).


// Aura of Protection reaches 10 ft from paladin 6 and 30 ft from 18; the
// save bonus itself is applied by src/lib/dm/aura.ts. This is only the ring.
function paladinAura(sheet: CharacterSheet): { radiusFeet: number; tone: AuraTone } | null {
  const hasAura = sheet.features.some((feature) => /aura of protection/i.test(feature.name));
  if (!hasAura) {
    return null;
  }
  return { radiusFeet: sheet.level >= 18 ? 30 : 10, tone: "ward" };
}

function elevationOf(movement: TokenMovement): "flying" | "burrowing" | null {
  return movement === "fly" ? "flying" : movement === "burrow" ? "burrowing" : null;
}

export function sheetDarkvisionTiles(sheet: CharacterSheet): number {
  return darkvisionTilesFromText([...sheet.features.map((feature) => feature.name), sheet.race]);
}

// Every sense a character has, from race and feature names (Blind Fighting,
// Devil's Sight, Ghostly Gaze, a homebrew "blindsight 30 ft" feature).
export function sheetSenses(sheet: CharacterSheet): Senses {
  const senses = sensesFromText([...sheet.features.map((feature) => feature.name), sheet.race]);
  return { ...senses, darkvision: Math.max(senses.darkvision, sheetDarkvisionTiles(sheet)) };
}

// Whether this player's PC may move right now: open floor, or their own
// slot in the initiative order.
function canMoveNow(campaignId: string, characterId: string): boolean {
  const floor = getFloor(campaignId);
  if (floor.mode === "open") {
    return true;
  }
  if (floor.mode !== "initiative") {
    return false;
  }
  const encounter = getActiveEncounter(campaignId);
  if (!encounter || !encounter.orderReady) {
    return false;
  }
  const current = encounter.order[encounter.turnIndex];
  return current?.kind === "pc" && current.characterId === characterId;
}

// Movement left this turn for a player character, in tiles, and the speed
// it comes from. The one computation the board's highlights and the move
// route both use: conditions, exhaustion, armor and the Dash action all
// count, so no lit tile is refused and no Dash tile goes unlit (issue 17).
export function pcMoveBudget(
  campaignId: string,
  encounter: Encounter,
  map: BattleMap,
  sheet: CharacterSheet,
  token: BattleToken,
): { speed: number; tiles: number; fullTiles: number } {
  const campaign = getCampaignById(campaignId);
  // A mounted rider moves at the mount's speed (SRD 5.1, Mounted Combat).
  const mount = getMounts(campaignId)[sheet.id];
  // Aloft, a character moves at their flying speed (the Fly spell's 60 feet).
  const flying = token.movement === "fly" ? flyingSpeedOf({ conditions: sheet.conditions, features: sheet.features }) : null;
  const base = mount
    ? mount.speed
    : flying ?? speedFor(sheet, {
        encumbrance: campaign?.gameSettings.variantRules.encumbrance ?? false,
      });
  const speed = exhaustionSpeed(sheet.exhaustion ?? 0, effectiveSpeed(sheet.conditions, base));
  // A scene has no rounds, so there is no per-round budget to spend: the
  // party walks the board while the DM describes it.
  if (encounter.kind === "scene") {
    return { speed, tiles: map.width * map.height, fullTiles: map.width * map.height };
  }
  const dashed = budgetApplies(encounter.turnBudget, sheet.id, encounter.round)
    ? Boolean(encounter.turnBudget?.dashed)
    : false;
  const fullTiles = Math.max(0, speedToTiles(speed) * (dashed ? 2 : 1) - token.movedThisRound);
  // Prone: the character stands for half their speed and walks on what is
  // left, or crawls at double cost, whichever reaches farther. `tiles` is
  // what the board lights; `fullTiles` is the movement actually in hand,
  // which the move route charges the standing or the crawling to.
  const prone = sheet.conditions.some((entry) => entry.trim().toLowerCase() === "prone");
  // Tipsy Sway stands for 5 feet (src/lib/srd/authored-effects-more.ts).
  const tiles = prone
    ? Math.max(fullTiles - standUpTiles(sheet, speedToTiles(speed)), Math.floor(fullTiles / 2))
    : fullTiles;
  return { speed, tiles: Math.max(0, tiles), fullTiles };
}

// The board on the table, fight or scene. Only the map layer asks this
// question; everything that enforces a combat rule keeps asking
// getActiveEncounter, which never answers with a scene.
export function getActiveBattleMap(campaignId: string): BattleMap | null {
  const board = getActiveBoard(campaignId);
  if (!board) {
    return null;
  }
  return getBattleMapForEncounter(board.id);
}

export function buildPlayerMapView(
  campaignId: string,
  userId: string,
  // `enemyNumbers` is the seat's capsFor().enemyNumbers: whether an intent
  // may carry its expected damage.
  options: { fullVision?: boolean; enemyNumbers?: boolean } = {},
): PlayerMapView | null {
  // The DM sees the whole board. Everything below that reads `visible` or
  // `explored` then falls through to the full tile set, so there is one
  // branch rather than a fog exception per feature.
  const fullVision = options.fullVision === true;
  const encounter = getActiveBoard(campaignId);
  if (!encounter) {
    return null;
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return null;
  }
  // "My" token follows the character acting now: on this player's own
  // character's turn that one, else the selected one (character-seat.ts).
  const sheet = actingSheetFor(campaignId, userId, undefined, encounter);
  const tokens = listTokens(map.id);
  const tileCount = map.width * map.height;
  const myToken = sheet ? getTokenByRef(map.id, sheet.id) : null;

  // Under the sky, the clock and the weather decide the light and how far
  // anyone sees; under a roof, the author does (src/lib/battlemap/daylight.ts).
  const clock = getClock(campaignId);
  const clockInstant = clock.instant;
  const ambient = effectiveAmbient(
    map.ambient,
    map.outdoors,
    breakDown(clock.calendar, clock.instant).hour,
    clock.weather,
  );
  // Spectators (no sheet/token) see only ally positions on a dark field.
  // Spell areas stop sight (a fog cloud, magical darkness) and light it
  // (Daylight): src/lib/dm/zone-rules.ts.
  const vision = {
    terrain: sheet ? sightTerrainFor(map, sheetSenses(sheet)) : map.terrain,
    width: map.width,
    height: map.height,
    ambient,
    zones: lightsWithZones(map),
    obscureBeyond: map.outdoors ? weatherObscurementTiles(clock.weather) : Infinity,
  };
  // Shared across every member's projection of this board; read only
  // (src/lib/battlemap/lit-cache.ts).
  const lit = cachedLitTiles({ ...vision, id: map.id }, tokens, map.lights);
  let visible = new Set<number>();
  let explored = new Set<number>();
  let viewer: Viewer | null = null;
  if (fullVision) {
    for (let i = 0; i < tileCount; i += 1) {
      visible.add(i);
      explored.add(i);
    }
  } else if (sheet && myToken) {
    const senses = sheetSenses(sheet);
    viewer = {
      x: myToken.x,
      y: myToken.y,
      darkvisionTiles: senses.darkvision,
      blindsightTiles: senses.blindsight,
      tremorsenseTiles: senses.tremorsense,
      truesightTiles: senses.truesight,
      devilsSightTiles: senses.devilsSight,
    };
    visible = visibleTiles(vision, viewer, tokens, map.lights, lit);
    explored = mergeExplored(map.id, sheet.id, visible, tileCount);
  } else if (sheet) {
    explored = getExplored(map.id, sheet.id, tileCount);
  }

  // Terrain memory: what the character has explored, blanked elsewhere.
  // The DM's projection is the DRAWN board, door glyphs and all, with the
  // states beside it; a player's is the engine's, where a locked or secret
  // door is the wall it currently is.
  const terrainChars = (fullVision ? map.drawnTerrain : map.terrain).split("");
  for (let i = 0; i < tileCount; i += 1) {
    if (!explored.has(i)) {
      terrainChars[i] = " ";
    }
  }

  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const sheetsById = new Map(listSheets(campaignId).map((entry) => [entry.id, entry]));
  const shownTokens = tokens
    .filter((token) => {
      // The DM hid it, so for everyone but the DM it is not on the board at
      // all. Withholding rather than dimming is the point: a shape the
      // players can see but not identify is still a warning.
      if (token.hidden && !fullVision) {
        return false;
      }
      if (token.kind === "enemy") {
        const enemy = enemiesById.get(token.refId);
        if (!enemy || enemy.status !== "alive") {
          return false;
        }
        // Seen, or felt through the ground by tremorsense. The DM sees all.
        return fullVision || (viewer ? perceivesToken(vision, viewer, token, visible) : false);
      }
      // Allies are always drawn: the party coordinates aloud at the table.
      // The DM's own NPCs and props are things standing in the room, so they
      // follow the same rule the enemies do and appear when they are seen.
      if (token.kind === "npc" || token.kind === "prop") {
        return fullVision || (viewer ? perceivesToken(vision, viewer, token, visible) : false);
      }
      return true;
    })
    .map((token) => ({
      id: token.id,
      kind: token.kind,
      refId: token.refId,
      name: token.name,
      x: token.x,
      y: token.y,
      mine: myToken !== null && token.id === myToken.id,
      down:
        token.kind === "pc" && (sheetsById.get(token.refId)?.currentHp ?? 1) <= 0,
      hidden: token.hidden,
      light: lightRemaining(token, clockInstant),
      stamp: token.stamp ?? "",
    }));

  // Reachable tiles for click-to-move, only when the player may move now.
  // Out of combat there are no rounds to ration movement against, so a scene
  // spends nothing: the party walks the board while the DM talks.
  let reachable: number[] = [];
  let reachableCost: number[] = [];
  let moves: PlayerMapView["moves"];
  let budgetLeft = 0;
  if (!fullVision && sheet && myToken && sheet.currentHp > 0 && canMoveNow(campaignId, sheet.id)) {
    const budget = pcMoveBudget(campaignId, encounter, map, sheet, myToken);
    budgetLeft = budget.tiles;
    if (budgetLeft > 0) {
      const occupied = occupiedTiles(map, tokens, myToken, footprintLookup(enemiesById));
      const costs = [
        ...reachableTiles(
          map.terrain,
          map.width,
          map.height,
          occupied,
          myToken,
          budgetLeft,
          1,
          myToken.movement === "fly",
          // The same passage the move route allows (src/lib/battlemap/passage.ts).
          withZoneSteps(pcMoveTraits({ width: map.width, tokens, mover: myToken, sheet, footprintOf: footprintLookup(enemiesById), enemySize: (refId) => enemiesById.get(refId)?.stats.size }), map, "pc"),
        ).entries(),
      ];
      // What the move route will charge for each square, and what the move
      // may carry this turn (src/lib/battlemap/view-moves.ts).
      ({ reachable, reachableCost, moves } = viewerMoves({
        costs,
        sheet,
        token: myToken,
        scene: encounter.kind === "scene",
        budget,
        enemies: [...enemiesById.values()],
      }));
    }
  }

  const currentEntry = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;

  // The stage layer: facts about each shown token, keyed by token id.
  // Names a condition's metadata may point at: the combatants this viewer
  // can see, and every member of the party.
  const nameOf = namesLookup([
    ...shownTokens.map((token) => ({ id: token.refId, name: token.name })),
    ...[...sheetsById.values()].map((entry) => ({ id: entry.id, name: entry.name })),
  ]);
  const tokenConditions: PlayerMapView["tokenConditions"] = {};
  const tokenHealth: PlayerMapView["tokenHealth"] = {};
  const tokenAuras: PlayerMapView["tokenAuras"] = {};
  const tokenFootprint: PlayerMapView["tokenFootprint"] = {};
  const tokenElevation: PlayerMapView["tokenElevation"] = {};
  const tokenByRef = new Map(tokens.map((token) => [token.refId, token]));
  const effectAuras = new Map<string, Array<{ id: string; radiusFeet: number; tone: AuraTone }>>();
  for (const effect of listEffects(campaignId)) {
    if (!effect.aura) {
      continue;
    }
    const list = effectAuras.get(effect.targetId) ?? [];
    list.push({ id: effect.id, radiusFeet: effect.aura.radiusFeet, tone: effect.aura.tone });
    effectAuras.set(effect.targetId, list);
  }
  for (const shown of shownTokens) {
    const token = tokenByRef.get(shown.refId);
    const elevation = token ? elevationOf(token.movement) : null;
    if (elevation) {
      tokenElevation[shown.id] = elevation;
    }
    const auras = [...(effectAuras.get(shown.refId) ?? [])];
    if (shown.kind === "enemy") {
      const enemy = enemiesById.get(shown.refId);
      if (!enemy) {
        continue;
      }
      const rows = enemyStageRows(enemy, nameOf);
      if (rows.length) {
        tokenConditions[shown.id] = rows;
      }
      tokenHealth[shown.id] = healthWord(enemy.currentHp, enemy.maxHp, {
        dead: enemy.status === "dead",
      });
      const footprint = footprintForSize(enemy.stats.size);
      if (footprint > 1) {
        tokenFootprint[shown.id] = footprint;
      }
    } else if (shown.kind === "pc") {
      const pcSheet = sheetsById.get(shown.refId);
      if (!pcSheet) {
        continue;
      }
      const rows = characterStageRows(pcSheet, nameOf);
      if (rows.length) {
        tokenConditions[shown.id] = rows;
      }
      tokenHealth[shown.id] = characterHealthWord(pcSheet);
      const paladin = paladinAura(pcSheet);
      if (paladin) {
        auras.push({ id: `aura-${pcSheet.id}`, ...paladin });
      }
    }
    if (auras.length) {
      tokenAuras[shown.id] = auras;
    }
  }
  // A creature standing in Silence is deafened by it (view-moves.ts).
  const spellZones = viewZones(map, encounter, explored, fullVision ? null : { characterId: sheet?.id ?? null, cell: myToken ? tileIndex(map.width, myToken.x, myToken.y) : null });
  addSilenceChips(spellZones, shownTokens, tokenConditions, map.width);
  const shownIds = new Set(shownTokens.map((token) => token.id));
  const turnToken =
    currentEntry && encounter.kind === "fight"
      ? tokenByRef.get(orderEntryId(currentEntry))
      : undefined;
  const turn =
    turnToken && shownIds.has(turnToken.id)
      ? { tokenId: turnToken.id, round: encounter.round }
      : null;
  const targets: PlayerMapView["targets"] = {};
  if (encounter.targets.round === encounter.round) {
    for (const [attackerRef, targetRefs] of Object.entries(encounter.targets.pairs)) {
      const attacker = tokenByRef.get(attackerRef);
      if (!attacker || !shownIds.has(attacker.id)) {
        continue;
      }
      const ids = targetRefs
        .map((ref) => tokenByRef.get(ref)?.id)
        .filter((id): id is string => Boolean(id) && shownIds.has(id as string));
      if (ids.length) {
        targets[attacker.id] = ids;
      }
    }
  }

  // Intent is a fight's business: a scene has no rounds to declare one for.
  const intentOn =
    encounter.kind === "fight" &&
    getCampaignById(campaignId)?.gameSettings.enemyIntent !== false;
  const intents = intentOn
    ? projectIntents({
        round: encounter.round,
        declared: encounter.intents,
        enemies: tokens.flatMap((token) => {
          const enemy = token.kind === "enemy" ? enemiesById.get(token.refId) : undefined;
          return enemy && enemy.status === "alive"
            ? [{ id: enemy.id, stats: enemy.stats, conditions: enemy.conditions, token }]
            : [];
        }),
        pcTokens: tokens
          .filter((token) => token.kind === "pc")
          .map((token) => ({
            id: token.id,
            refId: token.refId,
            x: token.x,
            y: token.y,
            hidden: token.hidden,
            down: (sheetsById.get(token.refId)?.currentHp ?? 1) <= 0,
          })),
        shownTokenIds: shownIds,
        enemyNumbers: fullVision || options.enemyNumbers === true,
      })
    : [];

  return {
    mapId: map.id,
    width: map.width,
    height: map.height,
    ambient,
    outdoors: map.outdoors,
    theme: map.theme,
    terrain: terrainChars.join(""),
    backdrop: map.backdrop,
    skin: map.skin,
    visible: [...visible],
    explored: [...explored],
    tokens: shownTokens,
    lights: map.lights
      .filter((light) => explored.has(tileIndex(map.width, light.x, light.y)))
      .map((light) => ({ x: light.x, y: light.y, radius: light.brightRadius })),
    reachable,
    reachableCost,
    ...(moves ? { moves } : {}),
    budgetLeft,
    myTokenId: myToken?.id ?? null,
    round: encounter.round,
    currentTurnName: currentEntry?.name ?? "",
    board: encounter.kind,
    fullVision,
    labels: labelsFor(map.labels, map.width, { dm: fullVision, explored }),
    spellZones,
    drawings: drawingsFor(map.drawings, { dm: fullVision, round: encounter.round }),
    tokenConditions,
    tokenHealth,
    tokenAuras,
    tokenFootprint,
    tokenElevation,
    turn,
    targets,
    intents,
    edges:
      !fullVision && sheet && myToken && encounter.kind === "fight"
        ? targetEdges({
            encounterId: encounter.id,
            characterId: sheet.id,
            characterConditions: sheet.conditions,
            enemyIds: shownTokens.filter((token) => token.kind === "enemy").map((token) => token.refId),
            flankingRule: getCampaignById(campaignId)?.gameSettings.variantRules.flanking === true,
          })
        : {},
    ...(fullVision
      ? {
          doors: map.doors,
          zones: map.zones,
          ...(map.overlayPath ? { overlayPath: map.overlayPath } : {}),
          tokenHp: Object.fromEntries(
            shownTokens.flatMap((token) => {
              const source =
                token.kind === "enemy"
                  ? enemiesById.get(token.refId)
                  : sheetsById.get(token.refId);
              if (!source) {
                return [];
              }
              const max = token.kind === "enemy" ? source.maxHp : effectiveMaxHp(source as CharacterSheet);
              return [[token.id, { current: source.currentHp, max }]];
            }),
          ),
        }
      : {}),
  };
}

// Tiles no one may move through or onto: every living token except the
// mover, with a large creature covering its whole footprint. Dead enemies
// keep no token (removed on death), but guard anyway.
export function occupiedTiles(
  map: BattleMap,
  tokens: BattleToken[],
  mover: BattleToken | null,
  footprintOf?: (token: BattleToken) => Footprint,
): Set<number> {
  const occupied = new Set<number>();
  for (const token of tokens) {
    if (mover && token.id === mover.id) {
      continue;
    }
    const footprint = footprintOf?.(token) ?? 1;
    if (footprint === 1) {
      occupied.add(tileIndex(map.width, token.x, token.y));
      continue;
    }
    for (const idx of footprintIndexes(map.width, { x: token.x, y: token.y }, footprint)) {
      occupied.add(idx);
    }
  }
  return occupied;
}

// The footprint of each token on a board, from the enemies' stat blocks.
// Player characters are Small or Medium and take one square.
export function footprintLookup(
  enemiesById: Map<string, { stats: { size?: string } }>,
): (token: BattleToken) => Footprint {
  return (token) =>
    token.kind === "enemy" ? footprintForSize(enemiesById.get(token.refId)?.stats.size) : 1;
}
