// Which painting stands for which part of the running session. Names are
// files under public/assets/icons/glyph, without the extension. Kept free of
// React so the choices are testable (scripts/test-session-glyphs.mjs).

import type { TableTabId } from "@/lib/dm/table-tabs";
import type { InputKind } from "@/lib/campaign-types";

export const TAB_GLYPHS: Record<TableTabId, string> = {
  dm: "tab-dm",
  lead: "tab-lead",
  party: "tab-party",
  battle: "tab-battle",
  map: "tab-map",
  story: "tab-story",
  notes: "tab-notes",
  chat: "tab-chat",
  context: "tab-context",
  settings: "tab-settings",
};

// The "Table" cell of the phone's bottom bar: the transcript itself.
export const TABLE_GLYPH = "tab-session";

// Second-level pills (SubTabs). A panel may pass a section this map does not
// know; the pill then keeps the line icon it was given.
export const SUBTAB_GLYPHS: Record<string, string> = {
  story: "tab-story",
  quests: "tab-quests",
  timeline: "tab-timeline",
  facts: "tab-facts",
  log: "tab-log",
  party: "tab-party",
  bonds: "tab-bonds",
  factions: "tab-factions",
  market: "tab-market",
  journal: "tab-journal",
  loot: "tab-loot",
  shop: "tab-shop",
  trade: "tab-trade",
  handout: "tab-handout",
  reference: "tab-reference",
};

export const MODE_GLYPHS: Record<InputKind, string> = {
  do: "rest-initiative",
  say: "cue-turn",
  ooc: "skill-persuasion",
  lead: "tab-lead",
  narrate: "tab-dm",
};
