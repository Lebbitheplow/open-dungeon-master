// Auto-archiving for the tracked NPC roster.
//
// ODM already measures attention: npc-logic.ts's NpcPressure {ignored,
// engaged} is ticked once per chapter in npc-agency.ts, resetting `ignored`
// whenever the NPC is named and otherwise climbing to a cap of 9. What it has
// never had is anywhere for that measurement to lead. Every tavern keeper the
// DM ever named stays in the Active NPCs prompt block forever, so on a long
// campaign the roster crowds out the people actually in the scene.
//
// The archiving rule and the restore-on-mention behaviour are ported from
// NarrativeEngine-P's npcPressureTracker (src/services/npc/npcPressureTracker.ts,
// MIT, Copyright (c) 2026 Sagesheep). Its per-turn weighted scoring and linear
// decay are deliberately NOT ported: ODM's chapter-cadence counters already
// carry the signal and already feed the prompt, and replacing a working
// measurement to change how it is weighted is not worth a migration.
//
// Dependency-free so scripts/test-npc-archive.mjs can import it directly.

import { normalizeName } from "./entity-logic.ts";

// Chapters of being unmentioned before an NPC leaves the roster. ODM's
// pressureState already calls an NPC "ignored" at 2, which is a behavioural
// note the DM acts on; archiving is a stronger claim, so it waits until the
// counter is most of the way to its cap of 9 and the party has had several
// chapters to bring them back.
export const ARCHIVE_IGNORED_CHAPTERS = 6;

// An NPC the party courted heavily stays on the roster longer, because a
// high engaged count means they mattered recently even if the last stretch
// has been quiet.
export const ARCHIVE_ENGAGED_CEILING = 3;

export type ArchiveCandidate = {
  id: string;
  name: string;
  aliases?: string[];
  ignored: number;
  engaged: number;
  archived?: boolean;
  // Any of these makes the NPC un-archivable. NE-P protects on affinity and a
  // pending shift note; ODM's model is richer, and dropping someone the party
  // is entangled with out of the prompt mid-thread would be a real
  // regression, not just a lost line of context.
  hasRelationship?: boolean;
  hasBond?: boolean;
  hasRomance?: boolean;
  hasPendingGoal?: boolean;
};

export type ArchiveDecision = { archive: boolean; reason: string };

export function shouldArchive(npc: ArchiveCandidate): ArchiveDecision {
  if (npc.archived) {
    return { archive: false, reason: "already archived" };
  }
  if (npc.hasRomance) {
    return { archive: false, reason: "in a romance with the party" };
  }
  if (npc.hasRelationship || npc.hasBond) {
    return { archive: false, reason: "has standing with the party" };
  }
  if (npc.hasPendingGoal) {
    return { archive: false, reason: "has an unfinished goal in motion" };
  }
  if (npc.engaged > ARCHIVE_ENGAGED_CEILING) {
    return { archive: false, reason: "was heavily involved recently" };
  }
  if (npc.ignored < ARCHIVE_IGNORED_CHAPTERS) {
    return { archive: false, reason: "" };
  }
  return {
    archive: true,
    reason: `unmentioned for ${npc.ignored} chapters`,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-bounded, unlike the substring check ODM's chapter tick uses for the
// pressure counters. Archiving is a bigger decision than a counter tick, and
// a short name like "Al" matching inside "always" would resurrect the wrong
// NPC every chapter.
export function mentionsNpc(text: string, npc: ArchiveCandidate): boolean {
  const patterns = [npc.name, ...(npc.aliases ?? [])]
    .map((value) => normalizeName(value ?? ""))
    .filter(Boolean);
  const lower = text.toLowerCase();
  return patterns.some((pattern) =>
    new RegExp(`\\b${escapeRegex(pattern)}\\b`, "i").test(lower),
  );
}

// Naming an archived NPC brings them straight back, so archiving is never a
// dead end: the table does not have to know the roster exists to undo it.
export function findArchivedToRestore(text: string, archived: ArchiveCandidate[]): string[] {
  return archived
    .filter((npc) => npc.archived && mentionsNpc(text, npc))
    .map((npc) => npc.id);
}
