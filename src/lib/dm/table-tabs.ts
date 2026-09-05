// Which tabs the play table's side panel offers, and in what order.
//
// The list used to be assembled inline in buildPanelTabs, one conditional
// spread per tab, which was fine while the only gated tabs were the DM
// console and Context. The Lead tab makes it three authorities deciding
// four tabs (the DM seat, the lead seat, story authority, the battle map),
// and the pairing of "who sees it" with "what label and icon it gets" hid
// the ordering rule in a wall of JSX. So the decision lives here, as a pure
// function over booleans, and the presentation stays in SessionTabs.
//
// Pure by design: no "@/" imports and no React, so
// scripts/test-table-tabs.mjs can import it directly.

export type TableTabId =
  | "dm"
  | "lead"
  | "party"
  | "battle"
  | "map"
  | "story"
  | "notes"
  | "chat"
  | "context"
  | "settings";

export type TableTabInput = {
  // A battle map is live, so the tactical tab has something to show.
  hasBattleMap: boolean;
  mapsEnabled: boolean;
  // The campaign has loaded; Setup (and Context) render from it.
  hasSettings: boolean;
  // The Context tab shows what the DM was actually sent, which includes the
  // secret arc and the DM outline. Its route is gated on story authority, so
  // offering the tab to anyone else only ever produces a 403 and a broken
  // panel. That authority is the party lead in an AI campaign and the DM in a
  // human-run one (src/lib/dm/viewer.ts).
  secretStory: boolean;
  // Holds the DM seat: the console is the whole of running the table by
  // hand, so it leads the rail for whoever is doing it and does not exist
  // for anyone else.
  adjudicates: boolean;
  // Owns the table: invites, campaign details, the lead seat. Distinct from
  // story authority, because a lead at a human-DM table keeps these while
  // the DM keeps the story, and the tab exists for both halves.
  isLead: boolean;
};

// The DM console first, then the lead's desk, then the tabs everyone shares.
// The two seats lead the rail because they are the tabs with work waiting in
// them; a player never sees either, so for them Party stays first as it
// always has.
export function visiblePanelTabs({
  hasBattleMap,
  mapsEnabled,
  hasSettings,
  secretStory,
  adjudicates,
  isLead,
}: TableTabInput): TableTabId[] {
  const tabs: TableTabId[] = [];
  if (adjudicates) {
    tabs.push("dm");
  }
  if (isLead) {
    tabs.push("lead");
  }
  tabs.push("party");
  if (hasBattleMap) {
    tabs.push("battle");
  }
  if (mapsEnabled) {
    tabs.push("map");
  }
  tabs.push("story", "notes", "chat");
  if (hasSettings && secretStory) {
    tabs.push("context");
  }
  if (hasSettings) {
    tabs.push("settings");
  }
  return tabs;
}
