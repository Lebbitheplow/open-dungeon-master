import type { Campaign } from "@/lib/db/campaigns";
import { getActiveBoard, listEnemies } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import {
  deleteToken,
  getBattleMapForEncounter,
  getToken,
  insertToken,
  listTokens,
  placeToken,
  setTokenHidden,
  type BattleMap,
} from "@/lib/db/battle-maps";
import { templateTiles, tokensInTemplate, type TemplateSpec } from "@/lib/battlemap/template";
import { tileIndex, type AdhocTokenKind, type BattleToken } from "@/lib/battlemap/types";
import {
  adhocRefId,
  checkAdhocName,
  checkAdhocRoom,
  checkPlacement,
  isAdhocRef,
  type MapPing,
} from "@/lib/dm/board-logic";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { publishEphemeral, publishPersisted } from "@/lib/events";

// The DM's hands on the tactical board: pick a token up and put it down
// anywhere legal, place their own people and furniture, hide a combatant the
// party has not met, drop a measured template and see who is standing in it,
// and ping a tile so everyone looks at the same place.
//
// None of this is an adjudication, so none of it is in the catalog and the
// AI is never offered it: a person moving a figurine on the table is not a
// rules call the engine has to be able to make. It is DM-only for the same
// reason the map studio is (src/lib/dm/map-studio.ts).

export type BoardOutcome = { ok: true; note: string } | { error: string };

function boardMap(campaign: Campaign): BattleMap | null {
  const board = getActiveBoard(campaign.id);
  return board ? getBattleMapForEncounter(board.id) : null;
}

function occupiedExcept(
  map: BattleMap,
  tokens: BattleToken[],
  exceptId: string | null,
): Set<number> {
  const taken = new Set<number>();
  for (const token of tokens) {
    if (token.id === exceptId) {
      continue;
    }
    taken.add(tileIndex(map.width, token.x, token.y));
  }
  return taken;
}

// The record of a DM's board handling. It is a persisted campaign event
// rather than a table note on purpose: the plan asks for these moves to be
// recorded in the audit rather than charged against the round, and a line in
// the transcript every time the DM nudges a goblin two squares would bury
// the story it is supposed to be serving.
function recordBoardAction(campaign: Campaign, note: string) {
  publishPersisted(campaign.id, "dm_board_action", { note });
}

// Free placement. Ignores reach, the movement budget and whose turn it is,
// and enforces only what the board itself cannot be wrong about: inside the
// map, not inside a wall, not on top of somebody.
export function moveTokenFreely(
  campaign: Campaign,
  tokenId: string,
  x: number,
  y: number,
): BoardOutcome {
  const map = boardMap(campaign);
  if (!map) {
    return { error: "There is no board on the table." };
  }
  const token = getToken(tokenId);
  if (!token) {
    return { error: "That token is not on this board." };
  }
  const tokens = listTokens(map.id);
  if (!tokens.some((other) => other.id === token.id)) {
    return { error: "That token is not on this board." };
  }
  const placement = checkPlacement({
    terrain: map.terrain,
    width: map.width,
    height: map.height,
    occupied: occupiedExcept(map, tokens, token.id),
    x,
    y,
  });
  if ("error" in placement) {
    return placement;
  }
  placeToken(token.id, x, y);
  publishBattleMapUpdate(campaign.id);
  const note = `The DM moved ${token.name} to ${x + 1}, ${y + 1}.`;
  recordBoardAction(campaign, note);
  return { ok: true, note };
}

export function addAdhocToken(
  campaign: Campaign,
  input: { kind: AdhocTokenKind; name: unknown; x: number; y: number; hidden?: boolean },
): BoardOutcome {
  const map = boardMap(campaign);
  if (!map) {
    return { error: "There is no board on the table." };
  }
  const named = checkAdhocName(input.name);
  if ("error" in named) {
    return named;
  }
  const tokens = listTokens(map.id);
  const room = checkAdhocRoom(tokens.filter((token) => isAdhocRef(token.refId)).length);
  if ("error" in room) {
    return room;
  }
  const placement = checkPlacement({
    terrain: map.terrain,
    width: map.width,
    height: map.height,
    occupied: occupiedExcept(map, tokens, null),
    x: input.x,
    y: input.y,
  });
  if ("error" in placement) {
    return placement;
  }
  insertToken({
    mapId: map.id,
    campaignId: campaign.id,
    kind: input.kind,
    refId: adhocRefId(input.kind, crypto.randomUUID()),
    name: named.name,
    x: input.x,
    y: input.y,
    hidden: input.hidden === true,
  });
  publishBattleMapUpdate(campaign.id);
  const note = `The DM placed ${named.name} on the board.`;
  recordBoardAction(campaign, note);
  return { ok: true, note };
}

// Only the DM's own pieces can be cleared away. A PC or an enemy token is
// owned by a sheet or a stat block, and deleting it here would leave a
// combatant in the initiative order with nowhere to stand.
export function removeAdhocToken(campaign: Campaign, tokenId: string): BoardOutcome {
  const map = boardMap(campaign);
  const token = map ? getToken(tokenId) : null;
  if (!map || !token) {
    return { error: "That token is not on this board." };
  }
  if (!isAdhocRef(token.refId)) {
    return {
      error: `${token.name} belongs to the fight, not to the scenery. Take them out of the initiative order instead.`,
    };
  }
  deleteToken(token.id);
  publishBattleMapUpdate(campaign.id);
  const note = `The DM took ${token.name} off the board.`;
  recordBoardAction(campaign, note);
  return { ok: true, note };
}

// One flag, two surfaces: hidden keeps a combatant off the players' map and
// off their initiative tracker (src/lib/db/encounters.ts). A player's own
// character is never hideable, because the projection that would hide them
// from the table is the same one they play from.
export function setTokenVisibility(
  campaign: Campaign,
  tokenId: string,
  hidden: boolean,
): BoardOutcome {
  const map = boardMap(campaign);
  const token = map ? getToken(tokenId) : null;
  if (!map || !token) {
    return { error: "That token is not on this board." };
  }
  if (token.kind === "pc") {
    return { error: "A player's own character cannot be hidden from them." };
  }
  setTokenHidden(token.id, hidden);
  publishBattleMapUpdate(campaign.id);
  publishEncounter(campaign.id);
  const note = hidden
    ? `The DM hid ${token.name} from the party.`
    : `${token.name} is revealed.`;
  recordBoardAction(campaign, note);
  return { ok: true, note };
}

export type TemplateReadout = {
  tiles: number[];
  caught: Array<{
    tokenId: string;
    name: string;
    kind: string;
    // Ids the DM can hand straight to aoe_damage.
    characterId?: string;
    enemyId?: string;
  }>;
};

// Drops a measured area on the board and reports who is standing in it.
// Writes nothing: the DM is looking, not casting. What comes back is the
// target list aoe_damage takes, so placing the fireball and resolving it are
// the same two clicks they are at a table.
export function readTemplate(campaign: Campaign, spec: TemplateSpec): TemplateReadout | null {
  const map = boardMap(campaign);
  if (!map) {
    return null;
  }
  const tiles = templateTiles(
    { terrain: map.terrain, width: map.width, height: map.height },
    spec,
  );
  const tokens = listTokens(map.id);
  const board = getActiveBoard(campaign.id);
  const enemyIds = new Set(board ? listEnemies(board.id).map((enemy) => enemy.id) : []);
  const sheetIds = new Set(listSheets(campaign.id).map((sheet) => sheet.id));
  return {
    tiles,
    caught: tokensInTemplate(map.width, tiles, tokens).map((token) => ({
      tokenId: token.id,
      name: token.name,
      kind: token.kind,
      ...(token.kind === "pc" && sheetIds.has(token.refId) ? { characterId: token.refId } : {}),
      ...(token.kind === "enemy" && enemyIds.has(token.refId) ? { enemyId: token.refId } : {}),
    })),
  };
}

// A ping is a pointing finger, so it is ephemeral: it is never replayed on
// reconnect, because "look here" is only true while somebody is saying it.
// `focus` is the DM's version, which opens the board on every client rather
// than only flashing on the ones already looking at it.
export function pingBoard(
  campaign: Campaign,
  input: { x: number; y: number; byName: string; focus: boolean },
) {
  const ping: MapPing = {
    x: input.x,
    y: input.y,
    by: input.byName,
    focus: input.focus,
    at: Date.now(),
  };
  publishEphemeral(campaign.id, "map_ping", ping);
}
