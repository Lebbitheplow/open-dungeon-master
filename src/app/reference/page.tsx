"use client";

import { BookOpen, Calculator, Columns3, Loader2, MessageCircleQuestion, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { InfoDialog } from "@/components/ui/InfoDialog";
import {
  describeContentEntry,
  glossaryTerms,
  spellSummary,
  type GlossaryTerm,
} from "@/lib/help";
import { CalculatorsPanel } from "@/app/reference/CalculatorsPanel";
import { ComparePanel, type CompareSelection } from "@/app/reference/ComparePanel";
import { DeskPanel } from "@/app/reference/DeskPanel";
import { MAX_COMPARE, type CompareKind } from "@/lib/reference/compare";

// The research desk: what used to be a player's rules lookup, grown into the
// thing a DM actually uses between sessions.
//
// Browse is the original page and still answers "what does this spell do".
// The three modes beside it are the DM half: several things side by side, the
// calculations that otherwise happen on paper, and a grounded answer with
// citations. Nothing here is campaign-scoped, because none of these questions
// are: they are about the system and about this user's own rules.

type Row = {
  slug: string;
  name: string;
  source: string;
  data: Record<string, unknown>;
  level?: number;
};

type Ruling = {
  ref: string;
  kind: "ruling" | "variant";
  name: string;
  text: string;
  origin: string;
};

const TABS = [
  { kind: "glossary", label: "Basics" },
  { kind: "spells", label: "Spells" },
  { kind: "feats", label: "Feats" },
  { kind: "items", label: "Items" },
  { kind: "conditions", label: "Conditions" },
  { kind: "races", label: "Lineages" },
  { kind: "backgrounds", label: "Backgrounds" },
  { kind: "monsters", label: "Monsters" },
  { kind: "rulings", label: "House rules" },
] as const;

type Kind = (typeof TABS)[number]["kind"];

const MODES = [
  { id: "browse", label: "Browse", icon: Search },
  { id: "compare", label: "Compare", icon: Columns3 },
  { id: "calculators", label: "Calculators", icon: Calculator },
  { id: "ask", label: "Ask", icon: MessageCircleQuestion },
] as const;

type Mode = (typeof MODES)[number]["id"];

// The two kinds compare.ts knows how to put side by side.
function comparableKind(kind: Kind): CompareKind | null {
  return kind === "spells" || kind === "monsters" ? kind : null;
}

export default function ReferencePage() {
  const [mode, setMode] = useState<Mode>("browse");
  const [kind, setKind] = useState<Kind>("glossary");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [rulings, setRulings] = useState<Ruling[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState<{ title: string; meta?: string; text: string } | null>(null);
  const [selection, setSelection] = useState<CompareSelection | null>(null);

  const terms = glossaryTerms();
  const filteredTerms = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return terms;
    }
    return terms.filter(
      (term) =>
        term.term.toLowerCase().includes(needle) || term.short.toLowerCase().includes(needle),
    );
  }, [terms, query]);

  useEffect(() => {
    if (kind === "glossary") {
      return;
    }
    let cancelled = false;
    // setLoading lives inside the timeout, not the effect body: the lint rule
    // bans a synchronous setState there, and useContentSearch already debounces
    // this way.
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        if (kind === "rulings") {
          const response = await fetch(
            `/api/reference/rulings?q=${encodeURIComponent(query.trim())}`,
          );
          if (cancelled) {
            return;
          }
          const data = await response.json();
          setRulings(response.ok ? (data.rulings ?? []) : []);
          return;
        }
        const params = new URLSearchParams({ limit: "60" });
        if (query.trim()) {
          params.set("q", query.trim());
        }
        const response = await fetch(`/api/content/${kind}?${params}`);
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setUnavailable(true);
          setRows([]);
          return;
        }
        const data = await response.json();
        setUnavailable(!data.packInstalled);
        setRows(data.results ?? []);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, query]);

  function openTerm(term: GlossaryTerm) {
    setOpen({ title: term.term, text: [term.short, term.long].filter(Boolean).join("\n\n") });
  }

  function openRow(row: Row) {
    setOpen({
      title: row.name,
      meta: kind === "spells" ? spellSummary(row.data) : undefined,
      text: describeContentEntry(row.data) ?? "No description available for this entry.",
    });
  }

  // Picking things to compare happens here, in the tab that can already
  // search for them. Switching to a different comparable kind starts a new
  // selection rather than mixing spells and monsters into one table.
  function toggleCompare(row: Row) {
    const comparable = comparableKind(kind);
    if (!comparable) {
      return;
    }
    setSelection((previous) => {
      const current =
        previous && previous.kind === comparable ? previous : { kind: comparable, entries: [] };
      const already = current.entries.some((entry) => entry.slug === row.slug);
      if (already) {
        return {
          kind: comparable,
          entries: current.entries.filter((entry) => entry.slug !== row.slug),
        };
      }
      if (current.entries.length >= MAX_COMPARE) {
        return current;
      }
      return { kind: comparable, entries: [...current.entries, { slug: row.slug, name: row.name }] };
    });
  }

  const picked = new Set(
    selection && selection.kind === comparableKind(kind)
      ? selection.entries.map((entry) => entry.slug)
      : [],
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 font-display text-2xl tracking-wide text-amber-100">
          <BookOpen className="size-5 text-amber-500/80" /> Rules reference
        </h1>
        <Link href="/" className={ui.btnSmall}>
          Back
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {MODES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setMode(entry.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors",
              mode === entry.id
                ? "border-amber-600 bg-stone-900 text-amber-100"
                : "border-stone-800 text-stone-400 hover:border-amber-800 hover:text-stone-200",
            )}
          >
            <entry.icon className="size-3.5" />
            {entry.label}
            {entry.id === "compare" && selection?.entries.length
              ? ` (${selection.entries.length})`
              : ""}
          </button>
        ))}
      </div>

      {mode === "calculators" ? <CalculatorsPanel /> : null}
      {mode === "ask" ? <DeskPanel /> : null}
      {mode === "compare" ? (
        <ComparePanel
          selection={selection ?? { kind: "spells", entries: [] }}
          onRemove={(slug) =>
            setSelection((previous) =>
              previous
                ? { ...previous, entries: previous.entries.filter((entry) => entry.slug !== slug) }
                : previous,
            )
          }
          onClear={() => setSelection(null)}
        />
      ) : null}

      {mode === "browse" ? (
        <>
          <p className="mb-4 text-sm text-stone-400">
            New to this? Start with Basics, which explains the terms the game leans on constantly.
            The other tabs search everything the app knows about, including your own homebrew and
            the house rules on your rulesets.
          </p>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {TABS.map((tab) => (
              <button
                key={tab.kind}
                type="button"
                onClick={() => setKind(tab.kind)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  kind === tab.kind
                    ? "border-amber-600 bg-stone-900 text-amber-100"
                    : "border-stone-700 text-stone-400 hover:border-amber-800 hover:text-stone-200",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-2.5 size-4 text-stone-600" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                kind === "glossary"
                  ? "Search the basics"
                  : kind === "rulings"
                    ? "Search your house rules"
                    : `Search ${kind}`
              }
              className="w-full rounded-lg border border-stone-800 bg-stone-950 py-2 pl-9 pr-3 text-sm text-stone-200 outline-none focus:border-amber-300"
            />
            {loading ? (
              <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-stone-500" />
            ) : null}
          </div>

          {comparableKind(kind) ? (
            <p className="mb-3 text-xs text-stone-500">
              Tick up to {MAX_COMPARE} to line them up side by side in Compare.
            </p>
          ) : null}

          {kind === "glossary" ? (
            <ul className="space-y-1.5">
              {filteredTerms.map((term) => (
                <li key={term.id}>
                  <button
                    type="button"
                    onClick={() => openTerm(term)}
                    className="w-full rounded-lg border border-stone-800 bg-stone-950/60 px-3 py-2 text-left hover:border-amber-800"
                  >
                    <span className="block text-sm text-stone-200">{term.term}</span>
                    <span className="block text-xs text-stone-500">{term.short}</span>
                  </button>
                </li>
              ))}
              {!filteredTerms.length ? (
                <li className="text-sm text-stone-500">Nothing matches that.</li>
              ) : null}
            </ul>
          ) : kind === "rulings" ? (
            <ul className="space-y-1.5">
              {rulings.map((ruling) => (
                <li
                  key={ruling.ref}
                  className="rounded-lg border border-stone-800 bg-stone-950/60 px-3 py-2"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm text-amber-200">{ruling.name}</span>
                    <span className="shrink-0 text-xs text-stone-600">{ruling.origin}</span>
                  </span>
                  <span className="mt-1 block whitespace-pre-wrap text-xs text-stone-400">
                    {ruling.text}
                  </span>
                </li>
              ))}
              {!rulings.length && !loading ? (
                <li className="text-sm text-stone-500">
                  {query.trim()
                    ? "None of your house rules mention that."
                    : "No house rules yet. Rulesets in your library are where they live."}
                </li>
              ) : null}
            </ul>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((row) => (
                <li key={row.slug} className="flex items-stretch gap-1.5">
                  {comparableKind(kind) ? (
                    <button
                      type="button"
                      onClick={() => toggleCompare(row)}
                      aria-label={`Compare ${row.name}`}
                      aria-pressed={picked.has(row.slug)}
                      className={cn(
                        "shrink-0 rounded-lg border px-2 text-xs transition-colors",
                        picked.has(row.slug)
                          ? "border-amber-600 bg-stone-900 text-amber-200"
                          : "border-stone-800 text-stone-600 hover:border-amber-800 hover:text-stone-300",
                      )}
                    >
                      <Columns3 className="size-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openRow(row)}
                    className="flex-1 rounded-lg border border-stone-800 bg-stone-950/60 px-3 py-2 text-left hover:border-amber-800"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-sm",
                          row.source === "homebrew" ? "text-amber-300" : "text-stone-200",
                        )}
                      >
                        {row.name}
                      </span>
                      {kind === "spells" ? (
                        <span className="shrink-0 text-xs text-stone-500">
                          {row.level === 0 ? "cantrip" : `level ${row.level}`}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
              {!rows.length && !loading ? (
                <li className="text-sm text-stone-500">
                  {unavailable
                    ? "The content pack is not installed, so there is nothing to browse here yet."
                    : "Nothing matches that."}
                </li>
              ) : null}
            </ul>
          )}
        </>
      ) : null}

      <InfoDialog
        open={open !== null}
        onOpenChange={(next) => !next && setOpen(null)}
        title={open?.title ?? ""}
        meta={open?.meta}
        text={open?.text}
      />
    </main>
  );
}
