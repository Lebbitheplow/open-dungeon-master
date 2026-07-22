"use client";

import { Info, Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/Dialog";

// The "what does this do?" affordance, used everywhere a game term appears.
//
// Built on the shared Dialog rather than a popover on purpose: Radix tooltips
// never open on a touch tap, and the session layout is used on phones. A
// dialog behaves identically with a mouse, a finger and a keyboard.
//
// Text can be passed directly (features, glossary terms) or fetched lazily
// from the content pack by {kind, slug} for spells, feats and items, which is
// what /api/content/[kind]/[slug] was built for.

// `name` lets the lookup recover when a row's slug is not the plain
// slugified name (third-party documents pick their own), by falling back to
// a search.
export type ContentRef = { kind: string; slug: string; name?: string };

// Content-pack descriptions are markdown-ish: headings, bold, italics, tables.
// Rendering the handful of constructs that actually appear is far cheaper than
// a markdown dependency, and unknown syntax degrades to plain text rather than
// showing raw asterisks. Table rows keep their pipes inside a monospace block.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      out.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    index += 1;
    if (token.startsWith("**")) {
      out.push(
        <strong key={key} className="font-medium text-stone-200">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <em key={key} className="text-stone-300">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}

export function renderRules(text: string): ReactNode {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks.map((block, blockIndex) => {
    const trimmed = block.trim();
    if (!trimmed) {
      return null;
    }
    // Tables: keep the alignment by rendering the raw rows in a scroll box.
    if (trimmed.split("\n").every((line) => line.trim().startsWith("|"))) {
      return (
        <pre
          key={blockIndex}
          className="overflow-x-auto rounded-md bg-stone-900/60 p-2 text-[11px] leading-relaxed text-stone-400"
        >
          {trimmed}
        </pre>
      );
    }
    const lines = trimmed.split("\n");
    if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
      return (
        <ul key={blockIndex} className="list-disc space-y-1 pl-4">
          {lines.map((line, lineIndex) => (
            <li key={lineIndex}>
              {renderInline(line.replace(/^\s*[-*+]\s+/, ""), `${blockIndex}-${lineIndex}`)}
            </li>
          ))}
        </ul>
      );
    }
    // A heading line becomes a small label rather than showing its hashes.
    const heading = /^#{1,6}\s+(.*)$/.exec(lines[0]);
    const body = heading ? lines.slice(1).join("\n") : trimmed;
    return (
      <div key={blockIndex}>
        {heading ? (
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-200/80">
            {heading[1]}
          </p>
        ) : null}
        {body.trim() ? <p>{renderInline(body, String(blockIndex))}</p> : null}
      </div>
    );
  });
}

// Loads a content-pack entry's description on first open, so opening a sheet
// with forty spells on it costs nothing until one is actually inspected.
function ContentBody({ reference }: { reference: ContentRef }) {
  const [state, setState] = useState<{ text: string | null; loading: boolean }>({
    text: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { describeContentEntry } = await import("@/lib/help");
        const response = await fetch(
          `/api/content/${reference.kind}/${encodeURIComponent(reference.slug)}`,
        );
        if (response.ok) {
          const data = await response.json();
          const text = describeContentEntry(data?.entry?.data);
          if (text) {
            if (!cancelled) {
              setState({ text, loading: false });
            }
            return;
          }
        }
        // The slug guessed from the name missed, or the row it found carries
        // no text. Search by name and take an exact match.
        const wanted = (reference.name ?? reference.slug).trim().toLowerCase();
        const search = await fetch(
          `/api/content/${reference.kind}?q=${encodeURIComponent(wanted)}&limit=20`,
        );
        const results = search.ok ? ((await search.json()).results ?? []) : [];
        const hit = results.find(
          (entry: { name: string }) => entry.name.trim().toLowerCase() === wanted,
        );
        if (!cancelled) {
          setState({ text: describeContentEntry(hit?.data), loading: false });
        }
      } catch {
        if (!cancelled) {
          setState({ text: null, loading: false });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reference.kind, reference.slug, reference.name]);

  if (state.loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-stone-500">
        <Loader2 className="size-4 animate-spin" /> Looking it up...
      </p>
    );
  }
  if (!state.text) {
    return (
      <p className="text-sm text-stone-500">
        No description available. The content pack may not be installed, or this entry was added by
        hand.
      </p>
    );
  }
  return <>{renderRules(state.text)}</>;
}

// The ⓘ button plus its dialog. `label` names the thing; `text` is its
// description, or omit it and pass `reference` to fetch one.
export function InfoButton({
  label,
  text,
  reference,
  meta,
  className,
  size = "sm",
}: {
  label: string;
  text?: string | null;
  reference?: ContentRef;
  // A short line under the title: spell level and school, feature level, and
  // so on.
  meta?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  // Nothing to say and nothing to look up: render no control at all rather
  // than a button that opens an empty box.
  if (!text?.trim() && !reference) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={`What is ${label}?`}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors hover:text-amber-200",
          className,
        )}
      >
        <Info className={size === "md" ? "size-4" : "size-3.5"} />
      </button>
      <InfoDialog
        open={open}
        onOpenChange={setOpen}
        title={label}
        meta={meta}
        text={text}
        reference={reference}
      />
    </>
  );
}

// A list of named things, each with its own ⓘ. Replaces the comma-joined
// strings the sheets used to print for features, feats and spells.
export function InfoChipList({
  items,
  emptyText,
}: {
  items: Array<{
    name: string;
    text?: string | null;
    meta?: string;
    reference?: ContentRef;
    // Rendered after the name, e.g. "(story)" for a feature the DM granted.
    note?: string;
  }>;
  emptyText?: string;
}) {
  if (!items.length) {
    return emptyText ? <p className="text-xs text-stone-500">{emptyText}</p> : null;
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {items.map((item) => (
        <span key={item.name} className="flex items-center gap-1 text-xs text-stone-300">
          {item.name}
          {item.note ? <span className="text-stone-500">{item.note}</span> : null}
          <InfoButton
            label={item.name}
            meta={item.meta}
            text={item.text}
            reference={item.reference}
          />
        </span>
      ))}
    </div>
  );
}

export function InfoDialog({
  open,
  onOpenChange,
  title,
  meta,
  text,
  reference,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  meta?: string;
  text?: string | null;
  reference?: ContentRef;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} width="w-[min(92vw,32rem)]">
      {meta ? (
        <p className="mb-3 text-xs uppercase tracking-wide text-amber-200/70">{meta}</p>
      ) : null}
      <div className="space-y-2 text-sm leading-relaxed text-stone-400">
        {text?.trim() ? renderRules(text) : reference ? <ContentBody reference={reference} /> : null}
        {children}
      </div>
    </Dialog>
  );
}
