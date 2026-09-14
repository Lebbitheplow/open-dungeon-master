import type { CatalogEntry } from "@/lib/dm/catalog-types";

// The binder's entries in the human DM's console (docs/vtt-parity-
// implementation-plan.md sections 5.2 and 5.7), alongside the same tools
// the model holds.

export const FACTION_ADJUDICATIONS: CatalogEntry[] = [
  {
    name: "adjust_reputation",
    label: "Adjust standing with a faction",
    category: "social",
    summary: "Move the party's reputation with a faction a step or two, minus five to five. Their members' social checks lean on it.",
    fields: [
      { name: "faction", label: "Faction", kind: "text", required: true, placeholder: "The Reed Court" },
      { name: "delta", label: "Change", kind: "number", required: true, min: -2, max: 2 },
      { name: "reason", label: "Why", kind: "text", placeholder: "They returned the abbot's seal" },
    ],
  },
  {
    name: "faction_note",
    label: "Note a faction move",
    category: "world",
    summary: "Record what a faction did or holds as a world fact.",
    fields: [
      { name: "faction", label: "Faction", kind: "text", required: true },
      { name: "note", label: "The fact", kind: "text", required: true },
      { name: "secret", label: "DM only for now", kind: "boolean" },
    ],
  },
];

export const BINDER_ADJUDICATIONS: CatalogEntry[] = [
  {
    name: "show_handout",
    label: "Show a handout",
    category: "table",
    summary: "Put a lore entry or a picture on every player's screen until you take it down.",
    fields: [
      { name: "loreId", label: "Lore entry id", kind: "text", placeholder: "Paste from the binder, or use Show this now there" },
      { name: "imagePath", label: "Or an uploaded picture", kind: "text", placeholder: "/uploads/..." },
      { name: "caption", label: "Caption", kind: "text", placeholder: "Found in the abbot's desk" },
    ],
  },
  {
    name: "dismiss_handout",
    label: "Take the handout down",
    category: "table",
    summary: "Clears the handout from every screen.",
    fields: [{ name: "handoutId", label: "Handout id (blank for the current one)", kind: "text" }],
  },
  {
    name: "set_quest",
    label: "Write a quest",
    category: "story",
    summary: "Add a quest to the party's log, or change one: its title, objectives and status.",
    fields: [
      { name: "questId", label: "Quest id (to change one)", kind: "text" },
      { name: "title", label: "Title", kind: "text", placeholder: "Find the miller's daughter" },
      { name: "objectives", label: "Objectives, one per line", kind: "longtext", placeholder: "Ask at the mill\nSearch the weir" },
      {
        name: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "done", label: "Done" },
          { value: "failed", label: "Failed" },
        ],
      },
      {
        name: "visibility",
        label: "Who reads it",
        kind: "select",
        options: [
          { value: "party", label: "The party" },
          { value: "dm", label: "Only me" },
        ],
      },
    ],
  },
  {
    name: "tick_objective",
    label: "Tick an objective",
    category: "story",
    summary: "Mark one step of a quest done. When every step is done the quest is.",
    fields: [
      { name: "questId", label: "Quest id", kind: "text", required: true },
      { name: "objectiveId", label: "Objective id", kind: "text", required: true },
      { name: "done", label: "Done", kind: "boolean", default: true },
    ],
  },
];
