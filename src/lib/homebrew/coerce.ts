// The small readers every homebrew normalizer shares: text, numbers and a
// pick from a list, each forgiving of whatever a client sent.

export type Raw = Record<string, unknown>;

export function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function num(value: unknown): number | null {
  const number =
    typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = num(value);
  return number === null ? fallback : Math.min(max, Math.max(min, Math.round(number)));
}

export function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}
