// Vague enemy health states, the only HP signal clients ever receive.
// Dependency-free so client components can import it.

export type HealthState = "healthy" | "wounded" | "bloodied" | "near death" | "dead";

export function healthState(currentHp: number, maxHp: number): HealthState {
  if (currentHp <= 0) {
    return "dead";
  }
  const ratio = currentHp / Math.max(1, maxHp);
  if (ratio <= 0.25) {
    return "near death";
  }
  if (ratio <= 0.5) {
    return "bloodied";
  }
  if (ratio <= 0.75) {
    return "wounded";
  }
  return "healthy";
}

export const HEALTH_COLORS: Record<HealthState, string> = {
  healthy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  wounded: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  bloodied: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  "near death": "bg-red-500/15 text-red-300 border-red-500/30",
  dead: "bg-stone-500/15 text-stone-400 border-stone-500/30",
};
