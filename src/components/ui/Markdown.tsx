"use client";

import { Dices } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { splitLoreLinks, type LoreLinkTarget, type LoreStyle } from "@/lib/dm/world-lore-logic";

// The small markdown a world bible needs, rendered to React and never to
// HTML: headings, bold, italics, code, bullet and numbered lists, and the
// [[Name]] links between documents. Anything else is a paragraph. No
// dependency, no HTML injection, and it reads the same on a phone.

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; text: string }
  // A :::secret fence (docs/vtt-parity-implementation-plan.md 5.1): kept
  // for the DM seat, dropped for everyone else before this runs.
  | { kind: "secret"; blocks: Block[] };

function blocks(source: string): Block[] {
  const out: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let secret: string[] | null = null;
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
    if (secret !== null) {
      if (/^\s*:::\s*$/.test(line)) {
        out.push({ kind: "secret", blocks: blocks(secret.join("\n")) });
        secret = null;
      } else {
        secret.push(raw);
      }
      continue;
    }
    if (/^\s*:::secret\s*$/.test(line)) {
      flush();
      secret = [];
      continue;
    }
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
  if (secret !== null) {
    // An unclosed fence is still a secret to the end of the body.
    out.push({ kind: "secret", blocks: blocks(secret.join("\n")) });
  }
  return out;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
// [[1d6]] in a handout or a house rule is a die to roll, not a link
// (docs/vtt-parity-implementation-plan.md 5.6).
const DICE = /^\s*(\d{0,2}d\d{1,3}(?:\s*[+-]\s*\d{1,3})?)\s*$/i;

function RollChip({ expression, onRoll }: { expression: string; onRoll?: (expression: string) => Promise<number | null> }) {
  const [result, setResult] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={!onRoll || busy}
      onClick={async () => {
        if (!onRoll) {
          return;
        }
        setBusy(true);
        try {
          setResult(await onRoll(expression));
        } finally {
          setBusy(false);
        }
      }}
      title={onRoll ? `Roll ${expression}` : expression}
      className="inline-flex items-center gap-1 rounded-md border border-amber-700/60 bg-amber-950/40 px-1.5 py-0 align-baseline font-mono text-[0.85em] text-amber-100 hover:bg-amber-900/40 disabled:opacity-70"
    >
      <Dices className="size-3" />
      {expression}
      {result !== null ? <span className="fx-pop font-semibold text-amber-300">{result}</span> : null}
    </button>
  );
}

type InlineOptions = { onRoll?: (expression: string) => Promise<number | null> };

function inline(
  text: string,
  targets: LoreLinkTarget[],
  onLink?: (target: LoreLinkTarget) => void,
  options: InlineOptions = {},
): ReactNode[] {
  const nodes: ReactNode[] = [];
  splitLoreLinks(text, targets).forEach((segment, index) => {
    if (segment.kind === "link" && DICE.test(segment.name)) {
      nodes.push(<RollChip key={`roll-${index}`} expression={segment.name.replace(/\s+/g, "")} onRoll={options.onRoll} />);
      return;
    }
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

// The three dressings (docs/vtt-parity-implementation-plan.md 5.6):
// plain for the bible, parchment for a letter or a page, notice for a
// poster. The two paper styles are in globals.css.
const STYLE_CLASS: Record<LoreStyle, { root: string; heading: string; body: string }> = {
  plain: { root: "space-y-1.5 text-[12px] leading-5 text-stone-300", heading: "font-display tracking-wide text-amber-50", body: "" },
  parchment: { root: "parchment space-y-2 font-serif text-[13px] leading-6", heading: "font-display tracking-wide", body: "" },
  notice: { root: "notice space-y-2 text-[13px] leading-6", heading: "font-display uppercase tracking-[0.2em] text-center", body: "text-center" },
};

export function Markdown({
  source,
  targets = [],
  onLink,
  className,
  style = "plain",
  dmView = false,
  onRoll,
}: {
  source: string;
  // Names the [[links]] may resolve to.
  targets?: LoreLinkTarget[];
  onLink?: (target: LoreLinkTarget) => void;
  className?: string;
  style?: LoreStyle;
  // Renders :::secret blocks in a marked box instead of dropping them.
  dmView?: boolean;
  // Rolls a [[1d6]] chip; without it the chip is only a label.
  onRoll?: (expression: string) => Promise<number | null>;
}) {
  const rendered = blocks(source);
  const look = STYLE_CLASS[style];
  const options: InlineOptions = { onRoll };
  const renderBlocks = (list: Block[], keyPrefix = ""): ReactNode[] =>
    list.map((block, index) => {
      const key = `${keyPrefix}${index}`;
      if (block.kind === "secret") {
        if (!dmView) {
          return null;
        }
        return (
          <div key={key} className="rounded-md border border-dashed border-violet-700/70 bg-violet-950/30 px-2 py-1.5">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-violet-300">Only the DM reads this</p>
            <div className="space-y-1.5">{renderBlocks(block.blocks, `${key}-`)}</div>
          </div>
        );
      }
      if (block.kind === "heading") {
        const size = block.level === 1 ? "text-base" : block.level === 2 ? "text-sm" : "text-[13px]";
        return (
          <p key={key} className={cn(look.heading, size)}>
            {inline(block.text, targets, onLink, options)}
          </p>
        );
      }
      if (block.kind === "list") {
        const Tag = block.ordered ? "ol" : "ul";
        return (
          <Tag key={key} className={cn("space-y-0.5 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
            {block.items.map((item, at) => (
              <li key={at}>{inline(item, targets, onLink, options)}</li>
            ))}
          </Tag>
        );
      }
      return (
        <p key={key} className={look.body}>
          {inline(block.text, targets, onLink, options)}
        </p>
      );
    });
  return <div className={cn(look.root, className)}>{renderBlocks(rendered)}</div>;
}
