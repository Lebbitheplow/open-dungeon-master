// The health word on a token ring: the only hit-point signal a player gets
// about an enemy, and the same one the DM gets in words beside the bar.
// Thresholds are fixed fractions of maximum hit points so the word is a
// fact about the fight and not a feeling. Pure and dependency-free.

export type HealthWord = "unharmed" | "scratched" | "bloodied" | "critical" | "down" | "dead";

export function healthWord(
  currentHp: number,
  maxHp: number,
  options: { dead?: boolean } = {},
): HealthWord {
  if (options.dead) {
    return "dead";
  }
  if (currentHp <= 0) {
    return "down";
  }
  const ratio = currentHp / Math.max(1, maxHp);
  if (ratio > 0.9) {
    return "unharmed";
  }
  if (ratio > 0.5) {
    return "scratched";
  }
  if (ratio > 0.25) {
    return "bloodied";
  }
  return "critical";
}

// Ring stroke per word: emerald to amber to ember, a dashed grey for down,
// and stone for dead. The dash is the renderer's; the colour is here so the
// tracker and the board agree.
export const HEALTH_RING: Record<HealthWord, string> = {
  unharmed: "#4ade80",
  scratched: "#a3e635",
  bloodied: "#d4ab3a",
  critical: "#e0703a",
  down: "#78716c",
  dead: "#44403c",
};

export const HEALTH_LABEL: Record<HealthWord, string> = {
  unharmed: "Unharmed",
  scratched: "Scratched",
  bloodied: "Bloodied",
  critical: "Near collapse",
  down: "Down",
  dead: "Dead",
};
