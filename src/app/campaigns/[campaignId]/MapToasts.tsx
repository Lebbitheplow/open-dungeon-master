"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Check } from "lucide-react";
import { cn } from "@/lib/cn";

// The ember toast (docs/visual-overhaul-plan.md 4.6). A refused stroke used to
// land as a red line under the whole editor, easy to miss with the eyes on the
// canvas; now it rises over the canvas, holds, and leaves on its own after 2.4
// seconds. The words are the server's own sentence, never rewritten here. The
// timer removes it, so it still goes where the animation is switched off.

export type MapToast = { id: number; text: string; tone: "refused" | "done" };

const TOAST_MS = 2400;
const STACK = 3;

export function useMapToasts() {
  const [toasts, setToasts] = useState<MapToast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const push = useCallback((text: string, tone: MapToast["tone"] = "refused") => {
    if (!text) {
      return;
    }
    const id = nextId.current++;
    setToasts((current) => [...current, { id, text, tone }].slice(-STACK));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, TOAST_MS),
    );
  }, []);

  return { toasts, push };
}

export function MapToastStack({ toasts, className }: { toasts: MapToast[]; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-1.5 px-3", className)}
    >
      {toasts.map((toast) => (
        <p
          key={toast.id}
          className={cn(
            "map-toast flex max-w-md items-center gap-2 rounded-lg border px-3 py-2 text-[12px] shadow-elev-2 backdrop-blur",
            toast.tone === "refused"
              ? "border-ember-500/50 bg-stone-950/90 text-ember-300 shadow-glow-ember"
              : "border-emerald-700/50 bg-stone-950/90 text-emerald-300",
          )}
        >
          {toast.tone === "refused" ? <CircleAlert className="size-3.5 shrink-0" /> : <Check className="size-3.5 shrink-0" />}
          {toast.text}
        </p>
      ))}
    </div>
  );
}
