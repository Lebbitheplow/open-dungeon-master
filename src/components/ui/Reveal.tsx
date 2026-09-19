"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { replayAnimation } from "@/lib/motion/replay";

// State-change motion for call sites that used to write `open ? <X /> : null`
// (classes in src/app/styles/motion-app.css). Reveal plays the arrival and,
// because it holds the last content for one short beat after `open` turns
// false, the leaving too. The content is only ever rendered by the caller, so
// `<Reveal open={Boolean(x)}>{x ? <Form x={x} /> : null}</Reveal>` is safe.

const ENTER = {
  height: "reveal-height",
  fade: "reveal",
  pop: "reveal-pop",
  scale: "reveal-scale",
  banner: "reveal-banner",
  row: "live-in",
} as const;

// Matches --dur-quick plus a frame; a timer rather than animationend, because
// under reduced motion there is no animation to end.
const LEAVE_MS = 200;

export function Reveal({
  open,
  children,
  variant = "height",
  className,
  innerClassName,
}: {
  open: boolean;
  children: ReactNode;
  variant?: keyof typeof ENTER;
  // On the outer element. For "height" the outer element is the grid that
  // collapses, so spacing utilities belong here and layout on innerClassName.
  className?: string;
  innerClassName?: string;
}) {
  const [kept, setKept] = useState<ReactNode>(open ? children : null);
  // The last content seen while open, so it can be shown on the way out even
  // when the caller already renders null.
  if (open && kept !== children) setKept(children);

  useEffect(() => {
    if (open || kept === null) return;
    const timer = window.setTimeout(() => setKept(null), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [open, kept]);

  const content = open ? children : kept;
  if (content === null || content === undefined || content === false) return null;
  const leaving = !open;

  if (variant === "height") {
    return (
      <div className={cn("reveal-height", className)} data-leaving={leaving ? "" : undefined} aria-hidden={leaving || undefined}>
        <div className={innerClassName}>{content}</div>
      </div>
    );
  }
  return (
    <div className={cn(leaving ? "reveal-leave" : ENTER[variant], className)} aria-hidden={leaving || undefined}>
      {content}
    </div>
  );
}

// A number (or a short label) that pops when it changes and sits still on the
// first paint, so a panel full of values does not flinch when it opens.
export function CountPop({
  value,
  children,
  className,
}: {
  value: string | number | boolean | null | undefined;
  children?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    replayAnimation(ref.current, "app-count-pop var(--dur-move) var(--ease-spring)");
  }, [value]);
  return (
    <span ref={ref} className={cn("inline-block", className)}>
      {children ?? (typeof value === "boolean" ? null : value)}
    </span>
  );
}
