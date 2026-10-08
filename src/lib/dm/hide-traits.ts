// Racial traits that let a character hide where others cannot, read by the
// Hide action (src/lib/dm/action-tools.ts) before it refuses someone a
// watcher sees clearly.
//
// SRD 5.1:
//   - Naturally Stealthy (lightfoot halfling): can attempt to hide even when
//     obscured only by a creature at least one size larger.
//   - Mask of the Wild (wood elf): can attempt to hide even when only lightly
//     obscured by foliage, heavy rain, falling snow, mist and other natural
//     phenomena.
// A trait answers only for the watchers it covers; any other clear view
// still stops the hide.
import { hasSkulker } from "@/lib/srd/feat-combat";
import { zoneHidesFrom } from "@/lib/dm/zone-rules";
import { enemySenses } from "@/lib/dm/attack-light";
import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listTokens } from "@/lib/db/battle-maps";
import { listEnemies } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { coverBetween, hasLineOfSight } from "@/lib/battlemap/los";
import { normalizeClock } from "@/lib/dm/calendar";
import { sizeForRace } from "@/lib/srd";
import { holdsFeature } from "@/lib/srd/trait-rules";
import { weatherPerceptionRider } from "@/lib/srd/weather";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const rank = (size: string | undefined) => {
  const at = SIZES.indexOf((size ?? "medium").toLowerCase());
  return at < 0 ? 2 : at;
};

// The squares a straight sight line crosses between two points, ends
// excluded, stepped the way the board's line of sight steps.
function squaresBetween(ax: number, ay: number, bx: number, by: number): Array<[number, number]> {
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  const out: Array<[number, number]> = [];
  for (let step = 1; step < steps; step += 1) {
    out.push([Math.round(ax + ((bx - ax) * step) / steps), Math.round(ay + ((by - ay) * step) / steps)]);
  }
  return out;
}

// Mask of the Wild's cover: the sky's weather that lightly obscures (fog,
// heavy rain, driving snow), or dim light on an outdoor board.
function lightlyObscuredByNature(campaign: Campaign, map: { outdoors?: boolean; ambient?: string }): boolean {
  if (map.outdoors === false) {
    return false;
  }
  if (map.ambient === "dim") {
    return true;
  }
  return weatherPerceptionRider(normalizeClock(campaign.clock).weather).disadvantage;
}

// The name of a watcher who sees this character clearly and whom no trait
// of theirs answers, or null when nobody does. Same reading of the board as
// seenClearlyBy (attack-spatial.ts), watcher by watcher.
export function seenClearlyDespiteTraits(
  campaign: Campaign,
  encounterId: string,
  sheet: CharacterSheet,
): string | null {
  const map = getBattleMapForEncounter(encounterId);
  const hider = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!map || !hider) {
    return null;
  }
  const masked = holdsFeature(sheet, "mask of the wild") && lightlyObscuredByNature(campaign, map);
  if (masked) {
    return null;
  }
  // Skulker: lightly obscured is enough to hide, indoors or out (feat-combat.ts).
  if (hasSkulker(sheet) && (map.ambient === "dim" || lightlyObscuredByNature(campaign, map))) {
    return null;
  }
  const stealthy = holdsFeature(sheet, "naturally stealthy");
  const mySize = rank(sizeForRace(sheet.race));
  const tokens = listTokens(map.id);
  // A creature one size larger than the hider standing in a square the sight
  // line crosses.
  const screened = (fromX: number, fromY: number) =>
    squaresBetween(fromX, fromY, hider.x, hider.y).some(([x, y]) =>
      tokens.some((token) => {
        if (token.x !== x || token.y !== y || token.refId === sheet.id) {
          return false;
        }
        const other = getSheetById(token.refId);
        const enemy = other ? null : listEnemies(encounterId).find((entry) => entry.id === token.refId);
        const size = other ? sizeForRace(other.race) : (enemy?.stats.size as string | undefined);
        return rank(size) > mySize;
      }),
    );
  for (const enemy of listEnemies(encounterId)) {
    if (enemy.status !== "alive" || enemy.conditions.some((name) => name.toLowerCase() === "blinded")) {
      continue;
    }
    const token = getTokenByRef(map.id, enemy.id);
    if (!token) {
      continue;
    }
    const sighted = hasLineOfSight(map.terrain, map.width, map.height, token.x, token.y, hider.x, hider.y);
    const cover = coverBetween(map.terrain, map.width, map.height, token.x, token.y, hider.x, hider.y);
    const dark = map.ambient === "dark" && hider.lightRadius <= 0;
    // A fog cloud or magical darkness between them hides as darkness does (zone-rules.ts).
    if (!sighted || cover > 0 || dark || zoneHidesFrom(map, token, hider, enemySenses(enemy))) {
      continue;
    }
    if (stealthy && screened(token.x, token.y)) {
      continue;
    }
    return enemy.displayName;
  }
  return null;
}
