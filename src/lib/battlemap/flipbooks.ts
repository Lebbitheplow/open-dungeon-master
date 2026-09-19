// Which painted flipbook an effect plays (public/fx, catalogue in
// scripts/vfx-set.mjs). The video model paints magical energy well and drifts
// to red fire for anything mundane, so only the energy damage types, healing,
// death and crits have sheets; a physical hit, a door and a shock ring keep
// the drawn effect alone. Pure, so scripts/test-flipbooks.mjs drives it.
import type { FxEvent } from "@/lib/battlemap/fx-plan";

export const FLIPBOOK_BY_DAMAGE: Record<string, string> = {
  fire: "burst-fire",
  cold: "burst-cold",
  lightning: "burst-lightning",
  acid: "burst-acid",
  poison: "burst-poison",
  necrotic: "burst-necrotic",
  radiant: "burst-radiant",
  force: "burst-force",
  psychic: "burst-psychic",
  thunder: "burst-thunder",
};

// The sheet to play over each target, or null for the drawn effect alone.
export function flipbookFor(fx: Pick<FxEvent, "kind" | "outcome" | "damageType">): string | null {
  if (fx.kind === "heal") return "heal-bloom";
  if (fx.kind === "death") return "death-collapse";
  if (fx.kind !== "attack" && fx.kind !== "spell") return null;
  // A miss paints nothing: the blow never landed.
  if (fx.kind === "attack" && fx.outcome !== "hit" && fx.outcome !== "crit") return null;
  const byType = FLIPBOOK_BY_DAMAGE[(fx.damageType ?? "").toLowerCase()];
  return byType ?? (fx.outcome === "crit" ? "crit-flare" : null);
}

export type FlipbookSheet = { id: string; src: string; frame: number; columns: number; frames: number; fps: number };

// The frame a sheet shows `elapsedMs` into its run, or -1 once it has ended.
export function flipbookFrame(sheet: Pick<FlipbookSheet, "frames" | "fps">, elapsedMs: number): number {
  const frame = Math.floor((elapsedMs / 1000) * sheet.fps);
  return frame >= 0 && frame < sheet.frames ? frame : -1;
}
