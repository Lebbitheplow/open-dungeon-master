"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { inlineText, parseBook, parseInline, type BookBlock, type InlineNode } from "@/lib/rulebook/markdown";
import { stem } from "@/lib/rulebook/search";
import type { RulebookPageResponse } from "@/lib/rulebook/types";

// One page of the rulebook, set like a printed page: the running head, the
// title lettered over a painted rule, the text with a drop cap where a
// chapter opens, tables striped like the handbook's, sidebars boxed, and a
// monster's statistics on the stat block's cream card with its red rules.
// The folio and the neighbouring pages close it.
//
// Words the reader searched for are inked over with a highlighter stroke,
// and a spell or magic item named in italics is a link to its own page.

export type OpenPage = (id: string, at?: string) => void;

type Ctx = {
  terms: string[];
  // Lettered in Cinzel, whose 1 reads as an I: digits go in the text face.
  display?: boolean;
  // Lower-cased spell and item titles to their page ids.
  xrefs: Map<string, string>;
  onOpen: OpenPage;
};

const ABILITIES = "STR DEX CON INT WIS CHA";

// Digits in display lettering, set in the text face.
export function Digits({ text }: { text: string }) {
  if (!/\d/.test(text)) return <>{text}</>;
  return (
    <>
      {text.split(/(\d+)/).map((part, index) =>
        index % 2 ? (
          <span key={index} className="rb-num">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function marked(text: string, terms: string[], key: string, display = false): ReactNode {
  if (!terms.length && !(display && /\d/.test(text))) return text;
  const parts = text.split(/([A-Za-z0-9]+(?:['’][A-Za-z]+)?)/);
  return parts.map((part, index) => {
    if (index % 2 === 0 || !part) return part;
    const key2 = stem(part);
    const body = display ? <Digits key={`${key}-d${index}`} text={part} /> : part;
    if (terms.some((term) => key2 === term || (term.length >= 3 && key2.startsWith(term)))) {
      return (
        <mark key={`${key}-${index}`} className="rb-mark">
          {body}
        </mark>
      );
    }
    return body;
  });
}

function Inline({ nodes, ctx, prefix }: { nodes: InlineNode[]; ctx: Ctx; prefix: string }) {
  return (
    <>
      {nodes.map((node, index) => {
        const key = `${prefix}-${index}`;
        if (typeof node === "string") return <Fragment key={key}>{marked(node, ctx.terms, key, ctx.display)}</Fragment>;
        const inner = <Inline nodes={node.children} ctx={ctx} prefix={key} />;
        const target = node.page ?? (node.italic && !node.bold ? ctx.xrefs.get(inlineText(node.children).toLowerCase()) : undefined);
        let body: ReactNode = inner;
        if (node.bold && node.italic) body = <strong className="rb-bi">{inner}</strong>;
        else if (node.bold) body = <strong>{inner}</strong>;
        else if (node.italic) body = <em>{inner}</em>;
        if (target) {
          return (
            <button key={key} type="button" className="rb-xref" onClick={() => ctx.onOpen(target)}>
              {body}
            </button>
          );
        }
        return <Fragment key={key}>{body}</Fragment>;
      })}
    </>
  );
}

function Text({ text, ctx, prefix }: { text: string; ctx: Ctx; prefix: string }) {
  const nodes = useMemo(() => parseInline(text), [text]);
  return <Inline nodes={nodes} ctx={ctx} prefix={prefix} />;
}

// A list item that is exactly a spell's name (the class spell lists) links
// to the spell.
function ListItem({ text, ctx, prefix }: { text: string; ctx: Ctx; prefix: string }) {
  const target = ctx.xrefs.get(text.trim().toLowerCase());
  if (target && !/[*[]/.test(text)) {
    return (
      <button type="button" className="rb-xref" onClick={() => ctx.onOpen(target)}>
        {marked(text, ctx.terms, prefix)}
      </button>
    );
  }
  return <Text text={text} ctx={ctx} prefix={prefix} />;
}

const HEADING_TAG = ["h2", "h3", "h4", "h5", "h6", "h6"] as const;

// "**Casting Time:** 1 action", "**Armor Class** 19": a labelled line, set
// tight like the handbook's property lines rather than as a paragraph.
function isPropLine(text: string): boolean {
  return /^\*\*[^*]+\*\*/.test(text) && text.length < 240;
}

function Block({ block, ctx, index, dropCap }: { block: BookBlock; ctx: Ctx; index: number; dropCap: boolean }) {
  const key = `b${index}`;
  // The first few blocks ink in one after another as the page lands.
  const style = index < 10 ? { animationDelay: `${120 + index * 45}ms` } : undefined;
  switch (block.kind) {
    case "heading": {
      const Tag = HEADING_TAG[block.level - 1] ?? "h6";
      return (
        <Tag className={cn("rb-h", `rb-h${block.level}`)} data-anchor={block.anchor} style={style}>
          <Text text={block.text} ctx={{ ...ctx, display: true }} prefix={key} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className={cn(isPropLine(block.text) && "rb-prop", dropCap && "rb-dropcap")} style={style}>
          {block.text.split("\n").map((line, lineIndex) => (
            <Fragment key={lineIndex}>
              {lineIndex ? <br /> : null}
              <Text text={line} ctx={ctx} prefix={`${key}-${lineIndex}`} />
            </Fragment>
          ))}
        </p>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="rb-list" style={style}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <ListItem text={item} ctx={ctx} prefix={`${key}-${itemIndex}`} />
            </li>
          ))}
        </Tag>
      );
    }
    case "table": {
      const abilities = block.head.join(" ").toUpperCase() === ABILITIES;
      return (
        <div className={cn("rb-table-wrap", abilities && "rb-abilities")} style={style}>
          <table className="rb-table">
            {block.caption ? (
              <caption>
                <Text text={block.caption} ctx={{ ...ctx, display: true }} prefix={`${key}-c`} />
              </caption>
            ) : null}
            <thead>
              <tr>
                {block.head.map((cell, cellIndex) => (
                  <th key={cellIndex} style={{ textAlign: block.align[cellIndex] ?? undefined }}>
                    <Text text={cell} ctx={ctx} prefix={`${key}-h${cellIndex}`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} style={{ textAlign: block.align[cellIndex] ?? undefined }}>
                      <Text text={cell} ctx={ctx} prefix={`${key}-${rowIndex}-${cellIndex}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "sidebar":
      return (
        <aside className="rb-sidebar" data-anchor={block.anchor} style={style}>
          {block.title ? (
            <p className="rb-sidebar-title">
              <Text text={block.title} ctx={{ ...ctx, display: true }} prefix={`${key}-t`} />
            </p>
          ) : null}
          {block.blocks.map((inner, innerIndex) => (
            <Block key={innerIndex} block={inner} ctx={ctx} index={99} dropCap={false} />
          ))}
        </aside>
      );
    case "rule":
      return <hr className="rb-rule" />;
    default:
      return null;
  }
}

// The blocks a search landed on: the passage under the anchor (to the next
// heading of its rank or above), or the page's opening text. Only these wear
// the highlighter, so a common word does not paint the whole page.
function passageRange(blocks: BookBlock[], at: string | undefined): [number, number] {
  const firstHeading = blocks.findIndex((block) => block.kind === "heading");
  if (!at) return [0, firstHeading === -1 ? blocks.length : firstHeading];
  const start = blocks.findIndex((block) => (block.kind === "heading" || block.kind === "sidebar") && block.anchor === at);
  if (start === -1) return [0, blocks.length];
  const head = blocks[start];
  if (head.kind !== "heading") return [start, start + 1];
  const end = blocks.findIndex((block, index) => index > start && block.kind === "heading" && block.level <= head.level);
  return [start, end === -1 ? blocks.length : end];
}

export function RulebookPage({
  data,
  terms,
  at,
  xrefs,
  onOpen,
}: {
  data: RulebookPageResponse;
  terms: string[];
  // The passage a search landed on.
  at?: string;
  xrefs: Map<string, string>;
  onOpen: OpenPage;
}) {
  const { page, chapter, prev, next } = data;
  const blocks = useMemo(() => {
    const all = parseBook(page.md);
    // The entry's italic first line is lettered under the title already.
    const first = all[0];
    if (page.meta && first?.kind === "paragraph" && inlineText(parseInline(first.text)).trim() === page.meta) {
      return all.slice(1);
    }
    return all;
  }, [page.md, page.meta]);
  const ctx: Ctx = { terms, xrefs, onOpen };
  const plain: Ctx = { terms: [], xrefs, onOpen };
  const [from, to] = terms.length ? passageRange(blocks, at) : [0, 0];
  // A chapter's prose opens on an illuminated capital; entries (spells,
  // items, monsters) open on their statistics instead.
  const prose = page.kind === "rules" || page.kind === "class" || page.kind === "race";
  const dropAt = prose
    ? blocks.findIndex((block) => block.kind === "paragraph" && !isPropLine(block.text) && block.text.length > 80)
    : -1;
  const body = blocks.map((block, index) => (
    <Block
      key={index}
      block={block}
      ctx={index >= from && index < to ? ctx : plain}
      index={index}
      dropCap={index === dropAt && dropAt < 3}
    />
  ));

  return (
    <article className="rb-page" data-kind={page.kind}>
      <header className="rb-head">
        <p className="rb-running">
          <span aria-hidden="true">{"❦"}</span> Chapter {chapter.numeral} <span className="rb-dot">&middot;</span>{" "}
          <Digits text={chapter.title} />{" "}
          <span aria-hidden="true">{"❦"}</span>
        </p>
        <h1 className="rb-title">
          <Digits text={page.title} />
        </h1>
        {page.meta || page.family ? (
          <p className="rb-subtitle">
            {page.meta}
            {page.family ? <span className="rb-family">{page.family}</span> : null}
          </p>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/ui/divider-rule.webp" alt="" width={512} height={33} className="rb-divider" />
      </header>

      <div className="rb-text">{page.kind === "monster" ? <div className="rb-statblock">{body}</div> : body}</div>

      <footer className="rb-foot">
        {prev ? (
          <button type="button" className="rb-turn-link rb-turn-prev" onClick={() => onOpen(prev.id)}>
            <span aria-hidden="true">&lsaquo;</span> {prev.title}
          </button>
        ) : (
          <span />
        )}
        <span className="rb-folio" aria-label={`Page ${page.folio}`}>
          {page.folio}
        </span>
        {next ? (
          <button type="button" className="rb-turn-link rb-turn-next" onClick={() => onOpen(next.id)}>
            {next.title} <span aria-hidden="true">&rsaquo;</span>
          </button>
        ) : (
          <span />
        )}
      </footer>
    </article>
  );
}
