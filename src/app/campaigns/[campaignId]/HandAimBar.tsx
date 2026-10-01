"use client";

import { ArrowLeft, Loader2, PencilLine, X } from "lucide-react";
import { useRef, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { replayAnimation } from "@/lib/motion/replay";
import { ui } from "@/lib/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import type { HandAttackOption, HandAttackOptionId, HandCard } from "@/lib/battlemap/hand";
import type { HandAim, PreviewRow } from "@/lib/battlemap/hand-play";
import { describePick, hasPick, pickHint, type AreaPick } from "@/lib/battlemap/hand-area";
import { HandPreviewRows, typeLabel, typeTone } from "@/app/campaigns/[campaignId]/HandCardFace";

// What a target chip shows beside the name: a health word for an enemy, hit
// points for one of the party (players already see each other's).
export type HandTargetChip = HandAim & { note: string };

// One class option on the raised card. A refused one stays in view, dimmed,
// with the engine's sentence as its tooltip; pressing it shakes the chip and
// says the sentence on the Hand's notice line.
function HandOptionChip({
  option,
  index,
  on,
  onToggle,
  onRefused,
}: {
  option: HandAttackOption;
  index: number;
  on: boolean;
  onToggle?: (id: HandAttackOptionId) => void;
  onRefused?: (reason: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <Tooltip content={option.disabled ?? option.note}>
      <button
        ref={ref}
        type="button"
        style={{ "--i": index } as CSSProperties}
        aria-pressed={on}
        aria-disabled={option.disabled ? "true" : undefined}
        data-on={on && option.group ? "" : undefined}
        onClick={() => {
          if (option.disabled) {
            replayAnimation(ref.current, "shake-x var(--dur-beat) var(--ease-snap) both");
            onRefused?.(option.disabled);
            return;
          }
          onToggle?.(option.id);
        }}
        className={cn(
          "hand-option inline-flex min-h-9 items-center rounded-full border px-3 text-xs sm:min-h-8",
          option.disabled
            ? "border-stone-800 text-stone-600"
            : on
              ? "border-ember-400/70 bg-ember-500/20 text-orange-100"
              : "border-stone-600 text-stone-300 hover:border-amber-500/60",
        )}
      >
        {option.label}
      </button>
    </Tooltip>
  );
}

// The raised card's bar: who it lands on, what it will do, the exact sentence
// that will be sent, and the gold button named after the card. This is the
// phone's two-tap confirm and the desktop's aim step in one, because a sent
// action costs the table a DM turn and cannot be taken back.
export function HandAimBar({
  card,
  targets,
  aim,
  onAim,
  riders,
  onDropRider,
  rows,
  sentence,
  sending,
  options = [],
  chosen = [],
  onToggleOption,
  trigger = null,
  onTrigger,
  choice = null,
  onChoice,
  areaPick = {},
  onClearArea,
  onRefused,
  blocked,
  onBack,
  onEdit,
  onCommit,
}: {
  card: HandCard;
  targets: HandTargetChip[];
  aim: HandAim | null;
  onAim: (target: HandTargetChip) => void;
  riders: HandCard[];
  onDropRider: (rider: HandCard) => void;
  rows: PreviewRow[];
  sentence: string;
  sending: boolean;
  // The class options this swing may carry, each judged by the engine.
  options?: HandAttackOption[];
  chosen?: HandAttackOptionId[];
  onToggleOption?: (id: HandAttackOptionId) => void;
  // Ready's trigger, when the card asks for one; null when it does not.
  trigger?: string | null;
  onTrigger?: (text: string) => void;
  // The card's one pick (a spell's form, a readied spell); null for the default.
  choice?: string | null;
  onChoice?: (value: string) => void;
  // Where an area spell is laid, picked on the board; the Clear takes it back.
  areaPick?: AreaPick;
  onClearArea?: () => void;
  // A refused option was pressed: the Hand says the engine's sentence.
  onRefused?: (reason: string) => void;
  // Why the send is held (muted, the floor is locked); null when it is open.
  blocked: string | null;
  onBack: () => void;
  onEdit: () => void;
  onCommit: () => void;
}) {
  const toggles = options.filter((option) => !option.group);
  const grouped = options.filter((option) => option.group);
  const needsTarget = card.target === "enemy" || card.target === "ally";
  const needsTrigger = trigger !== null && !trigger.trim();
  // An area spell laid on a square picked on the board needs no creature
  // named: the area catches whoever stands in it.
  const areaPicked = hasPick(card.area, areaPick);
  const ready = (!needsTarget || aim !== null || areaPicked) && !needsTrigger;
  const hint = needsTrigger
    ? "Say what you wait for."
    : areaPicked && !aim
      ? `Laid ${describePick(card.area!, areaPick)}.`
    : !needsTarget
    ? card.compose
      ? "Finish the line in the box below."
      : "Ready when you are."
    : aim
      ? `Lined up on ${aim.kind === "self" ? "yourself" : aim.name}.`
      : card.area && card.area.pick !== "none"
        ? "Pick a target here, or tap the board where it goes."
      : card.target === "enemy"
        ? "Pick a target, here or on the board."
        : "Pick who it is for.";
  return (
    <div className="hand-aim mt-1 rounded-xl border border-amber-500/30 bg-stone-950/80 p-2.5 shadow-elev-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="hand-type-chip" style={{ "--chip-tone": typeTone(card.type) } as CSSProperties}>
          {typeLabel(card.type)}
        </span>
        <span className="min-w-0 truncate font-display text-sm font-semibold text-amber-100">{card.name}</span>
        <span className="ml-auto min-w-0 truncate text-xs text-stone-400">{hint}</span>
      </div>

      {needsTarget ? (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Targets">
          {targets.length ? (
            targets.map((target, index) => (
              <button
                key={target.id}
                type="button"
                style={{ "--i": index } as CSSProperties}
                aria-pressed={aim?.id === target.id}
                onClick={() => onAim(target)}
                className={cn(
                  ui.btnSmall,
                  "hand-target min-h-11 flex-col items-start gap-0 px-3 py-1 text-left sm:min-h-9",
                )}
              >
                <span className="text-[13px] leading-tight text-stone-200">
                  {target.kind === "self" ? `${target.name} (you)` : target.name}
                </span>
                {target.note ? (
                  <span className="font-mono text-[10px] leading-tight text-stone-500">{target.note}</span>
                ) : null}
              </button>
            ))
          ) : (
            <span className="text-xs text-stone-500">Nobody to aim at. Type your move instead.</span>
          )}
        </div>
      ) : null}

      {/* An area spell: where it is laid, picked on the board, which draws
          the squares as the pointer moves (BoardAreaAim.tsx). */}
      {card.area ? (
        <div className="hand-choice mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Where the area is laid">
          <span className="text-[11px] uppercase tracking-wider text-stone-500">Area</span>
          {areaPicked ? (
            <span
              key={describePick(card.area, areaPick)}
              className="motion-pop inline-flex min-h-8 items-center rounded-full border border-amber-400/70 bg-amber-500/15 px-3 text-xs text-amber-100"
            >
              {describePick(card.area, areaPick)}
            </span>
          ) : null}
          <span className="text-xs text-stone-400">{pickHint(card.area, areaPick)}</span>
          {areaPicked && onClearArea ? (
            <button
              type="button"
              onClick={onClearArea}
              aria-label="Clear the square picked for the area"
              className="hand-option motion-press inline-flex min-h-8 items-center gap-1 rounded-full border border-stone-600 px-2.5 text-xs text-stone-300 hover:border-amber-500/60"
            >
              <X className="size-3" /> Clear
            </button>
          ) : null}
        </div>
      ) : null}

      {toggles.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Attack options">
          <span className="text-[11px] uppercase tracking-wider text-stone-500">With it</span>
          {toggles.map((option, index) => (
            <HandOptionChip
              key={option.id}
              option={option}
              index={index}
              on={chosen.includes(option.id)}
              onToggle={onToggleOption}
              onRefused={onRefused}
            />
          ))}
        </div>
      ) : null}

      {/* A choice of one (Open Hand Technique's rider): a pill slides to the
          pick (src/lib/motion/pill.ts), and a second press takes it back. */}
      {grouped.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-stone-500">Open Hand</span>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Open Hand Technique" data-pill-group>
            {grouped.map((option, index) => (
              <HandOptionChip
                key={option.id}
                option={option}
                index={index}
                on={chosen.includes(option.id)}
                onToggle={onToggleOption}
                onRefused={onRefused}
              />
            ))}
          </div>
        </div>
      ) : null}

      {card.choice ? (
        <div className="hand-choice mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-stone-500">{card.choice.label}</span>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={card.choice.label} data-pill-group>
            {card.choice.options.map((option, index) => {
              const on = option.value === (choice ?? card.choice?.fallback ?? card.choice?.options[0]?.value);
              return (
                <Tooltip key={option.value || "none"} content={option.note || option.label}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-on={on ? "" : undefined}
                    style={{ "--i": index } as CSSProperties}
                    onClick={() => onChoice?.(option.value)}
                    className={cn(
                      "hand-option motion-press inline-flex min-h-9 items-center rounded-full border px-3 text-xs sm:min-h-8",
                      on ? "border-amber-400/70 bg-amber-500/20 text-amber-100" : "border-stone-600 text-stone-300 hover:border-amber-500/60",
                    )}
                  >
                    {option.label}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      ) : null}

      {trigger !== null ? (
        <label className="hand-trigger mt-2 flex flex-col gap-1 text-[11px] uppercase tracking-wider text-stone-500">
          Trigger
          <input
            type="text"
            value={trigger}
            maxLength={200}
            autoFocus
            onChange={(event) => onTrigger?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && ready && !sending && blocked === null) {
                event.preventDefault();
                onCommit();
              }
            }}
            placeholder="the ogre steps through the door"
            className={cn(ui.input, "normal-case tracking-normal")}
          />
        </label>
      ) : null}

      {riders.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-stone-500">Riding it</span>
          {riders.map((rider) => (
            <button
              key={rider.id}
              type="button"
              onClick={() => onDropRider(rider)}
              aria-label={`Take ${rider.name} off this attack`}
              className="hand-rider inline-flex min-h-8 items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 text-xs text-amber-100"
            >
              {rider.name} {rider.dice}
              <X className="size-3" />
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div className="hand-rows-box">
          <HandPreviewRows rows={rows} />
        </div>
        <div className="flex min-w-0 flex-col justify-between gap-2">
          <p className="font-serif text-sm italic leading-snug text-stone-300">
            <span className="not-italic text-stone-500">Sends: </span>
            {sentence}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={onBack} className={cn(ui.btnSmall, "min-h-10")}>
              <ArrowLeft className="size-4" /> Back
            </button>
            <Tooltip content="Put this sentence in the message box so you can change it before sending.">
              <button type="button" onClick={onEdit} className={cn(ui.btnSmall, "min-h-10")}>
                <PencilLine className="size-4" /> Edit
              </button>
            </Tooltip>
            <Tooltip
              content={
                blocked ??
                (ready
                  ? "Send this to the Dungeon Master."
                  : needsTrigger
                    ? "Name the trigger first."
                    : card.area
                      ? "Pick a target, or a square on the board."
                      : "Pick a target first.")
              }
            >
              <button
                type="button"
                onClick={onCommit}
                disabled={!ready || sending || blocked !== null}
                className={cn(ui.btnPrimary, "max-w-full")}
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : null}
                <span className="truncate">{card.compose ? "Write it" : card.name}</span>
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
