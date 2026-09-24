"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

// A painted book with turning pages, for reading something that has chapters
// (the story archive; docs/visual-overhaul-plan.md 8b.4). Each entry is a
// spread: its heading on the left page, its text on the right. Turning a page
// flips a painted leaf across the spine while the words change beneath it.
// On a phone the spread becomes one page at a time with the same turn.
//
// The pages are ordinary DOM over painted art, so the text is selectable and
// read by a screen reader; arrows, swipe and the buttons all turn the page.
export type BookEntry = { id: string; heading: string; kicker?: string; body: string; note?: string };

const TURN_MS = 620;

export function Book({
  open,
  onOpenChange,
  title,
  entries,
  startAt = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The accessible name of the book, and what is lettered above it.
  title: string;
  entries: BookEntry[];
  startAt?: number;
}) {
  const [index, setIndex] = useState(startAt);
  // The direction of a turn in flight, or null at rest.
  const [turning, setTurning] = useState<"forward" | "back" | null>(null);
  const timer = useRef<number | null>(null);
  const touchX = useRef<number | null>(null);
  const last = Math.max(0, entries.length - 1);
  const at = Math.min(index, last);

  // Opening the book turns to the starting spread; reading it does not.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setIndex(Math.min(startAt, last));
  }

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const turn = useCallback(
    (direction: "forward" | "back") => {
      if (turning) return;
      const next = direction === "forward" ? at + 1 : at - 1;
      if (next < 0 || next > last) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (still) {
        setIndex(next);
        return;
      }
      setTurning(direction);
      // The words change when the leaf is edge on, halfway through the turn.
      window.setTimeout(() => setIndex(next), TURN_MS / 2);
      timer.current = window.setTimeout(() => setTurning(null), TURN_MS);
    },
    [at, last, turning],
  );

  const entry = entries[at];
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay fixed inset-0 z-[60] bg-[#05030d]/80 backdrop-blur-sm" />
        <RadixDialog.Content
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") turn("forward");
            if (event.key === "ArrowLeft") turn("back");
          }}
          onTouchStart={(event) => {
            touchX.current = event.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(event) => {
            const from = touchX.current;
            const to = event.changedTouches[0]?.clientX;
            touchX.current = null;
            if (from === null || to === undefined || Math.abs(to - from) < 48) return;
            turn(to < from ? "forward" : "back");
          }}
          className="fixed left-1/2 top-1/2 z-[61] w-[min(96vw,64rem)] -translate-x-1/2 -translate-y-1/2 outline-none"
        >
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <RadixDialog.Title className="gold-title font-display text-xl sm:text-2xl">{title}</RadixDialog.Title>
            <RadixDialog.Close aria-label="Close the book" className="motion-nudge rounded-md p-1.5 text-stone-300 hover:text-amber-200">
              <X className="size-5" />
            </RadixDialog.Close>
          </div>

          <div className={cn("kit-book", turning === "forward" && "kit-book-forward", turning === "back" && "kit-book-back")}>
            {entry ? (
              <>
                <section className="kit-book-page kit-book-left" aria-hidden={false}>
                  {entry.kicker ? <p className="reveal kit-book-kicker">{entry.kicker}</p> : null}
                  <h2 className="kit-book-heading">{entry.heading}</h2>
                  {/* A gold hairline drawn by furniture.css; the night storybook has no paper rule. */}
                  <span className="kit-book-rule" aria-hidden="true" />
                  {entry.note ? <p className="reveal kit-book-note">{entry.note}</p> : null}
                </section>
                <section className="kit-book-page kit-book-right">
                  <p className="kit-book-body">{entry.body}</p>
                </section>
              </>
            ) : (
              <section className="kit-book-page kit-book-left">
                <p className="kit-book-note">Nothing is written here yet.</p>
              </section>
            )}
            <span className="kit-book-leaf" aria-hidden="true" />
            <span className="kit-book-ribbon" aria-hidden="true" />
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 px-1 text-sm text-stone-300">
            <button type="button" onClick={() => turn("back")} disabled={at === 0 || Boolean(turning)} className="motion-press inline-flex items-center gap-1 rounded-lg border border-stone-600/60 bg-stone-900/60 px-3 py-1.5 disabled:opacity-40">
              <ChevronLeft className="size-4" /> Earlier
            </button>
            <span className="font-display text-xs uppercase tracking-[0.18em] text-amber-200/80" aria-live="polite">
              {entries.length ? `${at + 1} of ${entries.length}` : "Empty"}
            </span>
            <button type="button" onClick={() => turn("forward")} disabled={at >= last || Boolean(turning)} className="motion-press inline-flex items-center gap-1 rounded-lg border border-stone-600/60 bg-stone-900/60 px-3 py-1.5 disabled:opacity-40">
              Later <ChevronRight className="size-4" />
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
