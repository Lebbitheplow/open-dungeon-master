import type { Chapter } from "@/lib/db/chapters";
import { phraseOffsets } from "@/lib/language/text-logic";

// The initial campaign snapshot can arrive before Chapter 1 is created. The
// Story panel's later /chapters read is the authoritative list until the
// campaign stream catches up. Snapshot/stream rows win for live state, while
// the full read supplies summaries omitted from abridged snapshot rows.
export function visibleStoryChapters(snapshotChapters: Chapter[], fetchedChapters: Chapter[]): Chapter[] {
  const fetchedById = new Map(fetchedChapters.map((chapter) => [chapter.id, chapter]));
  const merged = new Map(fetchedById);

  for (const chapter of snapshotChapters) {
    const full = chapter.abridged ? fetchedById.get(chapter.id) : undefined;
    merged.set(
      chapter.id,
      full
        ? {
            ...full,
            ...chapter,
            summary: full.summary,
            highlights: full.highlights,
            abridged: false,
          }
        : chapter,
    );
  }

  return [...merged.values()].sort((a, b) => a.index - b.index);
}

export function storyPanelArcForCampaign<T extends { campaignId: string }>(
  loaded: T | null,
  campaignId: string,
): T | null {
  return loaded?.campaignId === campaignId ? loaded : null;
}

// A milestone's line on the Log: the character's name before what happened,
// unless the summary already starts with it. "Vex: Vex and Sir Ivo Ashford
// were married" said the name twice (issue 644).
export function milestoneLine(name: string, summary: string): string {
  return phraseOffsets(summary, name).includes(0) ? summary : `${name}: ${summary}`;
}
