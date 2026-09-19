"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import { memo, useMemo } from "react";
import type { CSSProperties } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import type { HandCard, HandCardType, HandCost } from "@/lib/battlemap/hand";
import { previewRows, type HandAim, type PreviewRow } from "@/lib/battlemap/hand-play";

// One card of the Hand and the outcome preview that floats over it. Styles
// are in src/app/styles/hand.css; the tilt, the sheen and the art parallax
// come from the shared pointer module through the motion-card class, so
// nothing here listens to the pointer.

const TYPE_LABEL: Record<HandCardType, string> = {
  attack: "Attack",
  rider: "Rider",
  spell: "Spell",
  control: "Control",
  mend: "Mend",
  ward: "Ward",
  feature: "Feature",
  basic: "Basic",
};

const TYPE_TONE: Record<HandCardType, string> = {
  attack: "#ff9d5c",
  rider: "#f4d47a",
  spell: "#b8a6f5",
  control: "#b8a6f5",
  mend: "#7ed6a4",
  ward: "#9fe3f5",
  feature: "#f4d47a",
  basic: "#d6cfc2",
};

const COST_SHORT: Record<HandCost, string> = {
  action: "Action",
  bonus: "Bonus",
  reaction: "Reaction",
  rider: "Rider",
  free: "Free",
};

export function typeLabel(type: HandCardType): string {
  return TYPE_LABEL[type];
}

export function typeTone(type: HandCardType): string {
  return TYPE_TONE[type];
}

export function HandPreviewRows({ rows }: { rows: PreviewRow[] }) {
  return (
    <span className="hand-rows">
      {rows.map((row, index) => (
        <span key={row.key} className="hand-row" style={{ "--i": index } as CSSProperties}>
          <span className="hand-row-key">{row.key}</span>
          {/* Keyed by what it says, so a number that changes with the target
              arrives as a new one (hand-motion.css) instead of cutting. */}
          <span key={row.value} className="hand-row-value" data-tone={row.tone}>
            {row.value}
          </span>
        </span>
      ))}
    </span>
  );
}

// The committed card, face up over the hand while the table takes it in: the
// mockup's card-play and card-spend, both in hand-motion.css. Decoration only,
// the fan's own card is the one a screen reader hears about.
export function HandPlayedCard({ card }: { card: HandCard }) {
  return (
    <div className="hand-played" aria-hidden="true">
      <span className="hand-played-top">
        <span className="hand-cost" data-cost={card.cost}>
          {COST_SHORT[card.cost]}
        </span>
        <span className="hand-range">{card.range}</span>
      </span>
      <span className="hand-played-name">{card.name}</span>
      {card.dice ? (
        <span className="hand-dice" data-heals={card.heals ? "true" : undefined}>
          {card.dice}
        </span>
      ) : null}
    </div>
  );
}

function HandCardFaceInner({
  card,
  index,
  offset,
  step,
  picked,
  attached,
  played,
  aim,
  conditions,
  onPick,
}: {
  card: HandCard;
  index: number;
  // Seats from the middle of the fan, and the degrees between neighbours.
  offset: number;
  step: number;
  picked: boolean;
  // A rider that will ride the next attack.
  attached: boolean;
  played: boolean;
  // Who the preview's odds are worked against, and the conditions on the
  // character holding the hand.
  aim: HandAim | null;
  conditions: string[];
  onPick: (card: HandCard) => void;
}) {
  const rows = useMemo(() => previewRows(card, aim, conditions), [card, aim, conditions]);
  const aimName = aim && card.target === "enemy" && aim.kind === "enemy" ? aim.name : "";
  const slotStyle = {
    "--i": index,
    "--rot": `${(offset * step).toFixed(2)}deg`,
    "--ty": `${(offset * offset * 3.6 * Math.min(1, step / 4.4)).toFixed(1)}px`,
  } as CSSProperties;
  const button = (
    <button
      type="button"
      className="hand-card motion-card"
      data-type={card.type}
      data-tilt="16"
      data-picked={picked ? "true" : undefined}
      data-spent={card.spent ? "true" : undefined}
      data-played={played ? "true" : undefined}
      // aria-disabled, not disabled: a spent card still takes a press and a
      // hover, which is how it says why it cannot be played.
      aria-disabled={card.disabled ? "true" : undefined}
      aria-pressed={card.type === "rider" ? attached : undefined}
      aria-label={`${card.name}, ${COST_SHORT[card.cost]}${card.disabled ? `. ${card.disabled}` : ""}`}
      onClick={() => onPick(card)}
    >
      <span className="hand-card-frame" />
      <span className="hand-card-foil" />
      <span className="hand-card-sheen" />
      <span className="hand-card-ribbon">{TYPE_LABEL[card.type]}</span>
      <span className="hand-card-corner" data-at="tl" />
      <span className="hand-card-corner" data-at="br" />
      <span className="hand-card-body">
        <span className="hand-card-top">
          <span className="hand-cost" data-cost={card.cost}>
            {COST_SHORT[card.cost]}
          </span>
          <span className="hand-range">{card.range}</span>
        </span>
        <span className="hand-art">
          <GameIcon icon={card.icon} size="size-[52px] max-sm:size-9" className="hand-art-icon" />
        </span>
        <span className="hand-name">{card.name}</span>
        <span className="hand-numbers">
          {card.dice ? (
            <span className="hand-dice" data-heals={card.heals ? "true" : undefined}>
              {card.dice}
            </span>
          ) : null}
          <span className="hand-roll">{card.roll}</span>
        </span>
        <span className="hand-rules">{card.rules}</span>
        <span className="hand-foot">
          <span className="hand-resource">{card.resource}</span>
          <span className="hand-cond">{card.condition}</span>
        </span>
      </span>
    </button>
  );
  return (
    <div className="hand-slot" style={slotStyle}>
      {/* The shared Tooltip's markup, with nothing to show while the card is
          playable. Wrapping only a disabled card would swap the button for a
          new node the moment it is spent, and a new node cannot ease into
          its dim. Leaving the card is what closes it: with no content mounted
          there is nothing else to notice the pointer has gone. */}
      <RadixTooltip.Provider delayDuration={300}>
        <RadixTooltip.Root disableHoverableContent>
          <RadixTooltip.Trigger asChild>{button}</RadixTooltip.Trigger>
          {card.disabled ? (
            <RadixTooltip.Portal>
              <RadixTooltip.Content
                side="top"
                sideOffset={6}
                collisionPadding={8}
                className="z-[70] max-w-60 rounded-md border border-stone-600/60 bg-stone-950 px-2.5 py-1.5 text-xs leading-snug text-stone-300 shadow-elev-2"
              >
                {card.disabled}
              </RadixTooltip.Content>
            </RadixTooltip.Portal>
          ) : null}
        </RadixTooltip.Root>
      </RadixTooltip.Provider>
      {card.disabled ? null : (
        <span className="hand-preview" aria-hidden="true">
          <span className="hand-preview-head">
            <span className="hand-type-chip" style={{ "--chip-tone": TYPE_TONE[card.type] } as CSSProperties}>
              {TYPE_LABEL[card.type]}
            </span>
            <span className="hand-preview-name">{aimName ? `${card.name} · ${aimName}` : card.name}</span>
          </span>
          <HandPreviewRows rows={rows} />
        </span>
      )}
    </div>
  );
}

export const HandCardFace = memo(HandCardFaceInner);
