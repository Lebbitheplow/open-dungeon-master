// The dice tray's pool: the dice a reader taps in, and the expression they
// make. Pure and free of the dice engine (which needs node:crypto), so the
// tray's dialog can hold it in the browser; tray-rules.ts judges what the
// pool makes before the server throws it.

// The largest flat bonus the tray adds. A 20th level character with
// expertise and a 20 in the ability reaches +17; the room above that is for
// a magic item or a spell's bonus.
export const TRAY_MODIFIER_LIMIT = 30;

// The dice the tray offers, in the order its buttons are laid.
export const TRAY_DIE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;

// How many of one die a tap can gather; more than this is typed.
export const TRAY_DICE_PER_KIND = 20;

// The dice gathered by tapping, and the flat bonus beside them.
export type TrayPool = { dice: Partial<Record<number, number>>; bonus: number };

export const EMPTY_TRAY_POOL: TrayPool = { dice: {}, bonus: 0 };

export function trayAddDie(pool: TrayPool, sides: number): TrayPool {
  const count = Math.min(TRAY_DICE_PER_KIND, (pool.dice[sides] ?? 0) + 1);
  return { ...pool, dice: { ...pool.dice, [sides]: count } };
}

// "1d20+2d6+3": the biggest die first, the bonus last. Empty while no die is
// in the pool, because a bonus alone is not a roll.
export function trayPoolExpression(pool: TrayPool): string {
  const dice = [...TRAY_DIE_SIDES]
    .sort((a, b) => b - a)
    .filter((sides) => (pool.dice[sides] ?? 0) > 0)
    .map((sides) => `${pool.dice[sides]}d${sides}`);
  if (!dice.length) return "";
  const bonus = Math.max(-TRAY_MODIFIER_LIMIT, Math.min(TRAY_MODIFIER_LIMIT, Math.trunc(pool.bonus)));
  return `${dice.join("+")}${bonus > 0 ? `+${bonus}` : bonus < 0 ? `${bonus}` : ""}`;
}
