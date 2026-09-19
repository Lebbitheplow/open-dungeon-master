"use client";

import { Search, Star } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import type { IconRef } from "@/lib/icons";
import { ui } from "@/lib/ui";
import { filterGroups, foldGroups } from "./lineage";

// One painted card in a lineage or class grid. `meta` is the canonical name
// behind a world pack's reskin, searched along with the name.
export type OptionCardView = {
  id: string;
  name: string;
  meta?: string;
  art: string;
  tagline: string;
  chips: string[];
  icon?: IconRef;
};

export type OptionCardGroup = {
  label: string | null;
  // The tier the campaign's setting or world pack recommends: its heading is
  // starred and every card in it wears the badge.
  recommended?: boolean;
  options: OptionCardView[];
};

// Past this many cards the grid grows a search box: a pack can bring eighty
// peoples, and scrolling for "tiefling" is no way to start a character.
const SEARCH_FROM = 13;
// A grid longer than FOLD_FROM starts folded to FOLD_TO cards (plus the whole
// recommended tier and the chosen card), so what sits under it stays in reach.
const FOLD_FROM = 17;
const FOLD_TO = 12;
// The entrance staggers the first rows only; card sixty should not arrive
// two seconds late.
const STAGGER_CAP = 12;

// The card grid that replaces a dropdown: every option the picker offered, in
// the picker's groups and order, as painted cards. Tapping a card chooses it;
// the "?" on a card opens its details without choosing.
export function OptionCardGrid({
  groups,
  value,
  onChoose,
  onDetails,
  noun,
  compact = false,
}: {
  groups: OptionCardGroup[];
  value: string;
  onChoose: (id: string) => void;
  onDetails: (id: string) => void;
  // "lineage" or "class", for the search box and the empty line.
  noun: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const total = groups.reduce((sum, group) => sum + group.options.length, 0);
  const [expanded, setExpanded] = useState(false);
  const searching = query.trim().length > 0;
  const folds = total >= FOLD_FROM;
  const { shown, hidden } = useMemo(() => {
    const matched = filterGroups(groups, query);
    if (!folds || expanded || searching) {
      return { shown: matched, hidden: 0 };
    }
    const folded = foldGroups(matched, { limit: FOLD_TO, keepId: value });
    return { shown: folded.groups, hidden: folded.hidden };
  }, [groups, query, folds, expanded, searching, value]);
  // Where each group's first card sits in the whole run, for the stagger.
  const starts = useMemo(() => {
    const out: number[] = [];
    let count = 0;
    for (const group of shown) {
      out.push(count);
      count += group.options.length;
    }
    return out;
  }, [shown]);

  return (
    <div>
      {total >= SEARCH_FROM ? (
        <label className="relative mb-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-stone-500" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${total} ${noun === "class" ? "classes" : `${noun}s`}`}
            aria-label={`Search ${noun === "class" ? "classes" : `${noun}s`}`}
            className={cn(ui.input, "pl-8")}
          />
        </label>
      ) : null}

      {shown.length ? null : (
        <p className="py-6 text-center text-xs text-stone-500">
          No {noun} matches that. Clear the search to see all {total}.
        </p>
      )}

      {/* Room on the left and top for the Selected pill, which overhangs its
          card and would otherwise be clipped by the step's scroll pane. */}
      <div className="space-y-4 px-2 pt-2.5 pb-1">
        {shown.map((group, groupIndex) => (
          <section key={group.label ?? `group-${groupIndex}`}>
            {group.label ? (
              <Ribbon className="mb-2.5">
                <span className="inline-flex items-center gap-1">
                  {group.recommended ? <Star className="size-2.5 fill-current" aria-hidden="true" /> : null}
                  {group.label}
                </span>
              </Ribbon>
            ) : null}
            <div className="creator-grid" data-compact={compact || undefined}>
              {group.options.map((option, optionIndex) => {
                const chosen = option.id === value;
                const style = {
                  "--i": Math.min(starts[groupIndex] + optionIndex, STAGGER_CAP),
                } as CSSProperties;
                return (
                  <div
                    key={option.id}
                    className="creator-card-wrap creator-rise"
                    data-chosen={chosen || undefined}
                    style={style}
                  >
                    <button
                      type="button"
                      onClick={() => onChoose(option.id)}
                      aria-pressed={chosen}
                      aria-label={`${option.name}${group.recommended ? ", recommended for this setting" : ""}`}
                      className="creator-card motion-card"
                    >
                      <span className="creator-plate" data-short={compact || undefined}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={option.art} alt="" loading="lazy" decoding="async" draggable={false} />
                        <span className="creator-plate-text" data-icon={option.icon ? "" : undefined}>
                          <span className="creator-plate-name">{option.name}</span>
                          {option.tagline ? <span className="creator-plate-tag">{option.tagline}</span> : null}
                        </span>
                        {option.icon ? <GameIcon icon={option.icon} size="size-7" className="creator-emblem" /> : null}
                      </span>
                      <span className="creator-card-foot">
                        <span className="flex min-w-0 gap-1 overflow-hidden">
                          {option.chips.map((chip) => (
                            <span key={chip} className="creator-chip">
                              {chip}
                            </span>
                          ))}
                        </span>
                        <span className="creator-cta">{chosen ? "Chosen" : "Tap to choose"}</span>
                      </span>
                    </button>
                    {group.recommended ? (
                      <span className="creator-recommended">
                        <Star className="size-2.5 fill-current" aria-hidden="true" />
                        Recommended
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onDetails(option.id)}
                      aria-label={`Details for ${option.name}`}
                      className="creator-help"
                    >
                      <span>?</span>
                    </button>
                    {chosen ? <span className="creator-selected">✓ Selected</span> : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {folds && !searching ? (
        <div className="mt-2 flex justify-center">
          <button type="button" onClick={() => setExpanded((current) => !current)} className={ui.btnSmall} aria-expanded={expanded}>
            {expanded ? "Show fewer" : `Show all ${total} (${hidden} more)`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
