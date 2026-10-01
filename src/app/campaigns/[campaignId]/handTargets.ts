import type { HandTargetChip } from "@/app/campaigns/[campaignId]/HandAimBar";
import type { TargetEdge } from "@/lib/battlemap/view-tactics";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Split from Hand.tsx, which offers these chips on the aim bar.
// The chips a raised card can be aimed at: the living enemies, with what the
// board says of each from this character (cover, flanking), and the party.
export function handTargets(
  enemies: PublicEncounter["enemies"],
  sheets: CharacterSheet[],
  selfId: string | undefined,
  edges: Record<string, TargetEdge> | undefined,
): HandTargetChip[] {
  const enemyChips: HandTargetChip[] = enemies
    .filter((enemy) => enemy.status === "alive")
    .map((enemy) => ({
      id: enemy.id,
      name: enemy.name,
      kind: "enemy",
      ac: enemy.ac,
      cr: enemy.cr,
      conditions: enemy.conditions,
      ...(edges?.[enemy.id] ? { edge: edges[enemy.id] } : {}),
      note: [
        enemy.knockedOut ? "knocked out" : enemy.regenerating ? (enemy.regenerating.stopped ? "down, dies at its turn" : "down, regenerates at its turn") : enemy.health,
        edges?.[enemy.id]?.cover ? `${edges[enemy.id].cover === 2 ? "half" : "3/4"} cover` : null,
        edges?.[enemy.id]?.flanking ? "flanked" : null,
        ...enemy.conditions.slice(0, 2),
      ]
        .filter(Boolean)
        .join(" · "),
    }));
  const party: HandTargetChip[] = sheets
    .filter((entry) => !entry.deathSaves?.dead)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: entry.id === selfId ? "self" : "ally",
      conditions: entry.conditions,
      note: `${entry.currentHp}/${effectiveMaxHp(entry)} hp`,
    }));
  return [...enemyChips, ...party];
}
