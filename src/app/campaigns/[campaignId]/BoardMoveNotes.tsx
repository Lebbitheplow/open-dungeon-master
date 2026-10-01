"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Flame, Footprints, Swords } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MoveNote } from "@/lib/battlemap/board-move";

// What a walk met on the way, as the move route reported it
// (src/lib/battlemap/board-move.ts moveNotesFrom): an enemy's opportunity
// attack, Spike Growth's spikes, a web's hold. The engine's own lines, never
// rewritten. They rise over the board one after another, hold long enough to
// read, and leave on their own; the timer removes them, so they still go
// where the animation is switched off.

const HOLD_MS = 5600;
const STACK = 4;

type Shown = MoveNote & { id: number };

export function useMoveNotes() {
  const [notes, setNotes] = useState<Shown[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const push = useCallback((incoming: MoveNote[]) => {
    if (!incoming.length) return;
    const fresh = incoming.map((note) => ({ ...note, id: nextId.current++ }));
    setNotes((current) => [...current, ...fresh].slice(-STACK));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      const gone = new Set(fresh.map((note) => note.id));
      setNotes((current) => current.filter((note) => !gone.has(note.id)));
    }, HOLD_MS + fresh.length * 90);
    timers.current.add(timer);
  }, []);

  return { notes, push };
}

export function BoardMoveNotes({ notes }: { notes: Shown[] }) {
  if (!notes.length) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 top-12 z-20 flex flex-col items-center gap-1.5 px-3"
    >
      {notes.map((note, index) => (
        <p
          key={note.id}
          style={{ "--i": index } as CSSProperties}
          className={cn(
            "move-note flex max-w-md items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-snug shadow-elev-2 backdrop-blur",
            note.tone === "struck"
              ? "border-ember-500/50 bg-stone-950/90 text-ember-300 shadow-glow-ember"
              : note.tone === "move"
                ? "border-emerald-700/50 bg-stone-950/90 text-emerald-200"
                : "border-amber-600/50 bg-stone-950/90 text-amber-200",
          )}
        >
          {note.tone === "struck" ? (
            <Swords className="mt-0.5 size-3.5 shrink-0" />
          ) : note.tone === "move" ? (
            <Footprints className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <Flame className="mt-0.5 size-3.5 shrink-0" />
          )}
          {note.text}
        </p>
      ))}
    </div>
  );
}
