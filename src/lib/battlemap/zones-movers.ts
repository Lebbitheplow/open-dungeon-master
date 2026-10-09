// What a spell area makes of one particular mover, and what a spell on the
// mover makes of its walk (SRD 5.1). Pure, like the rest of this directory;
// src/lib/dm/zone-rules.ts reads the mover (size, flight, conditions) and
// composes these with zones.ts zoneStepCost.
//
//   - Wind Wall: "Small or smaller flying creatures or objects can't pass
//     through the wall", and "creatures in gaseous form can't pass through
//     it". Its squares are barred to such a mover.
//   - Freedom of Movement: movement is unaffected by difficult terrain, and
//     magical effects cannot reduce the creature's speed: no spell area
//     changes what a step costs it, and the board's difficult ground costs
//     it nothing extra.
//   - Spider Climb: a climbing speed equal to its walking speed.
//   - Water Walk: liquid is walked on as solid ground.

import type { SpellZone } from "@/lib/battlemap/zones";
import { zoneRowFor } from "@/lib/battlemap/zones-spells";

export type ZoneMover = {
  size?: string | null;
  flying?: boolean;
  conditions?: string[];
  // Who moves and what it is (Antilife Shell lets undead and constructs by,
  // and moves with its caster).
  ref?: string;
  type?: string | null;
};

// Antilife Shell stops every creature but an undead or a construct.
export function barredByShell(type: string | null | undefined): boolean {
  return !/\b(undead|construct)\b/i.test(type ?? "");
}

// A cost no walk pays: the square is closed to this mover.
export const BARRED = 1000;

const has = (mover: ZoneMover, name: string) =>
  (mover.conditions ?? []).some((entry) => entry.trim().toLowerCase() === name || entry.trim().toLowerCase().startsWith(`${name} (`));

// The squares the board's spell areas close to this mover, or null.
export function barredCells(zones: SpellZone[], mover: ZoneMover | null): Set<number> | null {
  if (!mover) {
    return null;
  }
  const small = /^(tiny|small)$/i.test((mover.size ?? "").trim());
  const gaseous = has(mover, "gaseous form") || has(mover, "wind walk");
  const out = new Set<number>();
  for (const zone of zones) {
    const row = zoneRowFor(zone);
    if (row?.stopsSmallFlyers && ((small && mover.flying) || gaseous)) {
      for (const cell of zone.cells) {
        out.add(cell);
      }
    }
  }
  return out.size ? out : null;
}

// Freedom of Movement: no spell area changes this mover's steps.
export function ignoresZoneSteps(mover: ZoneMover | null): boolean {
  return Boolean(mover && has(mover, "freedom of movement"));
}

// What spells on the mover add to its walking traits.
export function moverSpellTraits(mover: ZoneMover | null): { landStride?: true; climbs?: true; swims?: true } {
  if (!mover) {
    return {};
  }
  return {
    ...(has(mover, "freedom of movement") ? { landStride: true as const } : {}),
    ...(has(mover, "spider climb") ? { climbs: true as const } : {}),
    ...(has(mover, "water walk") ? { swims: true as const } : {}),
  };
}

// A step function with the edges of Forcecage and Antilife Shell closed to
// this mover: a step from inside to outside or back is barred. Null when no
// such area stands.
export function withEdges(
  step: ((from: number, to: number, cost: number) => number) | null,
  zones: SpellZone[],
  mover: ZoneMover | null,
): ((from: number, to: number, cost: number) => number) | null {
  const edges = zones.filter((zone) => {
    const row = zoneRowFor(zone);
    return Boolean(row?.cage || (row?.barsLiving && zone.casterId !== mover?.ref && barredByShell(mover?.type)));
  });
  if (!edges.length) {
    return step;
  }
  return (from, to, cost) => {
    if (from >= 0 && edges.some((zone) => zone.cells.includes(from) !== zone.cells.includes(to))) {
      return BARRED;
    }
    return step ? step(from, to, cost) : cost;
  };
}

// A step function with the barred squares closed.
export function withBarred(
  step: ((from: number, to: number, cost: number) => number) | null,
  barred: Set<number> | null,
): ((from: number, to: number, cost: number) => number) | null {
  if (!barred) {
    return step;
  }
  return (from, to, cost) => (barred.has(to) ? BARRED : step ? step(from, to, cost) : cost);
}
