"use client";

import { cn } from "@/lib/cn";

// The skill-check card (docs/visual-overhaul-plan.md 5.4, "Rolls and
// Effects" 5b): the violet frame with its thorn corners, the breathing halo,
// and the die that tumbles, takes its modifier and lands its total. Shared
// by the parked roll (PendingRollCard) and the roll as it arrives in the
// chronicle (RollCard). It is the card AROUND a roll: the 3D dice tray
// (DiceOverlay) is a different thing and is not touched from here.
//
// Violet on purpose: risk reads as a different colour from the gold of
// everything the player has already earned. Classes live in
// src/app/styles/board.css; the beat lengths come from
// src/lib/battlemap/beats.ts as custom properties.

const CORNERS: Array<{ className: string; rotate: number }> = [
  { className: "left-1 top-1", rotate: 0 },
  { className: "right-1 top-1", rotate: 90 },
  { className: "right-1 bottom-1", rotate: 180 },
  { className: "left-1 bottom-1", rotate: 270 },
];

export function CheckFrame({
  crit,
  className,
  children,
  style,
}: {
  crit?: "nat20" | "nat1" | null;
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cn("check-card", className)} data-crit={crit ?? undefined} style={style}>
      {CORNERS.map((corner) => (
        <svg
          key={corner.rotate}
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={cn("check-vine", corner.className)}
          style={{ rotate: `${corner.rotate}deg` }}
        >
          <path d="M2 22 C 2 12, 8 6, 22 2" fill="none" stroke="currentColor" strokeWidth={1.4} />
          <path d="M7 15 l -4 -1 M12 9 l -3 -3 M17 5 l -1 -4" fill="none" stroke="currentColor" strokeWidth={1.2} />
        </svg>
      ))}
      {children}
    </div>
  );
}

const FLICKER = [17, 4, 20, 11, 8, 14];

export type CheckDieState =
  // Parked: the die rests, the halo breathes.
  | "idle"
  // Sent, waiting on the server: the die tumbles until the answer is in.
  | "waiting"
  // The whole beat: tumble, flicker, the chip flies in, the total lands.
  | "landing"
  // A manual or Pixels roll: the number is already known, so it plays from
  // the modifier chip onward.
  | "landing-short"
  // History: the total, still.
  | "settled";

// The die in its well. `total` is what it settles on; `tone` colours it.
export function CheckDie({
  state,
  total,
  tone = "neutral",
  modLabel,
  modCaption,
  sides = 20,
  size = "size-[72px]",
  halo = false,
  verdict,
}: {
  state: CheckDieState;
  total?: number | string;
  tone?: "pass" | "fail" | "neutral";
  // "+3" and what it is ("Strength"); the chip that flies in and merges.
  modLabel?: string;
  modCaption?: string;
  sides?: number;
  size?: string;
  halo?: boolean;
  verdict?: string | null;
}) {
  const tumbling = state === "waiting" || state === "landing";
  const showTotal = total !== undefined && total !== "" && state !== "idle" && state !== "waiting";
  const ink = tone === "pass" ? "var(--check-pass)" : tone === "fail" ? "var(--check-fail)" : "var(--check-face)";
  return (
    <span className={cn("check-well relative flex shrink-0 items-center justify-center", size)}>
      {halo ? <span className="check-halo" aria-hidden="true" /> : null}
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="relative size-[82%]" style={{ color: "var(--check-die)" }}>
        <g
          className="check-die-body"
          data-rolling={state === "waiting" ? "loop" : state === "landing" ? "true" : undefined}
          fill="currentColor"
          stroke="var(--check-die-edge)"
          strokeWidth={1.1}
          strokeLinejoin="round"
        >
          <path d="M12 2 L20.66 7 L20.66 17 L12 22 L3.34 17 L3.34 7 Z" />
          <path d="M12 6 L17 15 L7 15 Z" fill="var(--check-die-edge)" fillOpacity={0.22} />
          <path d="M12 6 L12 2 M12 6 L20.66 7 M12 6 L3.34 7 M17 15 L20.66 17 M7 15 L3.34 17 M17 15 L12 22 M7 15 L12 22" fill="none" />
        </g>
      </svg>
      {state === "idle" ? (
        <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-bold" style={{ color: "var(--check-face)" }}>
          d{sides}
        </span>
      ) : null}
      {tumbling ? (
        <span className="check-faces absolute inset-0" data-landing={state === "landing" ? "true" : undefined} aria-hidden="true">
          {FLICKER.map((n, i) => (
            <span
              key={n}
              className="check-face absolute inset-0 flex items-center justify-center font-display text-xl font-bold"
              style={{ color: "var(--check-face)", animationDelay: `${-i * 18}ms`, opacity: i === 0 ? 1 : 0 }}
            >
              {Math.min(n, sides)}
            </span>
          ))}
        </span>
      ) : null}
      {showTotal ? (
        <>
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center font-display text-2xl font-bold",
              state === "landing" && "check-result",
              state === "landing-short" && "check-result",
            )}
            data-beat={state === "landing-short" ? "short" : undefined}
            style={{ color: ink, textShadow: `0 0 14px color-mix(in srgb, ${ink} 55%, transparent)` }}
          >
            {total}
          </span>
          {state === "landing" || state === "landing-short" ? (
            <span
              aria-hidden="true"
              className="check-glow pointer-events-none absolute inset-[-10%] rounded-full"
              style={{
                background: `radial-gradient(circle, color-mix(in srgb, ${ink} 55%, transparent), transparent 65%)`,
                ...(state === "landing-short" ? { animationDelay: "0ms" } : {}),
              }}
            />
          ) : null}
        </>
      ) : null}
      {modLabel && state === "landing" ? (
        <span className="check-mod pointer-events-none absolute right-1 top-1/2 flex flex-col items-center" aria-hidden="true">
          <span className="font-display text-lg font-bold leading-none" style={{ color: "var(--check-pass)" }}>
            {modLabel}
          </span>
          {modCaption ? (
            <span className="font-mono text-[7px] uppercase tracking-[0.1em]" style={{ color: "var(--check-pass)" }}>
              {modCaption}
            </span>
          ) : null}
        </span>
      ) : null}
      {verdict && showTotal ? (
        <span
          className={cn(
            "absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap font-display text-[10px] font-bold uppercase tracking-[0.04em]",
            state === "landing" ? "check-verdict" : state === "landing-short" ? "motion-pop" : undefined,
          )}
          style={{
            color: ink,
            rotate: state === "landing" ? undefined : "-4deg",
            textShadow: "var(--check-verdict-shadow)",
          }}
        >
          {verdict}
        </span>
      ) : null}
    </span>
  );
}

// "1d20+5+1d4" as the chips the card shows: the die, then each thing added.
export function modifierParts(expression: string): Array<{ text: string; kind: "die" | "flat" }> {
  const compact = expression.replaceAll(" ", "");
  const parts = compact.match(/[+-]?[^+-]+/g) ?? [];
  return parts.map((part, index) => {
    const isDie = /d\d/i.test(part);
    const text = index === 0 ? part.replace(/^\+/, "") : /^[+-]/.test(part) ? part : `+${part}`;
    return { text, kind: isDie ? "die" : "flat" };
  });
}

export function ModifierBreakdown({ expression, caption }: { expression: string; caption?: string }) {
  const parts = modifierParts(expression);
  if (!parts.length) {
    return null;
  }
  return (
    <span className="flex flex-wrap items-center gap-1" aria-label={`Rolls ${expression}`}>
      {parts.map((part, index) => (
        <span
          key={`${part.text}-${index}`}
          className={cn(
            "check-well px-1.5 py-0.5 font-mono text-[11px]",
            part.kind === "flat" && "font-semibold",
          )}
          style={part.kind === "flat" ? { color: "var(--check-pass)" } : undefined}
        >
          {part.text}
        </span>
      ))}
      {caption ? <span className="check-dim text-[10px] uppercase tracking-[0.1em]">{caption}</span> : null}
    </span>
  );
}
