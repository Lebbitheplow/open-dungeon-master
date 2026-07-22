"use client";

import { BookOpen, Loader2, Search } from "lucide-react";
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

// A rules reference outside of any character: search the content pack for a
// spell, feat, item, condition or monster, or read the plain-language
// glossary. It is the answer to "what does concentration mean" and "what does
// this spell the DM just cast do" without hunting through a sheet.
//
// Everything here goes through the existing /api/content routes, so the page
// is a thin client over the same data the pickers use.

type Row = {
  slug: string;
  name: string;
  source: string;
  data: Record<string, unknown>;
  level?: number;
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
] as const;

type Kind = (typeof TABS)[number]["kind"];

export default function ReferencePage() {
  const [kind, setKind] = useState<Kind>("glossary");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState<{ title: string; meta?: string; text: string } | null>(null);

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
      <p className="mb-4 text-sm text-stone-400">
        New to this? Start with Basics, which explains the terms the game leans on constantly. The
        other tabs search everything the app knows about.
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
          placeholder={kind === "glossary" ? "Search the basics" : `Search ${kind}`}
          className="w-full rounded-lg border border-stone-800 bg-stone-950 py-2 pl-9 pr-3 text-sm text-stone-200 outline-none focus:border-amber-300"
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-stone-500" />
        ) : null}
      </div>

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
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.slug}>
              <button
                type="button"
                onClick={() => openRow(row)}
                className="w-full rounded-lg border border-stone-800 bg-stone-950/60 px-3 py-2 text-left hover:border-amber-800"
              >
                <span className="flex items-center justify-between gap-2">
                  <span
                    className={cn("text-sm", row.source === "homebrew" ? "text-amber-300" : "text-stone-200")}
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
