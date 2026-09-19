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

// A plain system line carries no type, only its words, so the painting is
// picked from them. A die is matched after a count too ("2d6"), hence the
// lookbehind rather than a word boundary. Order matters: the first match
// wins, and the bell is the catch-all for "the table is being told something".
const SYSTEM_LINE_RULES: Array<[RegExp, string]> = [
  [/(?<![a-z])d100\b|\bpercentile\b/i, "die-d100"],
  [/(?<![a-z])d12\b/i, "die-d12"],
  [/(?<![a-z])d10\b/i, "die-d10"],
  [/(?<![a-z])d8\b/i, "die-d8"],
  [/(?<![a-z])d6\b/i, "die-d6"],
  [/(?<![a-z])d4\b/i, "die-d4"],
  [/(?<![a-z])d20\b|\b(rolls?|rolled|rerolls?|dice|saving throw|check)\b/i, "die-d20"],
  [/\blevel(s|ed)? up\b|\breach(es|ed)? level\b/i, "rest-level-up"],
  [/\blong rest\b/i, "rest-long"],
  [/\bshort rest\b|\brests?\b/i, "rest-short"],
  [/\b(dies|died|death|slain|falls unconscious|fallen)\b/i, "cue-death"],
  [/\b(heals?|healed|recovers?|stabili[sz]ed?)\b/i, "cue-heal"],
  [/\b(combat|initiative|encounter|battle|ambush|fight)\b/i, "cue-battle"],
  [/\b(gold|coins?|gp|sp|cp|paid|buys?|sells?|sold|bought)\b/i, "cue-coin"],
  [/\b(travel(s|led)?|arrives?|arrived|journey|sets? out|departs?)\b/i, "cue-travel"],
  [/\b(x-card|paused|pause)\b/i, "cue-calm"],
];

export function systemLineGlyph(content: string): string {
  for (const [pattern, glyph] of SYSTEM_LINE_RULES) {
    if (pattern.test(content)) {
      return glyph;
    }
  }
  return "cue-bell";
}
