"use client";

import { useState } from "react";
import { iconCandidates, type IconRef } from "@/lib/icons";
import { cn } from "@/lib/cn";

// A painted icon on its plate: a disc lit from its centre with a thin gold
// rim, the same plate for every icon so a list of them reads as one set. Many
// paintings are dark figures (a hooded rogue, a petrified statue); the lit
// centre and a hair of warm rim light keep them readable on the night theme. Tries the thing's
// own painting, then its family's, then renders nothing, so a homebrew spell
// never shows a broken image (src/lib/icons.ts). The paintings ship with a wide
// margin, so the image is scaled up inside the plate and the rim crops it.
export function GameIcon({ icon, size = "size-6", className }: { icon: IconRef; size?: string; className?: string }) {
  const candidates = iconCandidates(icon);
  const [attempt, setAttempt] = useState(0);
  const [shownFor, setShownFor] = useState(candidates[0]);
  // A list row can be reused for another thing; start its chain again.
  if (shownFor !== candidates[0]) {
    setShownFor(candidates[0]);
    setAttempt(0);
  }
  if (attempt >= candidates.length) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-amber-700/50 bg-[radial-gradient(circle_at_50%_36%,#5b4c3a,#1d1712_80%)] p-px shadow-inner",
        size,
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={candidates[attempt]}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-full scale-[1.7] object-contain [filter:drop-shadow(0_0_1px_rgba(255,224,160,0.75))_brightness(1.06)]"
        onError={() => setAttempt((n) => n + 1)}
      />
    </span>
  );
}
