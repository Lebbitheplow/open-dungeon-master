import {
  BookOpen,
  Dices,
  Globe2,
  LayoutGrid,
  type LucideIcon,
  Map as MapIcon,
  Scale,
  Share2,
  Skull,
  Swords,
  Users,
} from "lucide-react";
import type { WorkshopSummary } from "@/app/workshop/types";

// The ten systems a workshop is made of, and how each one counts itself.
//
// Nine of the counts come straight off the workshop's contents map, which
// /api/workshops/:id already serves per importable kind. The bestiary is the
// exception: homebrew monsters are the builder's, not the workshop's, so they
// are not an importable kind and their count is fetched from the bestiary
// list route by the page. Rules is a yes-or-no rather than a number, and
// Share has nothing to count.

export const WORKSHOP_SYSTEMS = [
  { id: "storyboard", label: "Storyboard", blurb: "Plan the arc", icon: LayoutGrid },
  { id: "maps", label: "Battle maps", blurb: "Rooms to fight in", icon: MapIcon },
  { id: "region", label: "Region", blurb: "The overworld map", icon: Globe2 },
  { id: "encounters", label: "Encounters", blurb: "Fights, budgeted", icon: Swords },
  { id: "cast", label: "Cast", blurb: "NPCs & agendas", icon: Users },
  { id: "bestiary", label: "Bestiary", blurb: "Homebrew monsters", icon: Skull },
  { id: "lore", label: "Lore", blurb: "World facts & places", icon: BookOpen },
  { id: "tables", label: "Tables", blurb: "Roll tables", icon: Dices },
  { id: "rules", label: "Rules", blurb: "House & variant", icon: Scale },
  { id: "share", label: "Share", blurb: "Export a bundle", icon: Share2 },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
}>;

export type SystemId = (typeof WORKSHOP_SYSTEMS)[number]["id"];

export function isSystemId(value: string | null): value is SystemId {
  return WORKSHOP_SYSTEMS.some((system) => system.id === value);
}

// What a card shows big and what the system title says after its name.
// `figure` is null when there is nothing to count (Share) and, for the
// bestiary, while its count is still on the wire.
export type SystemCount = { figure: string | null; phrase: string; total: number };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function systemCount(
  id: SystemId,
  workshop: WorkshopSummary,
  bestiary: number | null,
): SystemCount {
  const contents = workshop.contents;
  switch (id) {
    case "storyboard": {
      const count = contents.storyboard;
      return {
        figure: String(count),
        phrase: count ? "a board in progress" : "no board yet",
        total: count,
      };
    }
    case "maps":
      return { figure: String(contents.maps), phrase: `${contents.maps} in the drawer`, total: contents.maps };
    case "region": {
      const count = contents.overworld;
      return {
        figure: String(count),
        phrase: count ? "the overworld is drawn" : "no overworld yet",
        total: count,
      };
    }
    case "encounters":
      return {
        figure: String(contents.encounters),
        phrase: plural(contents.encounters, "fight", "fights"),
        total: contents.encounters,
      };
    case "cast":
      return {
        figure: String(contents.npcs),
        phrase: plural(contents.npcs, "person", "people"),
        total: contents.npcs,
      };
    case "bestiary":
      return {
        figure: bestiary === null ? null : String(bestiary),
        phrase: bestiary === null ? "counting" : plural(bestiary, "monster", "monsters"),
        total: bestiary ?? 0,
      };
    case "lore": {
      const count = contents.lore + contents.locations;
      return { figure: String(count), phrase: `${count} facts & places`, total: count };
    }
    case "tables":
      return {
        figure: String(contents.tables),
        phrase: plural(contents.tables, "table", "tables"),
        total: contents.tables,
      };
    case "rules":
      return {
        figure: contents.houseRules ? "set" : "none",
        phrase: contents.houseRules ? "house rules set" : "no house rules yet",
        total: 0,
      };
    case "share":
      return { figure: null, phrase: "export a bundle", total: 0 };
  }
}

// "41 pieces of prep": every countable thing in the workshop, for the hub's
// section heading.
export function totalPieces(workshop: WorkshopSummary, bestiary: number | null): number {
  return WORKSHOP_SYSTEMS.reduce(
    (sum, system) => sum + systemCount(system.id, workshop, bestiary).total,
    0,
  );
}
