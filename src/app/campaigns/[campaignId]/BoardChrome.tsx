"use client";

import { EyeOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { GameIcon } from "@/components/ui/GameIcon";
import { glyphFor } from "@/lib/battlemap/condition-glyphs";
import { HEALTH_LABEL, HEALTH_RING, type HealthWord } from "@/lib/battlemap/health-words";
import type { StageToken } from "@/app/campaigns/[campaignId]/BoardStage";
import type { PublicEncounter } from "@/lib/db/encounter-view";

// The chrome on the board as a stage (docs/visual-overhaul-plan.md 5.1): the
// initiative rail, the turn HUD, the turn banner, the hover plate and the
// target chips. All of it is display: each piece states a fact the projection
// already carries and sends a tap back up; none of it decides a rule.

// A face, never a letter, wherever a combatant is shown. The caller hands the
// pictures in order of preference (own portrait, the monster's own art, the
// placeholder plate, the class emblem); each that fails to load gives way to
// the next, and the initial is what is left when none load.
export function TokenFace({
  candidates,
  name,
  className,
  enemy = false,
}: {
  candidates: Array<string | null | undefined>;
  name: string;
  className?: string;
  enemy?: boolean;
}) {
  const list = candidates.filter((src): src is string => Boolean(src));
  const key = list.join("|");
  const [attempt, setAttempt] = useState(0);
  const [shownFor, setShownFor] = useState(key);
  // A row can be reused for another combatant; start its chain again.
  if (shownFor !== key) {
    setShownFor(key);
    setAttempt(0);
  }
  const src = list[attempt];
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-stone-950 font-display text-[11px] font-bold",
        enemy ? "text-red-300" : "text-amber-100",
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 size-full object-cover"
          onError={() => setAttempt((n) => n + 1)}
        />
      ) : (
        <span aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

export type FaceLookup = (entry: { id: string; kind: string; name: string }) => Array<string | null | undefined>;

// Top-left: the order as portrait plates, the current one framed and
// breathing. Display only; a tap opens the order (the DM's editable panel,
// or the plain list for a player).
export function InitiativeRail({
  encounter,
  round,
  faceOf,
  onOpen,
}: {
  encounter: PublicEncounter;
  round: number;
  faceOf: FaceLookup;
  onOpen?: () => void;
}) {
  if (!encounter.orderReady || !encounter.order.length) {
    return null;
  }
  // A short order is shown as it stands. A longer one is a window on the
  // cycle, starting one before the current turn, so whoever is up and whoever
  // is next are always inside it; a narrow board (a phone, the side panel)
  // shows the first NARROW of them and the enlarged board all MAX.
  const MAX = 7;
  const NARROW = 5;
  const order = encounter.order;
  const cyclic = order.length > NARROW;
  const start = cyclic ? (encounter.turnIndex - 1 + order.length) % order.length : 0;
  const shown = Array.from({ length: Math.min(MAX, order.length) }, (_, i) => {
    const at = (start + i) % order.length;
    return { entry: order[at], at };
  });
  const more = order.length - shown.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      data-tour="battle-initiative"
      aria-label={`Round ${round}, initiative order. ${order[encounter.turnIndex]?.name ?? ""} is up. Open the order.`}
      className="absolute left-2 top-2 z-10 flex flex-col items-start gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 @md:left-3.5 @md:top-3.5 @md:gap-1.5"
    >
      <span className="board-eyebrow">
        Round {round}
        <span className="hidden @md:inline"> · initiative</span>
      </span>
      <span className="flex gap-[3px] @md:gap-[5px]">
        {shown.map(({ entry, at }, index) => {
          const current = at === encounter.turnIndex;
          return (
            <span
              key={`${entry.id}-${at}`}
              title={`${entry.name}${entry.hidden ? " (hidden)" : ""}${entry.initiative !== undefined ? ` · ${entry.initiative}` : ""}`}
              className={cn(
                "board-plate relative block h-[38px] w-[31px] overflow-hidden rounded-[6px] border bg-[#0d0b1c] shadow-[0_2px_6px_rgba(4,2,12,0.55)] @md:h-14 @md:w-[46px] @md:rounded-[7px]",
                current ? "border-transparent" : "border-[rgba(227,193,92,0.25)]",
                !current && "opacity-80",
                index >= NARROW && "hidden @md:block",
              )}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <TokenFace
                candidates={faceOf(entry)}
                name={entry.name}
                enemy={entry.kind === "enemy"}
                className={cn("absolute inset-0 size-full", entry.hidden && "opacity-50")}
              />
              {entry.initiative !== undefined ? (
                <span className="absolute inset-x-0 bottom-0 bg-[rgba(8,6,18,0.85)] text-center font-mono text-[8px] leading-[11px] text-[#aeaac6] @md:text-[9px] @md:leading-3">
                  {entry.initiative}
                </span>
              ) : null}
              {entry.hidden ? (
                <EyeOff className="absolute right-0.5 top-0.5 size-2.5 text-amber-300 drop-shadow" aria-hidden="true" />
              ) : null}
              {current ? (
                <span className="board-plate-current absolute inset-0 rounded-[6px] border-2 border-[#d4ab3a] @md:rounded-[7px]" />
              ) : null}
            </span>
          );
        })}
        {order.length > NARROW ? (
          <span className="board-glass flex h-[38px] items-center rounded-[6px] px-1 font-mono text-[9px] @md:hidden">
            +{order.length - NARROW}
          </span>
        ) : null}
        {more > 0 ? (
          <span className="board-glass hidden h-14 items-center rounded-[6px] px-1 font-mono text-[9px] @md:flex">
            +{more}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// The action economy, when the projection carries it. It does not yet: the
// budget lives in src/lib/dm/action-budget.ts on the server and is not
// projected, so the pips are drawn only for a seat that was sent one.
export type TurnHudBudget = { action: boolean; bonus: boolean; reaction: boolean };

const PIPS: Array<{ key: keyof TurnHudBudget; label: string }> = [
  { key: "action", label: "ACTION" },
  { key: "bonus", label: "BONUS" },
  { key: "reaction", label: "REACTION" },
];

// Top-right: whose turn, and on your own turn what you have left.
export function TurnHud({
  actorName,
  mine,
  budget,
  speedLeftFeet,
  ac,
  hp,
}: {
  actorName: string;
  mine: boolean;
  budget?: TurnHudBudget | null;
  speedLeftFeet?: number | null;
  ac?: number | null;
  hp?: { current: number; max: number } | null;
}) {
  if (!actorName) {
    return null;
  }
  const stats = [
    typeof speedLeftFeet === "number" ? `${speedLeftFeet} ft left` : null,
    typeof ac === "number" ? `AC ${ac}` : null,
    hp ? `${hp.current}/${hp.max}` : null,
  ].filter(Boolean);
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-10 flex max-w-[58%] flex-col items-end gap-1 @md:right-3.5 @md:top-3.5 @md:gap-[7px]">
      <span className="board-eyebrow block max-w-full truncate text-right">{mine ? `${actorName} · your turn` : `${actorName}'s turn`}</span>
      {mine && budget ? (
        // On a narrow board the pips and the stats sit under the rail's
        // plates instead of beside them, where there is no room.
        <div className="mt-[42px] flex flex-wrap justify-end gap-1 @md:mt-0 @md:gap-1.5">
          {PIPS.map((pip) => {
            const left = budget[pip.key];
            return (
              <span
                key={pip.key}
                className={cn(
                  // A spent pip dims over a beat instead of blinking out.
                  "flex items-center gap-[5px] rounded-full border px-2 py-[3px] font-mono text-[9px] tracking-[0.04em] transition-colors duration-[420ms] ease-snap @md:text-[10px]",
                  left
                    ? "border-[rgba(212,171,58,0.55)] bg-[rgba(43,32,8,0.7)] text-[#f9ecc8]"
                    : "border-[rgba(107,99,148,0.3)] bg-[rgba(13,11,28,0.7)] text-[#575170]",
                )}
              >
                <span className={cn("size-1.5 rounded-full transition-colors duration-[420ms] ease-snap", left ? "bg-[#d4ab3a]" : "bg-[#3a3358]")} />
                {pip.label}
              </span>
            );
          })}
        </div>
      ) : null}
      {mine && stats.length ? (
        <div className={cn("board-glass rounded-lg px-[9px] py-1 font-mono text-[9px] @md:mt-0 @md:text-[10px]", !budget && "mt-[42px]")}>
          {stats.join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

// The banner that wipes across the board when the turn changes. Keyed by the
// caller so a new turn replays it; it removes itself by ending transparent.
export function TurnBanner({ text, mine }: { text: string; mine: boolean }) {
  const ink = mine ? "#f4e0a6" : "#e9e6f4";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[42%] z-10 flex flex-col items-center gap-2" aria-hidden="true">
      <div
        className="board-banner px-[30px] py-[9px]"
        style={{
          background:
            "linear-gradient(90deg,rgba(13,11,28,0),rgba(13,11,28,.94) 18%,rgba(13,11,28,.94) 82%,rgba(13,11,28,0))",
        }}
      >
        <span
          className="block font-display text-lg font-bold tracking-[0.06em] @md:text-[26px]"
          style={{ transform: "skewX(14deg)", color: ink, textShadow: "0 2px 12px rgba(0,0,0,.8)" }}
        >
          {text}
        </span>
      </div>
      <div
        className="board-banner-rule h-px w-[220px]"
        style={{ background: `linear-gradient(90deg,transparent,${ink},transparent)` }}
      />
    </div>
  );
}

function HealthWordChip({ word }: { word: HealthWord }) {
  return (
    <span
      className="rounded-full border px-1.5 py-px text-[10px] font-medium"
      style={{ borderColor: `${HEALTH_RING[word]}99`, color: HEALTH_RING[word], background: "rgba(8,6,18,0.6)" }}
    >
      {HEALTH_LABEL[word] ?? word}
    </span>
  );
}

export function ConditionChip({ label, rounds }: { label: string; rounds?: number }) {
  const glyph = glyphFor(label);
  return (
    <span className="fx-pop inline-flex items-center gap-1 rounded-full border border-amber-900/60 bg-amber-950/30 py-px pl-px pr-1.5 text-[10px] capitalize text-amber-300">
      <GameIcon icon={{ kind: "condition", key: glyph.id }} size="size-4" />
      {label}
      {rounds ? ` (${rounds} rd)` : ""}
    </span>
  );
}

// The board's hover plate: what the native tooltip used to say, as a plate.
// Name, health word, conditions. Shown on hover, and on a tap for a phone.
export function TokenPlate({
  token,
  boardWidth,
  boardHeight,
  footprint,
  face,
  health,
  conditions,
}: {
  token: StageToken;
  boardWidth: number;
  boardHeight: number;
  footprint: number;
  face: Array<string | null | undefined>;
  health?: HealthWord;
  conditions?: Array<{ id: string; label: string; rounds?: number }>;
}) {
  const cx = ((token.x + footprint / 2) / boardWidth) * 100;
  // Below the figure near the top edge, above it everywhere else.
  const below = token.y < boardHeight / 3;
  const cy = ((below ? token.y + footprint : token.y) / boardHeight) * 100;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 w-max max-w-[220px] animate-fade-up rounded-lg border border-[rgba(107,99,148,0.4)] bg-[rgba(8,6,18,0.94)] p-1.5 text-[#e9e6f4] shadow-elev-2"
      style={{
        left: `${Math.min(88, Math.max(12, cx))}%`,
        top: `${cy}%`,
        // `translate`, not `transform`: the fade-up animates transform and
        // holds its last frame, which would drop the plate's own offset.
        translate: below ? "-50% 6px" : "-50% calc(-100% - 6px)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <TokenFace
          candidates={face}
          name={token.name}
          enemy={token.kind === "enemy"}
          className="size-7 rounded-full border border-[rgba(227,193,92,0.35)]"
        />
        <span className="min-w-0">
          <span className="block truncate font-display text-xs font-semibold">{token.name}</span>
          {health ? <HealthWordChip word={health} /> : null}
        </span>
      </div>
      {conditions?.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {conditions.map((condition, index) => (
            <ConditionChip key={`${condition.id}-${index}`} label={condition.label} rounds={condition.rounds} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// The phone's way to pick a target: every legal one as a chip with its face,
// its health word and how far it stands. A finger covers a 32 px figure; it
// does not cover a chip.
export function TargetChips({
  targets,
  onPick,
  onHover,
}: {
  targets: Array<{
    token: StageToken;
    face: Array<string | null | undefined>;
    health?: HealthWord;
    feet: number | null;
  }>;
  onPick: (tokenId: string) => void;
  onHover?: (tokenId: string | null) => void;
}) {
  if (!targets.length) {
    return <p className="text-[11px] text-stone-500">Nobody here to aim at.</p>;
  }
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Targets">
      {targets.map(({ token, face, health, feet }, index) => (
        <button
          key={token.id}
          type="button"
          onClick={() => onPick(token.id)}
          onPointerEnter={() => onHover?.(token.id)}
          onPointerLeave={() => onHover?.(null)}
          onFocus={() => onHover?.(token.id)}
          onBlur={() => onHover?.(null)}
          className="motion-press flex shrink-0 animate-fade-up items-center gap-1.5 rounded-full border border-ember-500/50 bg-stone-950/80 py-0.5 pl-0.5 pr-2.5 text-left hover:border-ember-500 hover:bg-red-950/30"
          style={{ animationDelay: `${index * 40}ms` }}
        >
          <TokenFace
            candidates={face}
            name={token.name}
            enemy={token.kind === "enemy"}
            className="size-8 rounded-full border border-ember-500/60"
          />
          <span className="min-w-0">
            <span className="block max-w-[9rem] truncate text-xs font-medium text-stone-100">{token.name}</span>
            <span className="block font-mono text-[10px] text-stone-400">
              {[health ? HEALTH_LABEL[health] ?? health : null, feet !== null ? `${feet} ft` : null].filter(Boolean).join(" · ")}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

// The die on the field: the D20Spinner's geometry at board scale, six held
// faces, and the label under it. Shown while a roll is in the air for a
// commit made from the board; the number itself lands in the chronicle.
const FIELD_FACES = [17, 4, 20, 11, 8, 14];

export function FieldDie({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 fx-pop" aria-hidden="true">
      <div className="relative flex size-[72px] items-center justify-center @md:size-[104px]">
        <svg viewBox="0 0 24 24" className="absolute inset-0 size-full text-[#f9ecc8] drop-shadow-[0_0_14px_rgba(212,171,58,0.45)]">
          <g
            className="check-die-body"
            data-rolling="loop"
            fill="rgba(13,11,28,0.92)"
            stroke="currentColor"
            strokeWidth={1.1}
            strokeLinejoin="round"
            style={{ "--check-run": "4320ms" } as React.CSSProperties}
          >
            <path d="M12 2 L20.66 7 L20.66 17 L12 22 L3.34 17 L3.34 7 Z" />
            <path d="M12 6 L17 15 L7 15 Z" fill="rgba(212,171,58,0.14)" />
            <path d="M12 6 L12 2 M12 6 L20.66 7 M12 6 L3.34 7 M17 15 L20.66 17 M7 15 L3.34 17 M17 15 L12 22 M7 15 L12 22" fill="none" />
          </g>
        </svg>
        {FIELD_FACES.map((n, i) => (
          <span
            key={n}
            className="check-face absolute inset-0 flex items-center justify-center font-display text-2xl font-bold text-[#f9ecc8] @md:text-[38px]"
            style={{ animationDuration: "720ms", animationDelay: `${-i * 120}ms`, opacity: i === 0 ? 1 : 0 }}
          >
            {n}
          </span>
        ))}
      </div>
      <span className="board-eyebrow text-[10px] text-[#ecd287]">{label}</span>
    </div>
  );
}
