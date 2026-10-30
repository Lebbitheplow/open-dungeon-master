// A creature that has to run (issue #621): turned by a cleric (SRD 5.1 Turn
// Undead: "it must spend its turns trying to move as far away from you as it
// can ... For its action, it can use only the Dash action or try to escape
// from an effect that prevents it from moving. If there's nowhere to move,
// the creature can use the Dodge action"), fleeing under Fear ("must take the
// Dash action and move away from you by the safest available route"), or
// told to flee by Command ("spends its turn moving away from you by the
// fastest available means"). The GM was told to Dash them away and could
// not; a turn the model skipped played their attack. Pure, with no "@/"
// imports, so scripts/test-enemy-turn-logic.mjs loads it directly.

// The condition Turn Undead lays (src/lib/dm/feature-spends.ts). Its own
// name, so a frightened from elsewhere is not confused with it.
export const TURNED = "turned";
// Fear's flight and Command's flee (src/lib/srd/condition-effects-last.ts).
export const FLEEING = "fleeing";
// Calm Emotions: indifferent, so a calmed creature on its turn holds.
export const CALMED = "calmed";
// Command's Approach: it walks to the caster, its turn over once within 5 feet.
export const APPROACHING = "approaching";

const has = (conditions: readonly string[], name: string) => conditions.some((entry) => entry.trim().toLowerCase() === name);

// The condition that makes it spend its turn running, or null.
export function fleeHold(conditions: readonly string[]): string | null {
  return [TURNED, FLEEING].find((name) => has(conditions, name)) ?? null;
}

// Whether Command's Approach draws it to its caster.
export function approachHold(conditions: readonly string[]): boolean {
  return has(conditions, APPROACHING);
}

// Whether it holds where it is on a turn played for it: calmed, and not
// running from anything.
export function holdsCalm(conditions: readonly string[]): boolean {
  return has(conditions, CALMED) && !fleeHold(conditions);
}

type XY = { x: number; y: number };

const apart = (a: XY, b: XY) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// The squares nearer `source` than `from` is, by tile index: a creature that
// fears it cannot step on them (SRD 5.1, Frightened; Turn Undead), so a walk
// that routes around them is a walk it may take.
export function nearerSquares(width: number, height: number, from: XY, source: XY): number[] {
  const start = apart(from, source);
  const out: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (apart({ x, y }, source) < start) {
        out.push(y * width + x);
      }
    }
  }
  return out;
}

// Where a fleeing creature runs to: of the squares it can reach this turn,
// the one farthest from what it flees, the cheaper walk on a tie, and never
// a square nearer than where it stands. Null when nowhere is farther (it is
// cornered: a turned creature Dodges then).
export function farthestFrom(from: XY, source: XY, reachable: ReadonlyArray<XY & { cost: number }>): (XY & { cost: number }) | null {
  const start = apart(from, source);
  let best: (XY & { cost: number }) | null = null;
  for (const square of reachable) {
    const distance = apart(square, source);
    if (distance <= start) {
      continue;
    }
    const bestDistance = best ? apart(best, source) : -1;
    if (distance > bestDistance || (distance === bestDistance && best && square.cost < best.cost)) {
      best = square;
    }
  }
  return best;
}
