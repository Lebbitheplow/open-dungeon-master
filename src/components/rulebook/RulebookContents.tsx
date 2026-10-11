"use client";

import { Bookmark, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/cn";
import type { ContentsChapter, ContentsEntry, RulebookContents as Contents, RulebookPart, SearchHit } from "@/lib/rulebook/types";
import { Digits } from "./RulebookPage";

// The left-hand page: the book's name, a search line, the rules a table
// reaches for mid-session, the reader's bookmarks, and the contents, book by
// book (players, Dungeon Master, monsters) and chapter by chapter, each opening onto its pages with dotted leaders and
// folios. While something is typed in the search line, what it found takes
// the contents' place.

export type OpenFromContents = (id: string, at?: string, terms?: string[]) => void;

// `words` are the page's words the search matched, as the server read them
// (src/lib/rulebook/search.ts): marked as written, never stemmed here.
function Highlighted({ text, words }: { text: string; words: string[] }) {
  const parts = text.split(/([\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*)/u);
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 0 || !part) return part;
        return words.includes(part.toLowerCase().replace(/’/g, "'")) ? (
          <mark key={index} className="rb-mark">
            {part}
          </mark>
        ) : (
          part
        );
      })}
    </>
  );
}

// "3rd-level evocation" reads "evocation" beside a spell's name; a monster
// shows its size and type.
function aside(entry: ContentsEntry): string | null {
  if (!entry.meta) return null;
  if (entry.kind === "spell") return entry.meta.replace(/^\d\w*-level\s+/i, "").replace(/\s*cantrip$/i, "");
  if (entry.kind === "monster") return entry.meta.split(",")[0];
  return null;
}

function EntryRow({ entry, current, onOpen }: { entry: ContentsEntry; current: boolean; onOpen: (id: string) => void }) {
  const note = aside(entry);
  return (
    <button type="button" className="rb-entry" data-on={current || undefined} aria-current={current ? "page" : undefined} onClick={() => onOpen(entry.id)}>
      <span className="rb-entry-title">
        <Digits text={entry.title} />
        {note ? <span className="rb-entry-note">{note}</span> : null}
      </span>
      <span className="rb-leader" aria-hidden="true" />
      <span className="rb-entry-folio">{entry.folio}</span>
    </button>
  );
}

function ChapterBody({ chapter, current, onOpen }: { chapter: ContentsChapter; current: string | null; onOpen: (id: string) => void }) {
  // Long chapters (spells by level, monsters and items by letter) are cut
  // into groups; the short ones list their pages straight.
  const groups = useMemo(() => {
    const out: Array<{ name: string | null; entries: ContentsEntry[] }> = [];
    for (const entry of chapter.entries) {
      const name = entry.group ?? null;
      const last = out[out.length - 1];
      if (last && last.name === name) last.entries.push(entry);
      else out.push({ name, entries: [entry] });
    }
    return out;
  }, [chapter.entries]);
  return (
    <div className="rb-chapter-pages">
      <p className="rb-chapter-blurb">{chapter.blurb}</p>
      {groups.map((group, index) => (
        <div key={`${group.name ?? "intro"}-${index}`} className="rb-group">
          {group.name ? (
            <p className="rb-group-name">
              <Digits text={group.name} />
            </p>
          ) : null}
          <div className={cn("rb-group-entries", group.entries.length > 12 && "rb-group-wide")}>
            {group.entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} current={entry.id === current} onOpen={onOpen} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RulebookContents({
  contents,
  current,
  bookmarks,
  onOpen,
  searchRef,
}: {
  contents: Contents | null;
  current: string | null;
  bookmarks: string[];
  onOpen: OpenFromContents;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; hits: SearchHit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const currentChapter = useMemo(
    () => contents?.chapters.find((chapter) => chapter.entries.some((entry) => entry.id === current))?.id ?? null,
    [contents, current],
  );
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // Chapters that have been opened keep their pages mounted, so closing one
  // animates instead of emptying at once.
  const [mounted, setMounted] = useState<Set<string>>(() => new Set());
  const [seenChapter, setSeenChapter] = useState<string | null>(null);
  if (currentChapter !== seenChapter) {
    setSeenChapter(currentChapter);
    if (currentChapter && !open.has(currentChapter)) {
      setOpen(new Set(open).add(currentChapter));
      setMounted(new Set(mounted).add(currentChapter));
    }
  }

  const asked = useRef("");
  useEffect(() => {
    const q = query.trim();
    asked.current = q;
    if (!q) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/rulebook/search?q=${encodeURIComponent(q)}`);
        const data = response.ok ? await response.json() : { hits: [] };
        if (asked.current === q) setResult({ query: q, hits: data.hits ?? [] });
      } finally {
        if (asked.current === q) setSearching(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const entries = useMemo(() => {
    const map = new Map<string, ContentsEntry>();
    for (const chapter of contents?.chapters ?? []) for (const entry of chapter.entries) map.set(entry.id, entry);
    return map;
  }, [contents]);

  function toggle(id: string) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
    if (!mounted.has(id)) setMounted(new Set(mounted).add(id));
  }

  // The contents in its three books, then whatever no book claims (the
  // appendices). Every heading and chapter takes the next step of the ink-in.
  const sections = useMemo(() => {
    const out: Array<{ part: RulebookPart | null; delay: number; chapters: Array<{ chapter: ContentsChapter; delay: number }> }> = [];
    const partOf = new Map<string, RulebookPart>();
    for (const part of contents?.parts ?? []) for (const id of part.chapters) partOf.set(id, part);
    let step = 0;
    for (const chapter of contents?.chapters ?? []) {
      const part = partOf.get(chapter.id) ?? null;
      let last = out[out.length - 1];
      if (!last || last.part !== part) {
        last = { part, delay: part ? step++ : step, chapters: [] };
        out.push(last);
      }
      last.chapters.push({ chapter, delay: step++ });
    }
    return out;
  }, [contents]);

  const searchingNow = Boolean(query.trim());
  const shown = searchingNow && result?.query === query.trim() ? result : null;
  const marks = useMemo(() => bookmarks.map((id) => entries.get(id)).filter((entry): entry is ContentsEntry => Boolean(entry)), [bookmarks, entries]);

  return (
    <div className="rb-contents" data-no-motion>
      <header className="rb-contents-head">
        <p className="rb-running">Open Dungeon Master</p>
        <h2 className="rb-book-title">The Rulebook</h2>
        <p className="rb-book-sub">Fifth Edition &middot; System Reference Document 5.1</p>
      </header>

      <label className="rb-search">
        <Search className="rb-search-icon" aria-hidden="true" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              setQuery("");
            }
            if (event.key === "Enter" && shown?.hits[0]) {
              const hit = shown.hits[0];
              onOpen(hit.page, hit.at, hit.words);
            }
          }}
          placeholder="Seek a rule, a spell, a monster"
          aria-label="Search the rulebook"
          spellCheck={false}
          enterKeyHint="search"
        />
        {searching ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/assets/ui/quill.webp" alt="" className="rb-quill" />
        ) : query ? (
          <button type="button" className="rb-search-clear" aria-label="Clear the search" onClick={() => setQuery("")}>
            <X className="size-3.5" />
          </button>
        ) : null}
        <span className="rb-search-ink" aria-hidden="true" />
      </label>

      {searchingNow ? (
        <section className="rb-results" aria-live="polite">
          {shown ? (
            <>
              <p className="rb-results-count">
                {shown.hits.length
                  ? `${shown.hits.length === 40 ? "The first 40" : shown.hits.length} passage${shown.hits.length === 1 ? "" : "s"} found`
                  : "Nothing in the book matches that."}
              </p>
              <ol className="rb-hits" key={shown.query}>
                {shown.hits.map((hit, index) => (
                  <li key={`${hit.page}-${hit.at ?? ""}`} style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
                    <button type="button" className="rb-hit" data-on={hit.page === current || undefined} onClick={() => onOpen(hit.page, hit.at, hit.words)}>
                      <span className="rb-hit-where">
                        {hit.numeral} &middot; <Digits text={hit.chapter} />
                      </span>
                      <span className="rb-hit-title">
                        <Digits text={hit.title} />
                        {hit.heading && hit.heading !== hit.title ? (
                          <>
                            <span className="rb-hit-sep" aria-hidden="true">
                              &rsaquo;
                            </span>
                            <Digits text={hit.heading} />
                          </>
                        ) : null}
                      </span>
                      <span className="rb-hit-snippet">
                        <Highlighted text={hit.snippet} words={hit.words} />
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="rb-results-count">Turning the pages&hellip;</p>
          )}
        </section>
      ) : (
        <div className="rb-contents-body">
          {contents ? (
            <>
              <section className="rb-quick" aria-label="At the table">
                <p className="rb-section-label">At the table</p>
                <div className="rb-chips">
                  {contents.quick.map((link) => (
                    <button key={link.label} type="button" className="rb-chip motion-press" onClick={() => onOpen(link.page, link.at)}>
                      {link.label}
                    </button>
                  ))}
                </div>
              </section>

              {marks.length ? (
                <section className="rb-marks" aria-label="Bookmarks">
                  <p className="rb-section-label">
                    <Bookmark className="size-3.5" aria-hidden="true" /> Bookmarks
                  </p>
                  {marks.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} current={entry.id === current} onOpen={(id) => onOpen(id)} />
                  ))}
                </section>
              ) : null}

              <nav aria-label="Contents">
                <p className="rb-section-label">Contents</p>
                {sections.map((section) => (
                  <section key={section.part?.id ?? "appendices"} className="rb-part" aria-label={section.part?.title}>
                    {section.part ? (
                      <header className="rb-part-head" style={{ animationDelay: `${120 + section.delay * 30}ms` }}>
                        <p className="rb-part-numeral">Book {section.part.numeral}</p>
                        <h3 className="rb-part-title">{section.part.title}</h3>
                        <p className="rb-part-blurb">{section.part.blurb}</p>
                      </header>
                    ) : null}
                    <ol className="rb-chapters">
                      {section.chapters.map(({ chapter, delay }) => {
                        const isOpen = open.has(chapter.id);
                        return (
                          <li key={chapter.id} className="rb-chapter" data-open={isOpen || undefined} style={{ animationDelay: `${120 + delay * 30}ms` }}>
                            <button type="button" className="rb-chapter-row" aria-expanded={isOpen} onClick={() => toggle(chapter.id)}>
                              <span className="rb-numeral">{chapter.numeral}</span>
                              <span className="rb-chapter-title">
                                <Digits text={chapter.title} />
                              </span>
                              <span className="rb-leader" aria-hidden="true" />
                              <span className="rb-entry-folio">{chapter.entries[0]?.folio}</span>
                              <ChevronRight className="rb-chevron" aria-hidden="true" />
                            </button>
                            <div className="rb-chapter-body">
                              <div className="rb-chapter-inner">
                                {mounted.has(chapter.id) ? <ChapterBody chapter={chapter} current={current} onOpen={(id) => onOpen(id)} /> : null}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))}
              </nav>

              <p className="rb-legal">
                This work includes material taken from the System Reference Document 5.1 (&ldquo;SRD 5.1&rdquo;) by
                Wizards of the Coast LLC, licensed under{" "}
                <a href={contents.source.licenseUrl} target="_blank" rel="noreferrer">
                  CC-BY-4.0
                </a>
                .{" "}
                <button type="button" className="rb-xref" onClick={() => onOpen("legal-information")}>
                  Legal information
                </button>
              </p>
            </>
          ) : (
            <p className="rb-results-count">Opening the book&hellip;</p>
          )}
        </div>
      )}
    </div>
  );
}
