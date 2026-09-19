"use client";

import { ArrowLeft, Loader2, PencilLine, X } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import type { HandCard } from "@/lib/battlemap/hand";
import type { HandAim, PreviewRow } from "@/lib/battlemap/hand-play";
import { HandPreviewRows, typeLabel, typeTone } from "@/app/campaigns/[campaignId]/HandCardFace";

// What a target chip shows beside the name: a health word for an enemy, hit
// points for one of the party (players already see each other's).
export type HandTargetChip = HandAim & { note: string };

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
  // Why the send is held (muted, the floor is locked); null when it is open.
  blocked: string | null;
  onBack: () => void;
  onEdit: () => void;
  onCommit: () => void;
}) {
  const needsTarget = card.target === "enemy" || card.target === "ally";
  const ready = !needsTarget || aim !== null;
  const hint = !needsTarget
    ? card.compose
      ? "Finish the line in the box below."
      : "Ready when you are."
    : aim
      ? `Lined up on ${aim.kind === "self" ? "yourself" : aim.name}.`
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
            <Tooltip content={blocked ?? (ready ? "Send this to the Dungeon Master." : "Pick a target first.")}>
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
