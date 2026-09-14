// One colour per damage type, used by every effect the board plays and by
// nothing else: the palette is how a fireball and a ray of frost read as
// different things without a sprite sheet. Pure and dependency-free so the
// FX planner test and the client both import it.
//
// The rule from the design language: light comes from gold, danger comes
// from ember, and the weapon types are bone so a sword never competes with a
// spell. Everything else is the colour the fiction already gives it.

export type DamageTone = {
  // The main stroke and particle colour.
  color: string;
  // A paler edge for the burst and the rim flash.
  edge: string;
  // How the burst behaves on the particle canvas.
  burst: "spark" | "shard" | "mist" | "ring" | "drip" | "bloom";
};

export const DAMAGE_PALETTE: Record<string, DamageTone> = {
  fire: { color: "#e0703a", edge: "#ffbe8f", burst: "spark" },
  cold: { color: "#9fe3f5", edge: "#e6fbff", burst: "shard" },
  lightning: { color: "#d7c8ff", edge: "#ffffff", burst: "spark" },
  acid: { color: "#b6e33a", edge: "#e9ffa6", burst: "drip" },
  poison: { color: "#7f8f2b", edge: "#c9d67a", burst: "mist" },
  necrotic: { color: "#5b3a8a", edge: "#a985d9", burst: "mist" },
  radiant: { color: "#f4d47a", edge: "#fff8e1", burst: "bloom" },
  force: { color: "#b8a6f5", edge: "#ece6ff", burst: "ring" },
  psychic: { color: "#e055c4", edge: "#ffc2f0", burst: "ring" },
  thunder: { color: "#a8a29e", edge: "#e7e5e4", burst: "ring" },
  bludgeoning: { color: "#d6cfc2", edge: "#f5f1e8", burst: "shard" },
  piercing: { color: "#d6cfc2", edge: "#f5f1e8", burst: "shard" },
  slashing: { color: "#d6cfc2", edge: "#f5f1e8", burst: "shard" },
};

// Not a damage type, but a tone the same renderers use.
export const HEAL_TONE: DamageTone = { color: "#7ed6a4", edge: "#d4ab3a", burst: "bloom" };
export const TELEPORT_TONE: DamageTone = { color: "#8b6fd6", edge: "#d9ccff", burst: "mist" };
export const NEUTRAL_TONE: DamageTone = { color: "#d6cfc2", edge: "#f5f1e8", burst: "shard" };

export function damageTone(type: string | undefined | null): DamageTone {
  if (!type) {
    return NEUTRAL_TONE;
  }
  return DAMAGE_PALETTE[type.trim().toLowerCase()] ?? NEUTRAL_TONE;
}
