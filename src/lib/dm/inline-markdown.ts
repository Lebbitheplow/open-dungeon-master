// The emphasis a model writes into its narration: **bold** and *italic*.
// The chronicle used to print the asterisks. This is deliberately not a
// markdown engine: narration is prose, so only emphasis is read, and nothing
// here ever produces HTML (the caller renders spans).

export type InlineSpan = { text: string; bold: boolean; italic: boolean };

// A marker opens against a word and closes against a word, so "5 * 3" and a
// footnote star stay what they are.
const EMPHASIS = /(\*\*\*|\*\*|\*)(?=[^*\s])([^*]*?[^*\s])\1/g;

// A passage is cut into speech and narration before it reaches here, and a
// draft is cut off mid-stream, so half of a pair is normal. A lone ** is
// never prose; drop it rather than print it.
function dropStray(text: string): string {
  return text.replace(/\*{2,}/g, "");
}

export function parseInlineMarkdown(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const push = (chunk: string, bold: boolean, italic: boolean) => {
    if (!chunk) {
      return;
    }
    const last = spans[spans.length - 1];
    if (last && last.bold === bold && last.italic === italic) {
      last.text += chunk;
    } else {
      spans.push({ text: chunk, bold, italic });
    }
  };
  let cursor = 0;
  for (const match of text.matchAll(EMPHASIS)) {
    push(dropStray(text.slice(cursor, match.index)), false, false);
    const marker = match[1];
    push(match[2], marker.length >= 2, marker.length !== 2);
    cursor = match.index + match[0].length;
  }
  push(dropStray(text.slice(cursor)), false, false);
  return spans;
}
