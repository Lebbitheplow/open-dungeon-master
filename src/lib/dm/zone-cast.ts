// Laying a spell's area on the board when the spell is cast (SRD 5.1: the
// point of origin within range; a wall from one end; a line from the
// caster; an aura around them). Called by the cast guard for a spell cast
// through use_spell_slot or cast_buff, and by aoe_damage and cast_at_enemy
// once their saves are rolled, so the area and its first saves come from
// one casting.
//
// Where it goes: the square the call names (atX/atY, towardX/towardY for a
// wall or a line); with none, the creatures the spell caught (the middle of
// them), else the caster's own square for a burst, and for a wall two
// squares from the caster toward the nearest foe. A spell recast while the
// first casting still holds moves the area; a concentration spell ends the
// caster's other areas. Gust of Wind blows away the clouds it crosses;
// Daylight dispels overlapping darkness of 3rd level or lower.
//
// Off the map nothing is laid, and the spell resolves as before.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listTokens, setTokenLight } from "@/lib/db/battle-maps";
import { getClock } from "@/lib/db/clock";
import { getActiveBoard, getEnemy, patchEnemyConditions, setEnemyConcentration } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { chebyshev, type XY } from "@/lib/battlemap/types";
import { layZone, type SpellZone, type ZoneCasterKind } from "@/lib/battlemap/zones";
import { LIGHT_SPELLS, zoneKey, zoneRowFor } from "@/lib/battlemap/zones-spells";
import { holdGasesBack } from "@/lib/battlemap/zones-walls";
import { quakeShake } from "@/lib/dm/zone-quake";
import { breakConcentration, clearSpellConditionsByName } from "@/lib/dm/concentration";
import { casterHolds, liveZones, publishZones, saveZones } from "@/lib/dm/zone-store";

export type ZoneCast = {
  spell: string;
  caster: { kind: ZoneCasterKind; id: string; name: string };
  slotLevel?: number | null;
  dc?: number | null;
  at?: XY | null;
  toward?: XY | null;
  // Combatants the spell caught, whose middle is the point when none is named.
  caught?: string[];
};

function middleOf(points: XY[]): XY | null {
  if (!points.length) {
    return null;
  }
  const x = Math.round(points.reduce((sum, point) => sum + point.x, 0) / points.length);
  const y = Math.round(points.reduce((sum, point) => sum + point.y, 0) / points.length);
  return { x, y };
}

// The nearest creature on the other side from the caster.
function nearestFoe(tokens: ReturnType<typeof listTokens>, caster: { kind: ZoneCasterKind; id: string }, from: XY): XY | null {
  const foes = tokens.filter((token) => (caster.kind === "enemy" ? token.kind === "pc" : token.kind === "enemy"));
  foes.sort((a, b) => chebyshev(from.x, from.y, a.x, a.y) - chebyshev(from.x, from.y, b.x, b.y));
  return foes[0] ? { x: foes[0].x, y: foes[0].y } : null;
}

function inside(point: XY, width: number, height: number): XY | null {
  return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height ? point : null;
}

// Lays the area, or null when the spell has none or there is no board.
// Returns the line the tool result carries.
export function placeSpellZone(campaign: Campaign, cast: ZoneCast): string | null {
  const light = LIGHT_SPELLS[zoneKey(cast.spell)];
  if (light) {
    return lightTheCaster(campaign, cast, light);
  }
  const row = zoneRowFor(cast.spell);
  const encounter = row ? getActiveBoard(campaign.id) : null;
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!row || !encounter || !map) {
    return null;
  }
  const tokens = listTokens(map.id);
  const casterToken = getTokenByRef(map.id, cast.caster.id);
  const casterAt = casterToken ? { x: casterToken.x, y: casterToken.y } : null;
  const named = cast.at ? inside(cast.at, map.width, map.height) : null;
  const caught = middleOf(
    (cast.caught ?? [])
      .map((ref) => tokens.find((token) => token.refId === ref))
      .filter((token): token is NonNullable<typeof token> => Boolean(token))
      .map((token) => ({ x: token.x, y: token.y })),
  );
  let origin: XY | null;
  let toward = cast.toward ? inside(cast.toward, map.width, map.height) : null;
  if (row.shape === "aura" || row.shape === "line" || row.self) {
    origin = casterAt;
    if (row.shape === "line" && !toward) {
      toward = named ?? caught ?? (casterAt ? nearestFoe(tokens, cast.caster, casterAt) : null);
    }
  } else if (row.shape === "wall") {
    origin = named;
    if (!origin && casterAt) {
      const foe = nearestFoe(tokens, cast.caster, casterAt) ?? caught;
      origin = foe
        ? {
            x: Math.max(0, Math.min(map.width - 1, casterAt.x + 2 * Math.sign(foe.x - casterAt.x))),
            y: Math.max(0, Math.min(map.height - 1, casterAt.y + 2 * Math.sign(foe.y - casterAt.y))),
          }
        : casterAt;
    }
  } else {
    origin = named ?? caught ?? casterAt;
  }
  if (!origin) {
    return null;
  }
  const layout = layZone(row, { origin, toward, caster: casterAt, slotLevel: cast.slotLevel ?? null }, map);
  const probe: SpellZone = {
    id: crypto.randomUUID().slice(0, 12),
    spell: cast.spell,
    casterId: cast.caster.id,
    casterKind: cast.caster.kind,
    casterName: cast.caster.name.slice(0, 80),
    origin,
    ...(layout.toward ? { toward: layout.toward } : {}),
    cells: layout.cells,
    ...(layout.hot ? { hot: layout.hot } : {}),
    concentration: row.concentration,
    castRound: encounter.round,
    untilRound: row.rounds === null ? null : encounter.round + row.rounds - 1,
    slotLevel: cast.slotLevel ?? null,
    dc: cast.dc ?? null,
  };
  // A concentration spell the server cannot see held (a homebrew caster, a
  // row the checklist lacks) runs for its duration instead of vanishing.
  const zone = row.concentration && !casterHolds(probe) ? { ...probe, concentration: false } : probe;
  const wanted = zoneKey(cast.spell);
  const before = liveZones(map, encounter);
  // The same casting laid again moves; a caster concentrates on one spell.
  const kept = before.filter(
    (other) =>
      !(other.casterId === zone.casterId && (zoneKey(other.spell) === wanted || (zone.concentration && other.concentration))),
  );
  const overlaps = (other: SpellZone) => other.cells.some((cell) => zone.cells.includes(cell));
  const blown = row.disperses ? kept.filter((other) => row.disperses?.includes(zoneKey(other.spell)) && overlaps(other)) : [];
  const dispelled = row.dispelsDarknessUpTo
    ? kept.filter((other) => zoneRowFor(other.spell)?.darkness && (other.slotLevel ?? zoneRowFor(other.spell)?.level ?? 9) <= (row.dispelsDarknessUpTo ?? 0) && overlaps(other))
    : [];
  // A cloud stops at a Wind Wall, laid before or after it (zones-walls.ts).
  saveZones(map.id, holdGasesBack([...kept.filter((other) => !blown.includes(other) && !dispelled.includes(other)), zone], map.width));
  // A dispelled spell is over: the caster's concentration on it ends too.
  for (const other of [...blown, ...dispelled]) {
    endCasting(campaign, other);
  }
  publishZones(campaign.id);
  const lasting = zone.concentration
    ? `while ${zone.casterName} concentrates`
    : zone.untilRound === null
      ? "for the rest of the fight"
      : `through round ${zone.untilRound}`;
  const gone = [...blown, ...dispelled].map((other) => other.spell);
  // Earthquake's first shaking comes with the casting (zone-quake.ts).
  const shaken = row.quake ? quakeShake(campaign, map, zone, cast.dc ?? 13) : [];
  return `${shaken.length ? `${shaken.join(" ")} ` : ""}${zone.spell} covers ${zone.cells.length} squares around (${origin.x},${origin.y}) ${lasting}: ${row.summary}.${gone.length ? ` It ends ${gone.join(" and ")}.` : ""} The server applies it; send atX/atY to lay it elsewhere.`;
}

// A spell dispelled or blown away: its caster's concentration on it ends,
// and with it whatever else it held.
function endCasting(campaign: Campaign, zone: SpellZone) {
  if (!zone.concentration) {
    return;
  }
  if (zone.casterKind === "pc") {
    breakConcentration(campaign, null, zone.casterId, `${zone.spell} was dispelled`);
    return;
  }
  const enemy = getEnemy(zone.casterId);
  if (enemy?.concentration && zoneKey(enemy.concentration) === zoneKey(zone.spell)) {
    setEnemyConcentration(enemy.id, null);
    clearSpellConditionsByName(campaign, zone.spell, undefined, enemy.id);
  }
}

// Fire reaching a creature in a Web burns the web's cube around it away
// (SRD 5.1, Web): those squares leave the web and burn for a round, a
// creature starting its turn in the fire takes 2d4 fire, and whoever the
// burnt webs held is free of them. Called by the damage paths with the
// creature fire just struck.
export function burnWebUnder(campaign: Campaign, refId: string): string | null {
  const encounter = getActiveBoard(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, refId) : null;
  if (!encounter || !map || !token) {
    return null;
  }
  const cell = token.y * map.width + token.x;
  const zones = liveZones(map, encounter);
  const webs = zones.filter((zone) => zoneKey(zone.spell) === "web" && zone.cells.includes(cell));
  if (!webs.length) {
    return null;
  }
  const kept = zones.map((zone) => (webs.includes(zone) ? { ...zone, cells: zone.cells.filter((entry) => entry !== cell) } : zone));
  const fire: SpellZone = {
    id: crypto.randomUUID().slice(0, 12),
    spell: "Burning Web",
    casterId: webs[0].casterId,
    casterKind: webs[0].casterKind,
    casterName: webs[0].casterName,
    origin: { x: token.x, y: token.y },
    cells: [cell],
    concentration: false,
    castRound: encounter.round,
    untilRound: encounter.round + 1,
    slotLevel: null,
    dc: null,
  };
  saveZones(map.id, [...kept, fire]);
  freeFromWeb(campaign, refId);
  publishZones(campaign.id);
  return `The web around (${token.x},${token.y}) catches fire and burns away.`;
}

// The creature a burnt web held is held no more.
function freeFromWeb(campaign: Campaign, refId: string) {
  const enemy = getEnemy(refId);
  if (enemy) {
    const meta = enemy.conditionMeta as Record<string, { spell?: string } | undefined>;
    if (enemy.conditions.includes("restrained") && zoneKey(meta.restrained?.spell ?? "") === "web") {
      const rest = { ...meta };
      delete rest.restrained;
      patchEnemyConditions(enemy.id, enemy.conditions.filter((name) => name !== "restrained"), rest as typeof enemy.conditionMeta);
    }
    return;
  }
  const sheet = getSheetById(refId);
  const meta = (sheet?.conditionMeta ?? {}) as Record<string, { spell?: string } | undefined>;
  if (sheet && sheet.conditions.includes("restrained") && zoneKey(meta.restrained?.spell ?? "") === "web") {
    const rest = { ...meta };
    delete rest.restrained;
    const updated = patchSheet(sheet.id, { conditions: sheet.conditions.filter((name) => name !== "restrained"), conditionMeta: rest as typeof sheet.conditionMeta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
}

// An enemy's area spell the mechanics table has no row for (Darkness, Fog
// Cloud) still holds its concentration: the area rides on it, and damage to
// the enemy can end both. Returns the line for the result, or null.
export function holdEnemyAreaConcentration(campaign: Campaign, enemyId: string, spell: string): string | null {
  const row = zoneRowFor(spell);
  const enemy = getEnemy(enemyId);
  if (!row?.concentration || !enemy || enemy.status !== "alive" || zoneKey(enemy.concentration ?? "") === zoneKey(spell)) {
    return null;
  }
  if (enemy.concentration) {
    clearSpellConditionsByName(campaign, enemy.concentration, undefined, enemy.id);
  }
  setEnemyConcentration(enemy.id, spell);
  return `${enemy.displayName} is now concentrating on ${spell}; damage to it forces a CON save and a break ends the area.`;
}

// Light and Continual Flame on the object the caster holds: their token
// carries the light the board's vision already reads (bright 20 feet, dim
// 20 more), Light for an hour of the clock, Continual Flame until dispelled.
function lightTheCaster(campaign: Campaign, cast: ZoneCast, light: { radiusTiles: number; minutes: number }): string | null {
  const encounter = getActiveBoard(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, cast.caster.id) : null;
  if (!token) {
    return null;
  }
  const instant = getClock(campaign.id).instant;
  setTokenLight(token.id, light.radiusTiles, light.minutes ? instant + light.minutes : 0, light.minutes);
  publishZones(campaign.id);
  return `${cast.caster.name}'s ${cast.spell} sheds bright light 20 feet and dim light 20 feet more${light.minutes ? " for an hour" : ""}; the board's light and sight read it.`;
}
