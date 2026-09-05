"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { splitLoreLinks, type LoreLinkTarget } from "@/lib/dm/world-lore-logic";

// The small markdown a world bible needs, rendered to React and never to
// HTML: headings, bold, italics, code, bullet and numbered lists, and the
// [[Name]] links between documents. Anything else is a paragraph. No
// dependency, no HTML injection, and it reads the same on a phone.

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; text: string };

function blocks(source: string): Block[] {
  const out: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (paragraph.length) {
      out.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
    if (list) {
      out.push({ kind: "list", ...list });
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (!line.trim()) {
      flush();
      continue;
    }
    if (heading) {
      flush();
      out.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (paragraph.length) {
        flush();
      }
      if (!list || list.ordered !== ordered) {
        if (list) {
          out.push({ kind: "list", ...list });
        }
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    if (list) {
      flush();
    }
    paragraph.push(line.trim());
  }
  flush();
  return out;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function inline(text: string, targets: LoreLinkTarget[], onLink?: (target: LoreLinkTarget) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  splitLoreLinks(text, targets).forEach((segment, index) => {
    if (segment.kind === "link") {
      nodes.push(
        segment.target && onLink ? (
          <button
            key={`link-${index}`}
            type="button"
            onClick={() => onLink(segment.target as LoreLinkTarget)}
            className="rounded-sm border-b border-dotted border-amber-400/60 text-amber-200 hover:text-amber-100"
          >
            {segment.name}
          </button>
        ) : (
          <span
            key={`link-${index}`}
            className={cn("rounded-sm", segment.target ? "text-amber-200" : "text-stone-400 line-through decoration-stone-600")}
            title={segment.target ? `A ${segment.target.kind}` : "Nothing by this name yet"}
          >
            {segment.name}
          </span>
        ),
      );
      return;
    }
    segment.text.split(INLINE).forEach((piece, at) => {
      if (!piece) {
        return;
      }
      const key = `t-${index}-${at}`;
      if (piece.startsWith("**") && piece.endsWith("**")) {
        nodes.push(<strong key={key} className="text-stone-100">{piece.slice(2, -2)}</strong>);
      } else if (piece.startsWith("*") && piece.endsWith("*")) {
        nodes.push(<em key={key}>{piece.slice(1, -1)}</em>);
      } else if (piece.startsWith("`") && piece.endsWith("`")) {
        nodes.push(<code key={key} className="rounded bg-stone-900 px-1 text-[0.9em] text-amber-100">{piece.slice(1, -1)}</code>);
      } else {
        nodes.push(piece);
      }
    });
  });
  return nodes;
}

export function Markdown({
  source,
  targets = [],
  onLink,
  className,
}: {
  source: string;
  // Names the [[links]] may resolve to.
  targets?: LoreLinkTarget[];
  onLink?: (target: LoreLinkTarget) => void;
  className?: string;
}) {
  const rendered = blocks(source);
  return (
    <div className={cn("space-y-1.5 text-[12px] leading-5 text-stone-300", className)}>
      {rendered.map((block, index) => {
        if (block.kind === "heading") {
          const size = block.level === 1 ? "text-base" : block.level === 2 ? "text-sm" : "text-[13px]";
          return (
            <p key={index} className={cn("font-display tracking-wide text-amber-50", size)}>
              {inline(block.text, targets, onLink)}
            </p>
          );
        }
        if (block.kind === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={index} className={cn("space-y-0.5 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
              {block.items.map((item, at) => (
                <li key={at}>{inline(item, targets, onLink)}</li>
              ))}
            </Tag>
          );
        }
        return <p key={index}>{inline(block.text, targets, onLink)}</p>;
      })}
    </div>
  );
}
