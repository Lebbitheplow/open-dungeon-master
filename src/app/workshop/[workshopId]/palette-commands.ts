import type { PaletteCommand } from "@/components/CommandPalette";
import { WORKSHOP_SYSTEMS, type SystemId } from "@/app/workshop/[workshopId]/systems";

// The workshop's command palette, derived from the systems the hub lists:
// one "jump" per system, and one "create" for every system whose panel can
// open its own editor when asked.
//
// Asking is the tour's prepare broadcast (src/lib/tours/prepare.ts): the page
// knows nothing about a panel's editor, the panel does, and it already
// answers these names for the guided tours. The palette is a second caller of
// the same names, so it can never open something the panel's own "New"
// button does not.

const GLYPH: Record<SystemId, string> = {
  storyboard: "system-storyboard",
  party: "system-party",
  maps: "system-maps",
  region: "system-region",
  encounters: "system-encounters",
  cast: "system-cast",
  factions: "system-factions",
  bestiary: "system-bestiary",
  homebrew: "system-homebrew",
  lore: "system-lore",
  tables: "system-tables",
  rules: "system-rules",
  plugin: "system-plugin",
  share: "system-share",
};

export const SYSTEM_CREATE: Partial<Record<SystemId, { label: string; prepare: string; keywords: string[] }>> = {
  maps: { label: "New battle map", prepare: "open-map-create", keywords: ["create", "add", "map", "room"] },
  encounters: { label: "New encounter", prepare: "open-encounter-editor", keywords: ["create", "add", "fight"] },
  cast: { label: "New NPC", prepare: "open-npc-editor", keywords: ["create", "add", "person", "character"] },
  bestiary: { label: "Build a monster", prepare: "open-monster-build", keywords: ["create", "new", "add", "creature"] },
  homebrew: { label: "New homebrew", prepare: "open-homebrew-editor", keywords: ["create", "add", "item", "spell", "option"] },
  lore: { label: "New lore entry", prepare: "open-lore-editor", keywords: ["create", "add", "fact", "place"] },
  tables: { label: "New roll table", prepare: "open-table-editor", keywords: ["create", "add", "random"] },
  plugin: { label: "Open the world pack wizard", prepare: "open-plugin-wizard", keywords: ["create", "new", "pack", "plugin"] },
};

export function workshopCommands({
  current,
  phrase,
  onJump,
  onCreate,
  onHub,
  onHelp,
}: {
  // The system on screen, or null on the hub.
  current: SystemId | null;
  // Each system's live count phrase, for the quiet line under its name.
  phrase: (id: SystemId) => string;
  onJump: (id: SystemId) => void;
  onCreate: (id: SystemId, prepare: string) => void;
  onHub: () => void;
  onHelp: () => void;
}): PaletteCommand[] {
  const jumps: PaletteCommand[] = WORKSHOP_SYSTEMS.filter((system) => system.id !== current).map((system) => ({
    id: `go-${system.id}`,
    label: `Go to ${system.label}`,
    hint: `${system.blurb} · ${phrase(system.id)}`,
    group: "Jump to a system",
    glyph: GLYPH[system.id],
    keywords: ["open", "jump", system.id],
    onSelect: () => onJump(system.id),
  }));
  const creates: PaletteCommand[] = WORKSHOP_SYSTEMS.flatMap((system) => {
    const create = SYSTEM_CREATE[system.id];
    return create
      ? [
          {
            id: `new-${system.id}`,
            label: create.label,
            hint: `In ${system.label}`,
            group: "Create an entry",
            glyph: GLYPH[system.id],
            keywords: [...create.keywords, system.label],
            onSelect: () => onCreate(system.id, create.prepare),
          },
        ]
      : [];
  });
  const here: PaletteCommand[] = [
    ...(current
      ? [{ id: "hub", label: "Back to the hub", hint: "Every system at a glance", group: "This workshop", glyph: "tab-campaigns", keywords: ["home", "cards"], onSelect: onHub }]
      : []),
    { id: "help", label: "Guides and tours", hint: "How this works, and the walkthroughs", group: "This workshop", glyph: "tab-reference", keywords: ["help", "tour", "guide"], onSelect: onHelp },
  ];
  return [...jumps, ...creates, ...here];
}
