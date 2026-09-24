// The first paragraph of a passage, trimmed at a sentence when it runs
// long, with the Markdown emphasis the DM sometimes writes in stripped
// away. Pure, so both the title screen's glance (server) and the table's
// chronicle scroll (browser) can share it.
const RECAP_LIMIT = 360;

export function clipRecap(content: string, limit = RECAP_LIMIT): string {
  const paragraph = content
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((part) =>
      part
        // Inline roll markers render as cards in the transcript; here they
        // are noise (src/app/campaigns/[campaignId]/MessageContent.tsx).
        .replace(/\[roll:[^\]]+\]/g, " ")
        .replace(/[*_`#>]+/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .find((part) => part.length > 0);
  if (!paragraph) {
    return "";
  }
  if (paragraph.length <= limit) {
    return paragraph;
  }
  const window = paragraph.slice(0, limit);
  const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (sentenceEnd > limit * 0.45) {
    return window.slice(0, sentenceEnd + 1);
  }
  const wordEnd = window.lastIndexOf(" ");
  return `${window.slice(0, wordEnd > 0 ? wordEnd : limit).trimEnd()}…`;
}
