// The content pack's descriptions are markdown-ish and come from five
// sources that each write it a little differently: "***Trait.***" and
// "**_Trait._**" for a bold lead-in, headings that start a block with no
// blank line before them, paragraph breaks written as a line holding one
// space, a caption line stuck to the table under it, a literal "\n" where an
// export escaped twice. Rendering the handful of constructs that appear is
// far cheaper than a markdown dependency, and unknown syntax degrades to
// plain text. Pure, so scripts/test-option-descriptions.mjs can check it.

export type RulesBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; rows: string[] };

export function normalizeRulesText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\[No description provided\]\.?/gi, "")
    .replace(/\*\*\*([^*\n]+?)\*\*\*/g, "**$1**")
    .replace(/\*\*_([^_\n]+?)_\*\*/g, "**$1**")
    .replace(/_\*\*([^*\n]+?)\*\*_/g, "**$1**")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export function parseRulesBlocks(text: string): RulesBlock[] {
  const blocks: RulesBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let table: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
    if (list.length) {
      blocks.push({ kind: "list", items: list });
      list = [];
    }
    if (table.length) {
      blocks.push({ kind: "table", rows: table });
      table = [];
    }
  };
  for (const raw of normalizeRulesText(text).split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", text: heading[1] });
      continue;
    }
    if (line.startsWith("|")) {
      if (paragraph.length || list.length) {
        flush();
      }
      table.push(line);
      continue;
    }
    const item = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (item) {
      if (paragraph.length || table.length) {
        flush();
      }
      list.push(item[1]);
      continue;
    }
    if (list.length || table.length) {
      flush();
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

// The text with its markdown taken out, on one line.
export function stripMarkdown(text: string): string {
  return normalizeRulesText(text)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/(^|\s)[*_]+(?=\S)/g, "$1")
    .replace(/(?<=\S)[*_]+(?=\s|[.,;:!?)]|$)/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The first sentence of a write-up, for a summary line or a hover preview.
export function firstSentence(text: string | null | undefined, max = 160): string | null {
  const plain = stripMarkdown(text ?? "");
  if (!plain) {
    return null;
  }
  const stop = plain.search(/[.!?](\s|$)/);
  const line = stop > 0 ? plain.slice(0, stop + 1) : plain;
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}
