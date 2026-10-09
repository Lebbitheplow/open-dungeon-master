"use client";

import { Bookmark, ChevronLeft, ChevronRight, List } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { RulebookContents as Contents, RulebookPageResponse } from "@/lib/rulebook/types";
import { RulebookContents, type OpenFromContents } from "./RulebookContents";
import { RulebookPage } from "./RulebookPage";

// The rulebook as a book: a leather binding with gold tooling, the contents
// on the left-hand page and the text on the right, and a leaf that turns
// across the spine whenever the page changes (forward or back by folio). On
// a phone the spread folds to one page and the same leaf turns between the
// contents and the text.
//
// Everything is fetched from /api/rulebook a page at a time; pages either
// side of the one open are fetched ahead, so turning with the arrows or a
// swipe never waits. Bookmarks and the last page read stay on the device.

const TURN_MS = 640;
const LAST_KEY = "odm.rulebook.last";
const MARKS_KEY = "odm.rulebook.bookmarks";

type Shown = { data: RulebookPageResponse; terms: string[]; at?: string };
type Turn = "forward" | "back";

function still(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.effects === "low"
  );
}

function narrow(): boolean {
  return window.matchMedia("(max-width: 1023px)").matches;
}

function readMarks(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MARKS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, 60) : [];
  } catch {
    return [];
  }
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export function RulebookReader({
  startAt,
  startAnchor,
  cover = false,
  embedded = false,
  onPageChange,
}: {
  // A page to open on (a deep link); otherwise the last page read.
  startAt?: string;
  startAnchor?: string;
  // The closed cover swings open over the book as it first appears.
  cover?: boolean;
  // Sized by its container (the session's overlay) rather than the viewport.
  embedded?: boolean;
  onPageChange?: (id: string, at?: string) => void;
}) {
  const [contents, setContents] = useState<Contents | null>(null);
  const [contentsFailed, setContentsFailed] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [pageFailed, setPageFailed] = useState(false);
  const [arrive, setArrive] = useState<{ at?: string; nonce: number } | null>(null);
  const [turning, setTurning] = useState<Turn | null>(null);
  // The leaf in the air on a wide screen: the page it carries on its face,
  // scrolled where the reader had it. On a phone the incoming page swings
  // in instead (`enter`).
  const [leaf, setLeaf] = useState<{ shown: Shown; scroll: number } | null>(null);
  const [enter, setEnter] = useState<Turn | null>(null);
  const [view, setView] = useState<"contents" | "page">("contents");
  const [bookmarks, setBookmarks] = useState<string[]>(readMarks);
  const [coverOn, setCoverOn] = useState(cover);
  const cache = useRef(new Map<string, RulebookPageResponse>());
  const shownRef = useRef<Shown | null>(null);
  const timers = useRef<number[]>([]);
  const leafRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const pageChanged = useRef(onPageChange);
  useEffect(() => {
    pageChanged.current = onPageChange;
  }, [onPageChange]);

  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    },
    [],
  );

  const loadContents = useCallback(async () => {
    setContentsFailed(false);
    try {
      const response = await fetch("/api/rulebook");
      if (!response.ok) throw new Error(String(response.status));
      setContents(await response.json());
    } catch {
      setContentsFailed(true);
    }
  }, []);

  const fetchPage = useCallback(async (id: string): Promise<RulebookPageResponse | null> => {
    const cached = cache.current.get(id);
    if (cached) return cached;
    try {
      const response = await fetch(`/api/rulebook/pages/${encodeURIComponent(id)}`);
      if (!response.ok) return null;
      const data: RulebookPageResponse = await response.json();
      cache.current.set(id, data);
      return data;
    } catch {
      return null;
    }
  }, []);

  // Turns a leaf. Forward, the right-hand page itself lifts away (the leaf
  // carries its words) and the next page is already lying beneath it. Back,
  // a leaf comes over from the left carrying the earlier page and settles on
  // the right, and the page beneath changes as it lands.
  const turn = useCallback((direction: Turn | null, next: Shown | null, change: () => void) => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    setTurning(null);
    setLeaf(null);
    if (!direction || still()) {
      change();
      return;
    }
    if (narrow()) {
      change();
      setEnter(direction);
      timers.current = [window.setTimeout(() => setEnter(null), 560)];
      return;
    }
    // A leaf needs words to carry; from the title page the text just inks in.
    const current = shownRef.current;
    if (direction === "forward" ? !current : !next) {
      change();
      return;
    }
    if (direction === "forward" && current) {
      setLeaf({ shown: current, scroll: leafRef.current?.scrollTop ?? 0 });
      change();
    } else if (next) {
      setLeaf({ shown: next, scroll: 0 });
      timers.current.push(window.setTimeout(change, TURN_MS - 60));
    }
    setTurning(direction);
    timers.current.push(
      window.setTimeout(() => {
        setTurning(null);
        setLeaf(null);
      }, TURN_MS),
    );
  }, []);

  const open = useCallback(
    async (id: string, at?: string, terms: string[] = [], { animate = true, reveal = true, quiet = false } = {}) => {
      const current = shownRef.current;
      const onPage = !narrow() || viewRef.current === "page";
      if (current && current.data.page.id === id) {
        setShown({ data: current.data, terms, at });
        if (onPage) {
          setArrive({ at, nonce: Date.now() });
        } else {
          turn(animate ? "forward" : null, null, () => {
            setView("page");
            setArrive({ at, nonce: Date.now() });
          });
        }
        return;
      }
      const data = await fetchPage(id);
      if (!data) {
        if (!quiet) setPageFailed(true);
        return;
      }
      setPageFailed(false);
      let direction: Turn | null = null;
      if (animate) {
        if (current) direction = data.page.folio >= current.data.page.folio ? "forward" : "back";
        else direction = "forward";
        if (!onPage) direction = "forward";
      }
      turn(direction, { data, terms, at }, () => {
        setShown({ data, terms, at });
        if (reveal) setView("page");
        setArrive({ at, nonce: Date.now() });
      });
      try {
        window.localStorage.setItem(LAST_KEY, id);
      } catch {
        // A private window has no storage; the book still reads.
      }
      pageChanged.current?.(id, at);
      if (data.next) void fetchPage(data.next.id);
      if (data.prev) void fetchPage(data.prev.id);
    },
    [fetchPage, turn],
  );

  // The contents, then the page to open on: a deep link, else where this
  // device left off. Neither turns a leaf; the book simply opens there.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadContents();
      let first = startAt;
      if (!first) {
        try {
          first = window.localStorage.getItem(LAST_KEY) ?? undefined;
        } catch {
          first = undefined;
        }
      }
      // On a phone a deep link opens on its page; a plain visit opens on the
      // contents, with the last page read waiting behind it.
      if (first) void open(first, startAnchor, [], { animate: false, reveal: Boolean(startAt), quiet: !startAt });
    }, 0);
    return () => window.clearTimeout(timer);
    // Only on arrival: later changes to the props are this reader's own navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Where the page lands: the passage asked for, lit as it arrives, or the top.
  useLayoutEffect(() => {
    if (!arrive) return;
    const leaf = leafRef.current;
    if (!leaf) return;
    const target = arrive.at ? leaf.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(arrive.at)}"]`) : null;
    if (target) {
      // On a phone the page is still swinging in (rotated in 3D) when it
      // lands, and on a long page that perspective moves a heading by
      // hundreds of pixels: let the swing finish, then glide to the passage.
      const swinging = leaf.closest<HTMLElement>(".rb-leaf")?.getAnimations().filter((animation) => animation.playState === "running") ?? [];
      const glide = () => target.scrollIntoView({ block: "start", behavior: still() ? "auto" : "smooth" });
      if (swinging.length) void Promise.all(swinging.map((animation) => animation.finished)).then(glide, glide);
      else glide();
      target.classList.remove("rb-arrive");
      void target.offsetWidth;
      target.classList.add("rb-arrive");
      return;
    }
    leaf.scrollTop = 0;
    const book = bookRef.current;
    if (book && narrow() && book.getBoundingClientRect().top < 0) book.scrollIntoView({ block: "start" });
  }, [arrive]);

  const goContents = useCallback(() => {
    turn("back", null, () => setView("contents"));
  }, [turn]);

  const step = useCallback(
    (direction: Turn) => {
      const current = shownRef.current?.data;
      const target = direction === "forward" ? current?.next : current?.prev;
      if (target) void open(target.id);
    },
    [open],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || typing(event.target)) return;
      if (event.key === "ArrowRight") step("forward");
      else if (event.key === "ArrowLeft") step("back");
      else if (event.key === "/") {
        event.preventDefault();
        if (narrow() && view === "page") goContents();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, goContents, view]);

  const toggleMark = useCallback(() => {
    const id = shownRef.current?.data.page.id;
    if (!id) return;
    setBookmarks((previous) => {
      const next = previous.includes(id) ? previous.filter((mark) => mark !== id) : [id, ...previous].slice(0, 60);
      try {
        window.localStorage.setItem(MARKS_KEY, JSON.stringify(next));
      } catch {
        // Unsaved, but still marked for this visit.
      }
      return next;
    });
  }, []);

  // Spell and magic item names, for the italic cross references.
  const xrefs = useMemo(() => {
    const map = new Map<string, string>();
    for (const chapter of contents?.chapters ?? []) {
      for (const entry of chapter.entries) {
        if (entry.kind === "spell" || entry.kind === "item") map.set(entry.title.toLowerCase(), entry.id);
      }
    }
    return map;
  }, [contents]);

  const openFromContents: OpenFromContents = useCallback((id, at, terms) => void open(id, at, terms), [open]);
  const openFromPage = useCallback((id: string, at?: string) => void open(id, at), [open]);
  const current = shown?.data.page.id ?? null;
  const marked = current ? bookmarks.includes(current) : false;

  return (
    <div className={cn("rb-desk", embedded && "rb-desk-embedded")}>
      <div
        ref={bookRef}
        className={cn("rb-book", turning && `rb-turning-${turning}`)}
        data-view={view}
        data-enter={enter ?? undefined}
      >
        <section className="rb-leaf rb-left" aria-label="Contents and search">
          <div className="rb-leaf-scroll">
            {contentsFailed ? (
              <div className="rb-trouble">
                <p>The rulebook could not be opened just now.</p>
                <button type="button" className="rb-chip motion-press" onClick={() => void loadContents()}>
                  Try again
                </button>
              </div>
            ) : (
              <RulebookContents contents={contents} current={current} bookmarks={bookmarks} onOpen={openFromContents} searchRef={searchRef} />
            )}
          </div>
        </section>

        <span className="rb-gutter" aria-hidden="true" />

        <section
          className="rb-leaf rb-right"
          aria-label={shown ? shown.data.page.title : "The Rulebook"}
          onTouchStart={(event) => {
            const point = event.touches[0];
            touch.current = point ? { x: point.clientX, y: point.clientY } : null;
          }}
          onTouchEnd={(event) => {
            const from = touch.current;
            const point = event.changedTouches[0];
            touch.current = null;
            if (!from || !point) return;
            const dx = point.clientX - from.x;
            if (Math.abs(dx) < 70 || Math.abs(point.clientY - from.y) > 50) return;
            step(dx < 0 ? "forward" : "back");
          }}
        >
          <div className="rb-toolbar">
            <button type="button" className="rb-tool rb-tool-contents" onClick={goContents}>
              <List className="size-4" aria-hidden="true" /> Contents
            </button>
            <span className="rb-toolbar-space" />
            <button
              type="button"
              className="rb-tool rb-tool-step"
              aria-label="Previous page"
              disabled={!shown?.data.prev}
              onClick={() => step("back")}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              className="rb-tool rb-tool-step"
              aria-label="Next page"
              disabled={!shown?.data.next}
              onClick={() => step("forward")}
            >
              <ChevronRight className="size-4" />
            </button>
            {shown ? (
              <button
                type="button"
                className="rb-tool rb-tool-mark"
                aria-pressed={marked}
                aria-label={marked ? "Remove the bookmark" : "Bookmark this page"}
                title={marked ? "Remove the bookmark" : "Bookmark this page"}
                onClick={toggleMark}
              >
                <Bookmark className="size-4" fill={marked ? "currentColor" : "none"} />
              </button>
            ) : null}
          </div>

          <div ref={leafRef} className="rb-leaf-scroll">
            {pageFailed && !shown ? (
              <div className="rb-trouble">
                <p>That page could not be found in the book.</p>
              </div>
            ) : shown ? (
              <div key={shown.data.page.id} className="rb-page-in" data-no-motion>
                <RulebookPage data={shown.data} terms={shown.terms} at={shown.at} xrefs={xrefs} onOpen={openFromPage} canStart={!embedded} />
              </div>
            ) : (
              <Frontispiece onBegin={() => void open("racial-traits")} />
            )}
          </div>
          {marked ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={current} src="/assets/ui/ribbon-bookmark.webp" alt="" className="rb-ribbon" />
          ) : null}
        </section>

        <div className="rb-turner" aria-hidden="true" inert>
          <div className="rb-turner-face rb-turner-front">
            {leaf ? (
              <div className="rb-leaf-scroll">
                <div style={{ transform: `translateY(${-leaf.scroll}px)` }}>
                  <RulebookPage data={leaf.shown.data} terms={leaf.shown.terms} at={leaf.shown.at} xrefs={xrefs} onOpen={openFromPage} canStart={!embedded} />
                </div>
              </div>
            ) : null}
          </div>
          <div className="rb-turner-face rb-turner-back" />
        </div>
      </div>

      {coverOn ? (
        <button
          type="button"
          className="rb-cover"
          aria-label="Open the book"
          onClick={(event) => event.currentTarget.classList.add("rb-cover-now")}
          onAnimationEnd={(event) => {
            if (event.animationName === "rb-cover-open") setCoverOn(false);
          }}
        >
          <span className="rb-cover-frame" aria-hidden="true" />
          <span className="rb-cover-title">The Rulebook</span>
          <span className="rb-cover-sub">Fifth Edition</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/ui/wax-seal-gold.webp" alt="" className="rb-cover-seal" />
        </button>
      ) : null}
    </div>
  );
}

function Frontispiece({ onBegin }: { onBegin: () => void }) {
  return (
    <div className="rb-frontis">
      <p className="rb-running">Open Dungeon Master</p>
      <h1 className="rb-frontis-title">The Rulebook</h1>
      <p className="rb-frontis-sub">Fifth Edition &middot; System Reference Document 5.1</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/ui/divider-rule.webp" alt="" width={512} height={33} className="rb-divider" />
      <p className="rb-frontis-text">
        Every rule of the game in one volume: the races and classes, equipment, how to use ability scores,
        adventuring, combat, spellcasting, every spell, magic item and monster, and the conditions they inflict.
      </p>
      <p className="rb-frontis-text">
        Three books are bound here: the players&apos;, the Dungeon Master&apos;s and the monsters&apos;, each
        holding all that the reference document opens of the Player&apos;s Handbook, the Dungeon Master&apos;s
        Guide and the Monster Manual.
      </p>
      <p className="rb-frontis-text">
        Search from the contents page, or open a chapter. The arrow keys turn the pages, and a bookmark keeps a
        page one tap away.
      </p>
      <button type="button" className="rb-chip rb-begin motion-press" onClick={onBegin}>
        Begin at chapter I
      </button>
    </div>
  );
}
