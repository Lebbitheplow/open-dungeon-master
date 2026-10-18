// Which tracked NPCs the prompt names, when there are more than it shows
// (docs/agent-context-efficiency-audit-2026-10-17.md F07). The roster used to
// be cut at its first 20 entries in stored order, so on a long campaign the
// innkeeper the party is talking to could be the 21st and fall out while
// someone three towns away rode along. Now the ones at the party's location
// come first, then the ones the scene or the newest lines name, then the rest
// in their usual order; within each tier the order is the stored one, so the
// prompt stays the same from turn to turn while nothing changes.
//
// Dependency-free so scripts/test-npc-rank.mjs can drive it.

import { containsPhrase, textKey } from "../language/text-logic.ts";

export const NPC_PROMPT_MAX = 20;

export type RankableNpc = { name: string; location: string; aliases?: string[] };

export function rankNpcsForPrompt<T extends RankableNpc>(npcs: readonly T[], moment: { location: string; text: string }): T[] {
  const here = textKey(moment.location);
  const tier = (npc: T): number => {
    if (here && npc.location && textKey(npc.location) === here) {
      return 0;
    }
    if (moment.text && [npc.name, ...(npc.aliases ?? [])].some((name) => name && containsPhrase(moment.text, name))) {
      return 1;
    }
    return 2;
  };
  return npcs
    .map((npc, index) => ({ npc, index, tier: tier(npc) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.npc);
}
