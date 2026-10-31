"use client";

import { ArrowLeft, Search, X } from "lucide-react";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cardArtwork } from "@/lib/battlemap/card-art";
import type { HandCard } from "@/lib/battlemap/hand";
import {
  GROUP_SEARCH_OVER,
  NO_FILTER,
  filterCards,
  filterChips,
  filtering,
  groupSummary,
  sectionLine,
  type FilterChip,
  type HandFilter,
  type HandGroup,
} from "@/lib/battlemap/hand-groups";
import type { HandAim } from "@/lib/battlemap/hand-play";
import { HandCardFace } from "@/app/campaigns/[campaignId]/HandCardFace";

// The Hand's groups (issue 528, src/lib/battlemap/hand-groups.ts): the card
// that stands for every spell, every ki technique, the items or the basic
// actions, and the group opened as a hand of its own, with a Back spine to
// the main hand. Styles in src/app/styles/hand-groups.css.

const costWord: Record<string, string> = { action: "action", bonus: "bonus action", reaction: "reaction" };

// The fan's lean for this many cards, as the main hand works it out.
export function fanStep(count: number): number {
  return count > 1 ? Math.min(4.4, 13 / (count - 1)) : 0;
}

function slotStyle(index: number, offset: number, step: number): CSSProperties {
  return {
    "--i": index,
    "--rot": `${(offset * step).toFixed(2)}deg`,
    "--ty": `${(offset * offset * 3.6 * Math.min(1, step / 4.4)).toFixed(1)}px`,
  } as CSSProperties;
}

function HandGroupFaceInner({
  genre,
  group,
  index,
  offset,
  step,
  waiting,
  fresh,
  onOpen,
}: {
  group: HandGroup;
  index: number;
  offset: number;
  step: number;
  // Only the turn holds its cards: it reads at full strength, like a card.
  waiting: boolean;
  // It holds a card gained since the hand was arranged.
  fresh: boolean;
  onOpen: (group: HandGroup) => void;
  genre?: string | null;
}) {
  const quiet = Boolean(group.disabled) && !waiting;
  const names = group.cards.map((card) => card.name);
  const open = group.costs.filter((entry) => entry.open).map((entry) => costWord[entry.cost]);
  const label = `${group.name}: ${groupSummary(group)}.${open.length ? ` Has ${open.join(", ")} cards ready.` : ""} Open`;
  return (
    <div className="hand-slot" style={slotStyle(index, offset, step)}>
      <button
        type="button"
        className="hand-card hand-group-card motion-card"
        data-type={group.tone}
        data-group-id={group.id}
        data-tilt="16"
        data-quiet={quiet ? "true" : undefined}
        data-spent={quiet && group.spent ? "true" : undefined}
        aria-label={label}
        onClick={() => onOpen(group)}
      >
        {/* The cards under it, edges showing, so it reads as a stack. */}
        <span className="hand-group-under" aria-hidden="true" />
        <span className="hand-card-frame" />
        <span className="hand-card-foil" />
        <span className="hand-card-sheen" />
        <span className="hand-card-ribbon">
          {group.cards.length} {group.cards.length === 1 ? group.noun[0] : group.noun[1]}
        </span>
        <span className="hand-card-corner" data-at="tl" />
        <span className="hand-card-corner" data-at="br" />
        <span className="hand-card-body">
          <span className="hand-card-top">
            <span className="hand-costs" aria-hidden="true">
              {group.costs.map((entry) => (
                <span key={entry.cost} className="hand-cost-dot" data-cost={entry.cost} data-open={entry.open ? "true" : undefined} />
              ))}
            </span>
            {fresh ? <span className="hand-group-new">New</span> : <span className="hand-range">Open</span>}
          </span>
          <span className="hand-art hand-group-art" aria-hidden="true">
            {group.icons.map((icon, at) => {
              const artwork = cardArtwork(icon, genre);
              return (
                <span key={at} className="hand-group-art-leaf" data-at={at} data-of={group.icons.length}>
                  <GameIcon icon={artwork} size={artwork.kind === "action" ? "h-full w-full p-0.5" : "size-[40px] max-sm:size-7"} />
                </span>
              );
            })}
          </span>
          <span className="hand-name">{group.name}</span>
          <span className="hand-numbers">
            <span className="hand-roll">{sectionLine(group) || names.slice(0, 3).join(" · ")}</span>
          </span>
          <span className="hand-rules">{sectionLine(group) ? names.slice(0, 4).join(", ") : names.slice(3, 9).join(", ")}</span>
          <span className="hand-foot">
            <span className="hand-resource">{group.left}</span>
          </span>
        </span>
      </button>
      {/* What it holds, section by section, over the card on hover. */}
      <span className="hand-preview" aria-hidden="true">
        <span className="hand-preview-head">
          <span className="hand-preview-name">{group.name}</span>
        </span>
        <span className="hand-rows">
          {group.sections.map((section, at) => (
            <span key={section.id} className="hand-row" style={{ "--i": at } as CSSProperties}>
              <span className="hand-row-key">{group.sections.length > 1 ? section.label : `${section.cards.length} ${group.noun[1]}`}</span>
              <span className="hand-row-value" data-tone={section.note ? "cost" : "muted"}>
                {group.sections.length > 1 ? [section.cards.length, section.note].filter(Boolean).join(" · ") : section.note || "Open to choose"}
              </span>
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}

export const HandGroupFace = memo(HandGroupFaceInner);

// The chips and the search box that narrow a long list of cards: the
// costs a card is paid in, Concentration, and words. Shared by an open
// group and the More sheet.
export function HandFindTools({
  chips,
  filter,
  onFilter,
  search,
  label,
  className,
}: {
  chips: FilterChip[];
  filter: HandFilter;
  onFilter: (filter: HandFilter) => void;
  search: boolean;
  // What is being searched, for the box's name ("Spells").
  label: string;
  className?: string;
}) {
  if (!chips.length && !search) return null;
  const toggle = (chip: FilterChip) => {
    if (chip.id === "concentration") {
      onFilter({ ...filter, concentration: !filter.concentration });
      return;
    }
    const on = filter.costs.includes(chip.id);
    onFilter({ ...filter, costs: on ? filter.costs.filter((cost) => cost !== chip.id) : [...filter.costs, chip.id] });
  };
  return (
    <div className={`hand-find ${className ?? ""}`}>
      {chips.length ? (
        <span className="hand-find-chips" role="group" aria-label={`Filter ${label}`}>
          {chips.map((chip) => {
            const on = chip.id === "concentration" ? filter.concentration : filter.costs.includes(chip.id);
            return (
              <button
                key={chip.id}
                type="button"
                className="hand-chip"
                data-cost={chip.id}
                aria-pressed={on}
                aria-label={`${chip.label}: ${chip.count}`}
                onClick={() => toggle(chip)}
              >
                {chip.short}
                <span className="hand-chip-count" aria-hidden="true">{chip.count}</span>
              </button>
            );
          })}
        </span>
      ) : null}
      {search ? (
        <label className="hand-search">
          <Search aria-hidden="true" className="size-3.5 shrink-0" />
          <input
            type="search"
            value={filter.query}
            onChange={(event) => onFilter({ ...filter, query: event.target.value })}
            placeholder="Find by name or damage"
            aria-label={`Search ${label}`}
            maxLength={60}
            enterKeyHint="search"
            autoComplete="off"
          />
        </label>
      ) : null}
    </div>
  );
}

// The section a group opens on: the first holding a card that can be
// played now, so a spent level never greets the player.
function openingSection(group: HandGroup): string {
  return (group.sections.find((section) => section.cards.some((card) => !card.disabled)) ?? group.sections[0])?.id ?? "";
}

// An opened group: its own bar (the sections as tabs, the chips, the search
// box) above its own fan, with the Back spine where the More spine sits on
// the main hand's other side. The aim bar, the played card and the notice
// stay the Hand's own, under it.
export function HandGroupView({
  genre,
  group,
  pickedId,
  riderIds,
  playedId,
  aim,
  conditions,
  isWaiting,
  freshIds,
  aiming,
  folding,
  onPick,
  onBack,
}: {
  group: HandGroup;
  pickedId: string | null;
  riderIds: string[];
  playedId: string | null;
  aim: HandAim | null;
  conditions: string[];
  isWaiting: (card: HandCard) => boolean;
  freshIds: Set<string>;
  aiming: boolean;
  folding: boolean;
  onPick: (card: HandCard) => void;
  onBack: () => void;
  genre?: string | null;
}) {
  const [sectionId, setSectionId] = useState(() => openingSection(group));
  const [filter, setFilter] = useState<HandFilter>(NO_FILTER);
  const backRef = useRef<HTMLButtonElement>(null);
  const tabsId = useId();
  const chips = useMemo(() => filterChips(group.cards), [group.cards]);
  const searching = filtering(filter);
  const section = group.sections.find((entry) => entry.id === sectionId) ?? group.sections[0];
  const shown = searching ? filterCards(group.cards, filter) : section?.cards ?? [];
  const tabs = group.sections.length > 1;

  // Opening moves the keyboard into the group, at its way back.
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const edge = event.key === "Home" ? 0 : event.key === "End" ? group.sections.length - 1 : null;
    if (!step && edge === null) return;
    event.preventDefault();
    const next = edge ?? (at + step + group.sections.length) % group.sections.length;
    setSectionId(group.sections[next].id);
    document.getElementById(`${tabsId}-tab-${next}`)?.focus();
  };

  const middle = shown.length / 2;
  const step = fanStep(shown.length);
  const panelLabel = searching ? `${group.name} found` : tabs ? `${group.name}, ${section?.label}` : group.name;
  return (
    <div className="hand-group" data-group-key={group.key}>
      <div className="hand-group-bar">
        <span className="hand-group-title">
          <span className="font-display">{group.name}</span>
          {group.left ? <span className="hand-group-left">{group.left}</span> : null}
        </span>
        {searching ? (
          <p className="hand-group-found" role="status">
            {shown.length ? `${shown.length} of ${group.cards.length} ${group.noun[1]}` : `No ${group.noun[1]} match`}
            <button type="button" className="hand-group-clear" onClick={() => setFilter(NO_FILTER)}>
              <X aria-hidden="true" className="size-3" /> Clear
            </button>
          </p>
        ) : tabs ? (
          <div role="tablist" aria-label={`${group.name} by level`} className="hand-group-tabs">
            {group.sections.map((entry, at) => {
              const chosen = entry.id === section?.id;
              return (
                <button
                  key={entry.id}
                  id={`${tabsId}-tab-${at}`}
                  type="button"
                  role="tab"
                  aria-selected={chosen}
                  aria-controls={`${tabsId}-panel`}
                  tabIndex={chosen ? 0 : -1}
                  className="hand-group-tab"
                  data-spent={entry.cards.every((card) => card.disabled && !isWaiting(card)) ? "true" : undefined}
                  onClick={() => setSectionId(entry.id)}
                  onKeyDown={(event) => onTabKey(event, at)}
                >
                  <span className="hand-group-tab-label">{entry.label}</span>
                  <span className="hand-group-tab-note">{entry.note || `${entry.cards.length} ${entry.cards.length === 1 ? group.noun[0] : group.noun[1]}`}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <HandFindTools
          chips={chips}
          filter={filter}
          onFilter={setFilter}
          search={group.cards.length > GROUP_SEARCH_OVER}
          label={group.name}
        />
      </div>
      <div
        key={searching ? "found" : section?.id}
        id={`${tabsId}-panel`}
        className="hand-fan"
        data-group-open="true"
        data-aiming={aiming ? "true" : undefined}
        data-folding={folding ? "true" : undefined}
        role={tabs && !searching ? "tabpanel" : "group"}
        aria-label={panelLabel}
      >
        <button
          ref={backRef}
          type="button"
          className="hand-back"
          onClick={onBack}
          aria-label={`Back to your hand from ${group.name}`}
        >
          <ArrowLeft aria-hidden="true" className="hand-back-arrow" />
          <span className="hand-back-word">Your hand</span>
        </button>
        {shown.map((card, index) => (
          <HandCardFace
            genre={genre}
            key={card.id}
            card={card}
            index={index + 1}
            offset={index + 0.5 - middle}
            step={step}
            picked={pickedId === card.id}
            attached={riderIds.includes(card.id)}
            played={playedId === card.id}
            aim={card.intent.card === "reaction" ? null : aim}
            conditions={conditions}
            waiting={isWaiting(card)}
            fresh={freshIds.has(card.id)}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}
