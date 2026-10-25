"use client";

import { useState } from "react";
import { iconCandidates, type IconRef } from "@/lib/icons";
import { cn } from "@/lib/cn";

// Action illustrations use the available rectangle without cropping or zoom.
// Other icons retain their lit circular plate and magnification. The fallback
// chain tries the requested painting, then its family, then renders nothing.
const SNUG_KINDS = new Set<IconRef["kind"]>(["glyph", "condition"]);

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
  const actionArt = candidates[attempt].startsWith("/assets/icons/action/");
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden",
        actionArt
          ? "rounded-md"
          : "rounded-full border border-amber-700/50 bg-[radial-gradient(circle_at_50%_36%,#5b4c3a,#1d1712_80%)] p-px shadow-inner",
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
        className={cn(
          "size-full object-contain",
          !actionArt && "[filter:drop-shadow(0_0_1px_rgba(255,224,160,0.75))_brightness(1.06)]",
          !actionArt && (SNUG_KINDS.has(icon.kind) ? "scale-[1.25]" : "scale-[1.7]"),
        )}
        onError={() => setAttempt((n) => n + 1)}
      />
    </span>
  );
}
