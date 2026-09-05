import type { BeatKind, BeatLinks, BoardInventory } from "@/lib/workshop/board";

// What a storyboard card looks like and what it can point at, shared by the
// DM console's list and the workshop's board so a kind is the same colour
// and a link the same field wherever a card is drawn.

// The border a card wears in the list, keyed to the kind. Dim on purpose: the
// list is read by title, the colour is only there to tell a fight from a
// secret at a glance.
export const KIND_TONE: Record<BeatKind, string> = {
  setting: "border-emerald-800/60",
  backstory: "border-stone-600",
  event: "border-amber-700/60",
  encounter: "border-red-800/60",
  hook: "border-sky-800/60",
  secret: "border-violet-800/60",
  npc_moment: "border-orange-800/60",
};

// The same hues as KIND_TONE, as a small chip for the board's cards, where
// the card border is the panel's and the kind has to be read on its own.
export const KIND_CHIP: Record<BeatKind, string> = {
  setting: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  backstory: "border-stone-500/50 bg-stone-500/10 text-stone-300",
  event: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  encounter: "border-red-500/40 bg-red-500/10 text-red-300",
  hook: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  secret: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  npc_moment: "border-orange-500/40 bg-orange-500/10 text-orange-300",
};

export const beatInput =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-amber-500/50 focus:outline-none";

// Link field, the inventory bucket it picks from, the label the editor shows,
// and the one word a card chip has room for.
export const LINK_FIELDS: Array<[keyof BeatLinks, keyof BoardInventory, string, string]> = [
  ["npcId", "npcs", "Who", "who"],
  ["mapId", "maps", "On which map", "map"],
  ["encounterId", "encounters", "Which prepared fight", "fight"],
  ["locationId", "locations", "Where", "place"],
];
