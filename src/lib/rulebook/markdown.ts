// The markdown the rulebook is written in, parsed into blocks and inline
// runs. Pure, so the reader (RulebookPage.tsx) and the search index
// (search.ts) cut a page into exactly the same headings and anchors.
//
// It knows the SRD conversion's habits and nothing more: # to ###### headings,
// paragraphs, bullet and numbered lists, pipe tables (a bold line right above
// one is its caption), > sidebars (whose first heading or bold line is their
// title), --- rules, ***bold italic***, **bold**, *italic*, and
// [text](page:id) links between pages. No HTML is ever produced from it.

export type TableAlign = "left" | "center" | "right" | null;

export type BookBlock =
  | { kind: "heading"; level: number; text: string; anchor: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; caption?: string; head: string[]; align: TableAlign[]; rows: string[][] }
  | { kind: "sidebar"; title?: string; anchor?: string; blocks: BookBlock[] }
  | { kind: "rule" };

export type InlineNode =
  | string
  | { bold?: boolean; italic?: boolean; page?: string; children: InlineNode[] };

export function anchorSlug(text: string): string {
  return (
    stripInline(text)
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function alignOf(cell: string): TableAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

// A paragraph that is nothing but bold (or bold italic) text: a caption or a
// sidebar's title.
function boldOnly(text: string): string | null {
  const match = /^\*{2,3}([^*]+)\*{2,3}$/.exec(text.trim());
  return match ? match[1].trim() : null;
}

// Anchors are unique on a page: a second "Actions" becomes actions-2.
function claimAnchor(anchors: Map<string, number>, text: string): string {
  const base = anchorSlug(text);
  const seen = anchors.get(base) ?? 0;
  anchors.set(base, seen + 1);
  return seen ? `${base}-${seen + 1}` : base;
}

function parseLines(lines: string[], anchors: Map<string, number>): BookBlock[] {
  const out: BookBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      // The SRD breaks a line only where it means it (a stat block's spell
      // list, one level a line), so a break inside a paragraph is kept.
      out.push({ kind: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push({ kind: "list", ...list });
      list = null;
    }
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      flush();
      index += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const inner: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        inner.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      const blocks = parseLines(inner, anchors);
      let title: string | undefined;
      let anchor: string | undefined;
      const first = blocks[0];
      if (first?.kind === "heading") {
        title = first.text;
        anchor = first.anchor;
        blocks.shift();
      } else if (first?.kind === "paragraph" && boldOnly(first.text)) {
        title = boldOnly(first.text) ?? undefined;
        anchor = title ? claimAnchor(anchors, title) : undefined;
        blocks.shift();
      }
      out.push({ kind: "sidebar", title, anchor, blocks });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const text = heading[2].trim();
      out.push({ kind: "heading", level: heading[1].length, text, anchor: claimAnchor(anchors, text) });
      index += 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push({ kind: "rule" });
      index += 1;
      continue;
    }
    if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1])) {
      // A bold line straight above the table is its caption.
      let caption: string | undefined;
      const lastText = paragraph.length === 1 ? boldOnly(paragraph[0]) : null;
      if (lastText) {
        caption = lastText.replace(/^Table\s*[-:\u2013\u2014]\s*/i, "");
        paragraph = [];
      } else if (!paragraph.length && !list) {
        const previous = out[out.length - 1];
        const previousBold = previous?.kind === "paragraph" ? boldOnly(previous.text) : null;
        if (previousBold) {
          caption = previousBold.replace(/^Table\s*[-:\u2013\u2014]\s*/i, "");
          out.pop();
        }
      }
      flush();
      const head = cells(line);
      const align = cells(lines[index + 1]).map(alignOf);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && TABLE_ROW.test(lines[index])) {
        const row = cells(lines[index]);
        if (row.some((cell) => cell)) rows.push(row);
        index += 1;
      }
      out.push({ kind: "table", caption, head, align, rows });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1].trim());
      index += 1;
      continue;
    }
    if (list) {
      // A wrapped line carries on the item above it.
      const items: string[] = (list as { items: string[] }).items;
      items[items.length - 1] += ` ${line.trim()}`;
      index += 1;
      continue;
    }
    paragraph.push(line.trim());
    index += 1;
  }
  flush();
  return out;
}

export function parseBook(markdown: string): BookBlock[] {
  return parseLines(markdown.replace(/\r\n?/g, "\n").split("\n"), new Map());
}

// ---- inline runs ----

function canOpen(text: string, at: number, run: number): boolean {
  const next = text.charAt(at + run);
  return Boolean(next) && !/\s/.test(next);
}

function findClose(text: string, from: number, run: number): number {
  const marker = "*".repeat(run);
  let at = text.indexOf(marker, from);
  while (at !== -1) {
    const before = text.charAt(at - 1);
    const after = text.charAt(at + run);
    // A single closer may sit against a footnote star ("*mind blank**").
    const exact = run === 3 || (before !== "*" && (after !== "*" || run === 1));
    if (exact && before && !/\s/.test(before)) return at;
    at = text.indexOf(marker, at + 1);
  }
  return -1;
}

export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  let plain = "";
  const push = (node: InlineNode) => {
    if (plain) {
      out.push(plain);
      plain = "";
    }
    out.push(node);
  };
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "[") {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(text.slice(index));
      if (link) {
        const target = link[2].startsWith("page:") ? link[2].slice(5) : undefined;
        if (target) push({ page: target, children: parseInline(link[1]) });
        else plain += link[1];
        index += link[0].length;
        continue;
      }
    }
    if (char === "\\" && /[*_[\]\\]/.test(text.charAt(index + 1))) {
      plain += text.charAt(index + 1);
      index += 2;
      continue;
    }
    if (char === "*") {
      let run = 1;
      while (text.charAt(index + run) === "*" && run < 3) run += 1;
      if (canOpen(text, index, run)) {
        const close = findClose(text, index + run, run);
        if (close !== -1) {
          push({
            bold: run >= 2 || undefined,
            italic: run !== 2 || undefined,
            children: parseInline(text.slice(index + run, close)),
          });
          index = close + run;
          continue;
        }
        // An opener with no closer is a stray from the PDF export: drop it.
        index += run;
        continue;
      }
      plain += "*".repeat(run);
      index += run;
      continue;
    }
    plain += char;
    index += 1;
  }
  if (plain) out.push(plain);
  return out;
}

export function inlineText(nodes: InlineNode[]): string {
  return nodes.map((node) => (typeof node === "string" ? node : inlineText(node.children))).join("");
}

export function stripInline(text: string): string {
  return inlineText(parseInline(text));
}

// Every block as plain text, in reading order: what search indexes.
export function blockText(block: BookBlock): string {
  switch (block.kind) {
    case "heading":
      return stripInline(block.text);
    case "paragraph":
      return stripInline(block.text).replace(/\n/g, " ");
    case "list":
      return block.items
        .map(stripInline)
        .map((item) => (/[.!?:;]$/.test(item) ? item : `${item}.`))
        .join(" ");
    case "table":
      return [block.caption ?? "", block.head.join(" "), ...block.rows.map((row) => row.join(" "))]
        .map(stripInline)
        .join(". ");
    case "sidebar":
      return [block.title ? stripInline(block.title) : "", ...block.blocks.map(blockText)].join(" ");
    default:
      return "";
  }
}
