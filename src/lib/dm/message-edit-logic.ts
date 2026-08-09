// Lead-only inline correction of a DM narration.
//
// The interaction is ported from NE-P's InlineMessageEditor
// (src/components/message/InlineMessageEditor.tsx, MIT, Copyright (c) 2026
// Sagesheep): autofocus, auto-grow, Enter saves, Escape cancels. The
// validation below has no NE-P counterpart, because NE-P has nothing like
// ODM's inline dice cards.
//
// Scope is deliberately narrow: this fixes what the DM SAID, not what
// happened. Nothing here touches sheets, facts, encounter state or the arc,
// and it never re-runs the model. When the mechanics themselves are wrong,
// chapter rollback (src/lib/dm/rollback.ts) is the tool, not this.
//
// Dependency-free so scripts/test-message-edit.mjs can import it directly.

// Matches the marker finalize() splices into DM content and the one
// MessageList renders dice cards from. Kept in sync with ROLL_MARKER there.
const ROLL_MARKER = /\[roll:([0-9a-f-]{36})\]/g;

export const MAX_EDITED_LENGTH = 12_000;

export function extractRollMarkers(content: string): string[] {
  return Array.from(content.matchAll(ROLL_MARKER)).map((match) => match[0]);
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export type EditCheck = { ok: true; content: string } | { ok: false; reason: string };

// The correctness core. A "[roll:<id>]" marker is the only link between the
// narration and the dice record; drop one in an edit and the roll card
// silently disappears from the transcript, leaving prose that describes a
// roll nobody can audit. So an edit must carry exactly the same multiset of
// markers as the original.
//
// Order is deliberately NOT enforced. A lead reordering paragraphs around a
// roll card is doing something legitimate, and the cards render wherever the
// markers sit; only presence and count carry meaning.
export function checkEdit(original: string, edited: string): EditCheck {
  const content = edited.trim();
  if (!content) {
    return { ok: false, reason: "The narration cannot be empty." };
  }
  if (content.length > MAX_EDITED_LENGTH) {
    return { ok: false, reason: "That is longer than a narration can be." };
  }

  const before = countBy(extractRollMarkers(original));
  const after = countBy(extractRollMarkers(content));

  for (const [marker, count] of before) {
    const now = after.get(marker) ?? 0;
    if (now < count) {
      return {
        ok: false,
        reason: `That edit drops a dice roll (${marker}). Keep every roll marker so the dice stay in the record.`,
      };
    }
    if (now > count) {
      return {
        ok: false,
        reason: `That edit repeats a dice roll (${marker}). Each roll may appear once.`,
      };
    }
  }
  for (const marker of after.keys()) {
    if (!before.has(marker)) {
      return {
        ok: false,
        reason: `That edit adds a dice roll (${marker}) the turn never made.`,
      };
    }
  }

  return { ok: true, content };
}

// An edit replaces the take the table is reading and leaves the other takes
// alone, matching how a continue behaves, so the reroll invariant
// (content === variants[variantIndex]) still holds and the lead can still
// browse back to an earlier wording.
export function replaceSelectedTake(
  variants: string[],
  index: number,
  content: string,
): string[] {
  if (index < 0 || index >= variants.length) {
    return variants;
  }
  return variants.map((variant, position) => (position === index ? content : variant));
}
