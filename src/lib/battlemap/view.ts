import { getCampaignById, getFloor } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { lightRemaining } from "@/lib/dm/light-timers";
import { breakDown } from "@/lib/dm/calendar";
import { effectiveAmbient } from "@/lib/battlemap/daylight";
import { weatherObscurementTiles } from "@/lib/srd/weather";
import { listEffects } from "@/lib/db/active-effects";
import { getActiveBoard, getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { getSheetForUser, listSheets } from "@/lib/db/sheets";
import { footprintForSize, footprintIndexes, type Footprint } from "@/lib/battlemap/footprint";
import { healthWord, type HealthWord } from "@/lib/battlemap/health-words";
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
import {
  tileIndex,
  type AmbientLight,
  type BattleToken,
  type TokenKind,
  type TokenMovement,
} from "@/lib/battlemap/types";
import type { Backdrop } from "@/lib/battlemap/backdrop";
import {
  drawingsFor,
  labelsFor,
  type DoorStates,
  type LightZone,
  type MapDrawing,
  type MapLabel,
} from "@/lib/battlemap/scene";
import type { MapTheme } from "@/lib/battlemap/generate";
import type { MapSkin } from "@/lib/battlemap/skins";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { TokenIntent } from "@/lib/battlemap/intent";
import { projectIntents } from "@/lib/dm/intent";

// Per-player projection of the battle map. This is the ONLY battlemap
// module that touches the DB, and the only shape clients ever see: terrain
// is blanked outside explored tiles, enemy tokens are fog-gated, and ally
// PC tokens are always shown (the party coordinates aloud at the table).

export type PlayerMapView = {
  mapId: string;
  width: number;
  height: number;
  // The light the board is under right now: the author's for a roofed map,
  // the clock's and the weather's for one under the sky.
  ambient: AmbientLight;
  outdoors: boolean;
  theme: MapTheme;
  // Row-major terrain chars; unexplored tiles are replaced with a space.
  terrain: string;
  // Cosmetic art under the grid, or null. The renderer draws it only inside
  // explored tiles, so a picture cannot show a player through the fog that
  // is hiding the terrain (src/lib/battlemap/backdrop.ts).
  backdrop: Backdrop | null;
  // What the board is painted with when it has no backdrop; empty means the
  // setting and theme decide. Cosmetic, so it is the same for every viewer.
  skin: MapSkin;
  visible: number[];
  explored: number[];
  tokens: Array<{
    id: string;
    kind: TokenKind;
    refId: string;
    name: string;
    x: number;
    y: number;
    mine: boolean;
    // PC at 0 HP: rendered downed, never removed from the map.
    down: boolean;
    // Only ever true in the DM's projection: a hidden token is absent from a
    // player's rather than marked in it.
    hidden: boolean;
    // A carried light burning down: minutes left of the whole, or null
    // (docs/vtt-parity-implementation-plan.md 7.3).
    light: { remaining: number; total: number } | null;
    // The painted object a prop or bystander is drawn as, or "" for the
    // plain figure (public/assets/props/manifest.json ids).
    stamp: string;
  }>;
  lights: Array<{ x: number; y: number; radius: number }>;
  reachable: number[];
  budgetLeft: number;
  myTokenId: string | null;
  round: number;
  currentTurnName: string;
  // Whether this board is a fight or an exploration scene. A scene has no
  // rounds and no initiative, so movement is not rationed on it.
  board: "fight" | "scene";
  // True when this projection skipped fog entirely (the DM's view). Clients
  // use it to drop the fog shading, not to decide what they may do.
  fullVision: boolean;
  // DM view only: real hit points behind every token, so the person running
  // the fight can see the board the way they see their own notes.
  tokenHp?: Record<string, { current: number; max: number }>;
  // The scene layer (src/lib/battlemap/scene.ts). Labels a player may see,
  // and only where they have been; the DM sees them all. Door states,
  // patches of light and the overlay picture are the DM's alone: a player
  // sees a locked or secret door as the wall the engine treats it as.
  labels: MapLabel[];
  // Marks drawn on the board: everyone's, and the DM's own for the DM.
  drawings: MapDrawing[];
  doors?: DoorStates;
  zones?: LightZone[];
  overlayPath?: string;
  // The stage layer (docs/vtt-parity-implementation-plan.md section 1.1).
  // Every entry states a fact the engine holds: conditions with rounds
  // left, a health word instead of a number, an aura's reach, a large
  // creature's footprint, whether it is flying, whose turn it is, and who
  // attacked whom this round. Keyed by token id; absent keys mean none.
  tokenConditions: Record<string, Array<{ id: string; label: string; rounds?: number }>>;
  tokenHealth: Record<string, HealthWord>;
  tokenAuras: Record<string, Array<{ id: string; radiusFeet: number; tone: AuraTone }>>;
  tokenFootprint: Record<string, Footprint>;
  tokenElevation: Record<string, "flying" | "burrowing">;
  turn: { tokenId: string; round: number } | null;
  targets: Record<string, string[]>;
  // What each enemy this viewer can see is about to do: the DM's declaration
  // for this round, else the engine's guess (src/lib/dm/intent.ts, which also
  // holds the redaction). Empty when the table has `enemyIntent` off.
  intents: TokenIntent[];
};

type AuraTone = "ward" | "harm" | "bless" | "neutral";

// Aura of Protection reaches 10 ft from paladin 6 and 30 ft from 18; the
// save bonus itself is applied by src/lib/dm/aura.ts. This is only the ring.
function paladinAura(sheet: CharacterSheet): { radiusFeet: number; tone: AuraTone } | null {
  const hasAura = sheet.features.some((feature) => /aura of protection/i.test(feature.name));
  if (!hasAura) {
    return null;
  }
  return { radiusFeet: sheet.level >= 18 ? 30 : 10, tone: "ward" };
}

function conditionRows(
  conditions: string[],
  meta: Record<string, { rounds?: number } | undefined>,
): Array<{ id: string; label: string; rounds?: number }> {
  return conditions.map((condition) => {
    const rounds = meta[condition]?.rounds;
    return {
      id: condition.toLowerCase(),
      label: condition,
      ...(typeof rounds === "number" && rounds > 0 ? { rounds } : {}),
    };
  });
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
  const sheet = getSheetForUser(campaignId, userId);
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
  const vision = {
    terrain: map.terrain,
    width: map.width,
    height: map.height,
    ambient,
    zones: map.zones,
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
  let budgetLeft = 0;
  if (!fullVision && sheet && myToken && sheet.currentHp > 0 && canMoveNow(campaignId, sheet.id)) {
    budgetLeft =
      encounter.kind === "scene"
        ? tileCount
        : Math.max(0, speedToTiles(sheet.speed) - myToken.movedThisRound);
    if (budgetLeft > 0) {
      const occupied = occupiedTiles(map, tokens, myToken, footprintLookup(enemiesById));
      reachable = [
        ...reachableTiles(
          map.terrain,
          map.width,
          map.height,
          occupied,
          myToken,
          budgetLeft,
          1,
          myToken.movement === "fly",
        ).keys(),
      ];
    }
  }

  const currentEntry = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;

  // The stage layer: facts about each shown token, keyed by token id.
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
      const rows = conditionRows(enemy.conditions, enemy.conditionMeta);
      if (enemy.concentration) {
        rows.push({ id: "concentrating", label: `Concentrating: ${enemy.concentration}` });
      }
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
      const rows = conditionRows(pcSheet.conditions, pcSheet.conditionMeta);
      if (rows.length) {
        tokenConditions[shown.id] = rows;
      }
      tokenHealth[shown.id] = healthWord(pcSheet.currentHp, pcSheet.maxHp, {
        dead: Boolean(pcSheet.deathSaves?.dead),
      });
      const paladin = paladinAura(pcSheet);
      if (paladin) {
        auras.push({ id: `aura-${pcSheet.id}`, ...paladin });
      }
    }
    if (auras.length) {
      tokenAuras[shown.id] = auras;
    }
  }
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
            ? [{ id: enemy.id, stats: enemy.stats, token }]
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
    budgetLeft,
    myTokenId: myToken?.id ?? null,
    round: encounter.round,
    currentTurnName: currentEntry?.name ?? "",
    board: encounter.kind,
    fullVision,
    labels: labelsFor(map.labels, map.width, { dm: fullVision, explored }),
    drawings: drawingsFor(map.drawings, { dm: fullVision, round: encounter.round }),
    tokenConditions,
    tokenHealth,
    tokenAuras,
    tokenFootprint,
    tokenElevation,
    turn,
    targets,
    intents,
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
              return [[token.id, { current: source.currentHp, max: source.maxHp }]];
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
