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

// Command's other words (SRD 5.1): Halt ("does not move and takes no
// actions") and Grovel ("falls prone and then ends its turn").
export const HALTED = "halted";
export const GROVELING = "groveling";

// What a creature under one of these may still do on that turn.
export type HeldAct = "attack" | "use" | "dash" | "disengage" | "dodge" | "escape";

const DUTIES: Record<string, { word: string; duty: string; moves: boolean }> = {
  [APPROACHING]: { word: "approach", duty: "it moves toward its caster by the most direct route, and its turn ends once within 5 feet", moves: true },
  [FLEEING]: { word: "flee", duty: "it runs from its caster by the fastest means", moves: true },
  [HALTED]: { word: "halt", duty: "it does not move and takes no action", moves: false },
  [GROVELING]: { word: "grovel", duty: "it has fallen prone and its turn is over", moves: false },
};

const ACT_WORDS: Record<HeldAct, string> = {
  attack: "attack",
  use: "spell or ability",
  dash: "Dash",
  disengage: "Disengage with its action",
  dodge: "Dodge",
  escape: "escape attempt",
};

// The refusal for an act a creature's turn is spent away from (issue #621):
// Command's approach, flee, halt or grovel, or Fear's flight, on that turn.
// A run or a walk to the caster keeps the moves it needs (Dash, an escape
// from what holds it, Nimble Escape's bonus-action Disengage: `bonusMove`);
// halt and grovel keep nothing. Null when nothing holds the act.
export function heldTurnRefusal(
  creature: { displayName: string; conditions: readonly string[]; conditionMeta?: Record<string, { spell?: string } | undefined> },
  act: HeldAct,
  bonusMove = false,
): string | null {
  const held = [APPROACHING, FLEEING, HALTED, GROVELING].find((name) => has(creature.conditions, name));
  if (!held) {
    return null;
  }
  const { word, duty, moves } = DUTIES[held];
  if (moves && (act === "dash" || act === "escape" || (act === "disengage" && bonusMove))) {
    return null;
  }
  const condition = creature.conditions.find((entry) => entry.trim().toLowerCase() === held) ?? held;
  const spell = creature.conditionMeta?.[condition]?.spell;
  const under = !spell || spell === "Command" ? `obeys Command (${word})` : `is ${held} (${spell})`;
  return `${creature.displayName} ${under} this turn: ${duty}, so it makes no ${ACT_WORDS[act]}.`;
}
