"use client";

import { Calculator, Columns3, Loader2, MessageCircleQuestion, Search } from "lucide-react";
import type { IconKind } from "@/lib/icons";
import { GameIcon } from "@/components/ui/GameIcon";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { PIXEL_ICONS, ui } from "@/lib/ui";
import { PageSection, PageShell } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { InfoDialog } from "@/components/ui/InfoDialog";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  describeContentEntry,
  glossaryTerms,
  spellSummary,
  type GlossaryTerm,
} from "@/lib/help";
import { CalculatorsPanel } from "@/app/reference/CalculatorsPanel";
import { ComparePanel, type CompareSelection } from "@/app/reference/ComparePanel";
import { DeskPanel } from "@/app/reference/DeskPanel";
import { CategoryRail } from "@/app/reference/CategoryRail";
import { ResultBadges, type BadgeRow } from "@/app/reference/ResultBadges";
import { MAX_COMPARE, type CompareKind } from "@/lib/reference/compare";

// Which painted icon set a reference category draws from (src/lib/icons.ts).
const REFERENCE_ICON_KIND: Record<string, IconKind | undefined> = {
  spells: "spell",
  feats: "feat",
  items: "item",
  conditions: "condition",
};

// The research desk: what used to be a player's rules lookup, grown into the
// thing a DM actually uses between sessions.
//
// Browse is the original page and still answers "what does this spell do".
// The three modes beside it are the DM half: several things side by side, the
// calculations that otherwise happen on paper, and a grounded answer with
// citations. Nothing here is campaign-scoped, because none of these questions
// are: they are about the system and about this user's own rules.

// The badge fields (school, rarity, cost and the rest) arrive on the same
// rows the API has always sent; BadgeRow only names them.
type Row = BadgeRow & {
  slug: string;
  name: string;
};

// One page of results. The pack rows are paged by offset; the user's own
// homebrew rides along on every page, so it is left out of the offset and
// dropped from the pages after the first.
const PAGE = 60;
const packRows = (rows: Row[]) => rows.filter((row) => row.source !== "homebrew").length;

type Ruling = {
  ref: string;
  kind: "ruling" | "variant";
  name: string;
  text: string;
  origin: string;
};

const TABS = [
  { kind: "glossary", label: "Basics", glyph: "system-lore" },
  { kind: "spells", label: "Spells", glyph: "cue-arcane" },
  { kind: "feats", label: "Feats", glyph: "rest-proficiency" },
  { kind: "items", label: "Items", glyph: "tab-loot" },
  { kind: "conditions", label: "Conditions", glyph: "rest-concentration-break" },
  { kind: "races", label: "Lineages", glyph: "tab-characters" },
  { kind: "backgrounds", label: "Backgrounds", glyph: "tab-journal" },
  { kind: "monsters", label: "Monsters", glyph: "system-bestiary" },
  { kind: "rulings", label: "House rules", glyph: "system-rules" },
] as const;

type Kind = (typeof TABS)[number]["kind"];

type Mode = "browse" | "compare" | "calculators" | "ask";

// Result rows: one plate each (src/app/styles/account.css), the same for
// glossary terms, house rules and content entries. Every row leads with a
// painted icon: the thing's own where the set has one, its category's glyph
// where it does not.
const ROW = "plate-row motion-press min-h-11 flex-nowrap py-2";

function categoryGlyph(kind: Kind): string {
  return TABS.find((tab) => tab.kind === kind)?.glyph ?? "tab-reference";
}

// The two kinds compare.ts knows how to put side by side.
function comparableKind(kind: Kind): CompareKind | null {
  return kind === "spells" || kind === "monsters" ? kind : null;
}

// The plate at the head of a result. GameIcon draws nothing when a thing has
// no painting (a homebrew spell), so the category's glyph sits underneath and
// the row never loses its lead.
function ResultIcon({ kind, name }: { kind: Kind; name: string }) {
  const own = REFERENCE_ICON_KIND[kind];
  return (
    <span className="relative inline-flex size-8 shrink-0">
      <GameIcon icon={{ kind: "glyph", key: categoryGlyph(kind) }} size="size-8" />
      {own ? <GameIcon icon={{ kind: own, key: name }} size="size-8" className="absolute inset-0" /> : null}
    </span>
  );
}

export default function ReferencePage() {
  const [mode, setMode] = useState<Mode>("browse");
  const [kind, setKind] = useState<Kind>("glossary");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  // The category the rows on screen came from. It trails `kind` while the next
  // category loads, so old rows never wear the new category's icons and chips.
  const [rowsKind, setRowsKind] = useState<Kind>("glossary");
  const [rulings, setRulings] = useState<Ruling[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Which search is current, so a page that comes back late for an older one
  // is dropped instead of being added under the new results.
  const searchKey = useRef("");
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
    searchKey.current = `${kind}|${query}`;
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
        setHasMore(false);
        const params = new URLSearchParams({ limit: String(PAGE) });
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
        const results: Row[] = data.results ?? [];
        setRows(results);
        setRowsKind(kind);
        setHasMore(packRows(results) >= PAGE);
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

  // The next page of the same search, added under what is already shown.
  async function loadMore() {
    if (kind === "glossary" || kind === "rulings" || loadingMore) {
      return;
    }
    const asked = `${kind}|${query}`;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(packRows(rows)) });
      if (query.trim()) {
        params.set("q", query.trim());
      }
      const response = await fetch(`/api/content/${kind}?${params}`);
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const next: Row[] = (data.results ?? []).filter((row: Row) => row.source !== "homebrew");
      // A search typed while this was on the wire has its own first page.
      if (searchKey.current !== asked) {
        return;
      }
      setRows((current) => {
        const seen = new Set(current.map((row) => row.slug));
        return [...current, ...next.filter((row) => !seen.has(row.slug))];
      });
      setHasMore(next.length >= PAGE);
    } finally {
      setLoadingMore(false);
    }
  }

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

  const compareCount = selection?.entries.length ?? 0;
  const modes = [
    { value: "browse" as const, label: "Browse", icon: Search },
    {
      value: "compare" as const,
      label: compareCount ? `Compare (${compareCount})` : "Compare",
      icon: Columns3,
    },
    { value: "calculators" as const, label: "Calculators", icon: Calculator },
    { value: "ask" as const, label: "Ask", icon: MessageCircleQuestion },
  ];

  return (
    <PageShell
      icon={PIXEL_ICONS.support}
      glyph="tab-reference"
      title="Rules reference"
      blurb="Look something up, line things up side by side, run the numbers, or ask."
    >
      {/* Four long labels do not fit 360 px: the row scrolls rather than clipping the last mode. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <SegmentedControl
          options={modes}
          value={mode}
          onChange={setMode}
          label="Reference mode"
          size="sm"
          className="w-max"
        />
      </div>

      {/* Keyed by mode so the incoming desk rises in instead of cutting. */}
      <div key={mode} className="motion-tab space-y-4">
        {mode === "calculators" ? (
          <PageSection heading="Calculators" glyph="tab-dice">
            <CalculatorsPanel />
          </PageSection>
        ) : null}
        {mode === "ask" ? (
          <PageSection heading="Ask the desk" glyph="tab-lead">
            <DeskPanel />
          </PageSection>
        ) : null}
        {mode === "compare" ? (
          <PageSection heading="Compare" glyph="system-tables">
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
          </PageSection>
        ) : null}

        {mode === "browse" ? (
          <PageSection
            heading="Browse"
            glyph={categoryGlyph(kind)}
            intro="New to this? Start with Basics, which explains the terms the game leans on constantly. The other tabs search everything the app knows about, including your own homebrew and the house rules on your rulesets."
          >
            <CategoryRail tabs={TABS} value={kind} onChange={setKind} label="Category" className="mb-3" />

            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-amber-300/70" />
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
                aria-label="Search"
                className={cn(ui.input, "h-11 pl-9 pr-9")}
              />
              {loading ? (
                <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-amber-300/80" />
              ) : null}
            </div>

            {comparableKind(kind) ? (
              <p className="reveal mb-3 text-xs text-stone-500">
                Tick up to {MAX_COMPARE} to line them up side by side in Compare.
              </p>
            ) : null}

            {kind === "glossary" ? (
              <ul className="stagger space-y-1.5">
                {filteredTerms.map((term) => (
                  <li key={term.id}>
                    <button type="button" onClick={() => openTerm(term)} className={ROW}>
                      <GameIcon icon={{ kind: "glyph", key: "system-lore" }} size="size-8" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-sm tracking-wide text-amber-100">{term.term}</span>
                        <span className="block text-xs text-stone-400">{term.short}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {!filteredTerms.length ? (
                  <li>
                    <EmptyState art="scrolls" size="sm" title="Nothing matches that." />
                  </li>
                ) : null}
              </ul>
            ) : kind === "rulings" ? (
              <ul className="stagger space-y-1.5">
                {rulings.map((ruling) => (
                  <li key={ruling.ref} className="plate-row flex-nowrap items-start">
                    <GameIcon icon={{ kind: "glyph", key: "system-rules" }} size="size-8" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-display text-sm tracking-wide text-amber-200">{ruling.name}</span>
                        <span className="ref-badge" data-tone="neutral">{ruling.origin}</span>
                      </span>
                      <span className="mt-1 block whitespace-pre-wrap text-xs leading-5 text-stone-400">
                        {ruling.text}
                      </span>
                    </span>
                  </li>
                ))}
                {!rulings.length && !loading ? (
                  <li>
                    <EmptyState
                      art="scrolls"
                      size="sm"
                      title={
                        query.trim()
                          ? "None of your house rules mention that."
                          : "No house rules yet. Rulesets in your library are where they live."
                      }
                    />
                  </li>
                ) : null}
              </ul>
            ) : (
              <ul key={rowsKind} className="stagger space-y-1.5">
                {rows.map((row) => (
                  <li key={row.slug} className="flex items-stretch gap-1.5">
                    {comparableKind(rowsKind) ? (
                      <button
                        type="button"
                        onClick={() => toggleCompare(row)}
                        aria-label={`Compare ${row.name}`}
                        aria-pressed={picked.has(row.slug)}
                        title={picked.has(row.slug) ? "Take out of Compare" : "Add to Compare"}
                        className={cn(
                          "motion-press min-w-10 shrink-0 rounded-xl border px-2.5 text-xs transition-colors",
                          picked.has(row.slug)
                            ? "border-amber-400/60 bg-amber-400/15 text-amber-200 shadow-glow-gold"
                            : "border-stone-700/60 text-stone-500 hover:border-amber-500/40 hover:text-stone-300",
                        )}
                      >
                        <Columns3 className="size-3.5" />
                      </button>
                    ) : null}
                    <button type="button" onClick={() => openRow(row)} className={cn(ROW, "min-w-0 flex-1")}>
                      <ResultIcon kind={rowsKind} name={row.name} />
                      <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <span
                          className={cn(
                            "min-w-0 truncate text-sm",
                            row.source === "homebrew" ? "text-amber-300" : "text-stone-100",
                          )}
                        >
                          {row.name}
                        </span>
                        {/* The spell level that sat here is the first chip now. */}
                        <ResultBadges category={rowsKind} row={row} />
                      </span>
                    </button>
                  </li>
                ))}
                {!rows.length && !loading ? (
                  <li>
                    <EmptyState
                      art={unavailable ? "chest" : "scrolls"}
                      size="sm"
                      title={
                        unavailable
                          ? "The content pack is not installed, so there is nothing to browse here yet."
                          : "Nothing matches that."
                      }
                    />
                  </li>
                ) : null}
                {rows.length ? (
                  <li className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-stone-500">
                    <span aria-live="polite">
                      Showing {rows.length}
                      {hasMore ? ", and there are more" : ""}
                    </span>
                    {hasMore ? (
                      <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={ui.btnSmall}>
                        {loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : null} Load more
                      </button>
                    ) : null}
                  </li>
                ) : null}
              </ul>
            )}
          </PageSection>
        ) : null}
      </div>

      <InfoDialog
        open={open !== null}
        onOpenChange={(next) => !next && setOpen(null)}
        title={open?.title ?? ""}
        meta={open?.meta}
        text={open?.text}
      />
    </PageShell>
  );
}
