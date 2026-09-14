import { deleteSourceChunks, replaceSourceChunks } from "@/lib/db/rules";
import { chunkHouseRules, HOUSE_RULES_MAX } from "@/lib/dm/rules-logic";
import type { WorldLoreEntry } from "@/lib/dm/world-lore-logic";
import { extractPdfText } from "@/lib/pdf/text";
import { readUploadedPdf } from "@/lib/uploads-store";

// A PDF on a lore entry tagged "rules" feeds the rules retrieval (docs/vtt-
// parity-implementation-plan.md section 5.3): its text is extracted once
// and chunked like the house rules, under the entry's id as the source, so
// Ask and the turn's rules block can quote a sourcebook the table owns.
// Any other entry's PDF is only a page to read.

export const RULES_TAG = "rules";
// A sourcebook can run long; the chunker gets this much of it.
const TEXT_CAP = 200_000;

export function feedsRules(entry: Pick<WorldLoreEntry, "tags" | "attachmentPath">): boolean {
  return Boolean(entry.attachmentPath) && entry.tags.some((tag) => tag.toLowerCase() === RULES_TAG);
}

// Pure: the chunks a PDF's text becomes, headed by the entry's title.
export function chunksForAttachment(title: string, text: string): Array<{ heading: string; text: string }> {
  const clipped = text.slice(0, TEXT_CAP);
  const out: Array<{ heading: string; text: string }> = [];
  // The chunker reads a house-rules sized window; a book is walked in
  // windows, split on a blank line so a paragraph is never cut in two.
  let at = 0;
  while (at < clipped.length) {
    let end = Math.min(clipped.length, at + HOUSE_RULES_MAX);
    if (end < clipped.length) {
      const gap = clipped.lastIndexOf("\n\n", end);
      if (gap > at + HOUSE_RULES_MAX / 2) {
        end = gap;
      }
    }
    for (const chunk of chunkHouseRules(clipped.slice(at, end))) {
      out.push({ heading: chunk.heading || title, text: chunk.text });
    }
    at = end;
  }
  return out;
}

// Rebuilds (or removes) the entry's chunks. Fire and forget from the
// routes: the entry saved already, and retrieval catches up.
export async function ingestLoreAttachment(entry: WorldLoreEntry): Promise<number> {
  if (!feedsRules(entry)) {
    deleteSourceChunks(entry.campaignId, entry.id);
    return 0;
  }
  const bytes = await readUploadedPdf(entry.attachmentPath);
  if (!bytes) {
    deleteSourceChunks(entry.campaignId, entry.id);
    return 0;
  }
  const chunks = chunksForAttachment(entry.title, extractPdfText(bytes));
  replaceSourceChunks(entry.campaignId, entry.id, chunks);
  return chunks.length;
}

export function dropLoreAttachment(campaignId: string, entryId: string) {
  deleteSourceChunks(campaignId, entryId);
}
