"use client";

import { Search, Star } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { Select } from "@/components/ui/Select";
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

// Every grid has a search box: a pack can bring eighty peoples, scrolling for
// "tiefling" is no way to start a character, and a keyboard player types
// "tank" and presses Enter on twelve cards as gladly as on eighty.
// A grid longer than FOLD_FROM starts folded to FOLD_TO cards (plus the whole
// recommended tier and the chosen card), so what sits under it stays in reach.
const FOLD_FROM = 17;
const FOLD_TO = 12;
// The entrance staggers the first rows only; card sixty should not arrive
// two seconds late.
const STAGGER_CAP = 12;

// The keyboard-and-mouse case: a fine pointer that hovers. A phone, a tablet
// and a touch laptop's touch screen all fail it.
function prefersSearchFocus(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(hover: hover) and (pointer: fine)").matches);
}

// One filter over the grid ("Raises", "Role"): its choices, and whether a
// card passes for the one picked. The step that shows the grid supplies
// them; the grid holds what is picked.
export type CardFacet = {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  test: (id: string, value: string) => boolean;
};
const ANY = "any";

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
  facets = [],
}: {
  groups: OptionCardGroup[];
  value: string;
  onChoose: (id: string) => void;
  onDetails: (id: string) => void;
  // "lineage" or "class", for the search box and the empty line.
  noun: string;
  compact?: boolean;
  // The filters offered above the grid; none, no bar.
  facets?: CardFacet[];
}) {
  const gridId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const total = groups.reduce((sum, group) => sum + group.options.length, 0);
  const [expanded, setExpanded] = useState(false);
  // What each filter is set to; a filter not set passes every card.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const active = facets.filter((facet) => picks[facet.key] && picks[facet.key] !== ANY);
  const filtering = active.length > 0;
  const searching = query.trim().length > 0 || filtering;
  const folds = total >= FOLD_FROM;
  // The filters narrow the groups before the search does. The chosen card
  // always stays, so a filter never looks like it undid a pick.
  const narrowed = useMemo(() => {
    const set = facets.filter((facet) => picks[facet.key] && picks[facet.key] !== ANY);
    if (!set.length) {
      return groups;
    }
    return groups
      .map((group) => ({
        ...group,
        options: group.options.filter(
          (option) => option.id === value || set.every((facet) => facet.test(option.id, picks[facet.key])),
        ),
      }))
      .filter((group) => group.options.length);
  }, [groups, value, picks, facets]);
  const { shown, hidden } = useMemo(() => {
    const matched = filterGroups(narrowed, query);
    if (!folds || expanded || searching) {
      return { shown: matched, hidden: 0 };
    }
    const folded = foldGroups(matched, { limit: FOLD_TO, keepId: value });
    return { shown: folded.groups, hidden: folded.hidden };
  }, [narrowed, query, folds, expanded, searching, value]);
  const shownCount = shown.reduce((sum, group) => sum + group.options.length, 0);
  const lone = searching && shownCount === 1 ? shown[0].options[0] : null;

  // Entering the step puts the caret in the search box, for a keyboard or a
  // mouse; on a touch screen it would throw up the keyboard over the cards,
  // so focus stays on the step's title there. The wizard moves focus to that
  // title on every step change (Wizard.tsx); this follows it, and a "Show
  // me" that focuses a pick afterwards still wins.
  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      const input = searchRef.current;
      if (
        !(target instanceof HTMLElement) ||
        !input ||
        !target.classList.contains("wizard-step-heading") ||
        !target.closest("section")?.contains(input) ||
        !prefersSearchFocus()
      ) {
        return;
      }
      input.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);
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
      <label className="relative mb-3 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-stone-500" aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          // One card left: Enter chooses it, as a tap on it would.
          onKeyDown={(event) => {
            if (event.key === "Enter" && lone) {
              event.preventDefault();
              onChoose(lone.id);
            }
          }}
          placeholder={`Search ${total} ${noun === "class" ? "classes" : `${noun}s`}`}
          aria-label={`Search ${noun === "class" ? "classes" : `${noun}s`}`}
          aria-describedby={`${gridId}-search-hint`}
          enterKeyHint={lone ? "done" : "search"}
          className={cn(ui.input, "pl-8")}
        />
        <span id={`${gridId}-search-hint`} className="sr-only" aria-live="polite">
          {lone
            ? `One match, ${lone.name}. Press Enter to choose it.`
            : query.trim()
              ? `${shownCount} ${noun === "class" ? (shownCount === 1 ? "class" : "classes") : `${noun}${shownCount === 1 ? "" : "s"}`} match.`
              : "Searches names, roles and the other words on each card."}
        </span>
      </label>

      {facets.length ? (
        // A suggestion of the filters a player reaches for; each step
        // decides which it offers.
        <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label={`Filter ${noun === "class" ? "classes" : `${noun}s`}`}>
          {facets.map((facet) => (
            // Two to a line on a phone, side by side on a wider screen: the
            // select fills whatever box holds it.
            <div key={facet.key} className="w-[calc(50%-0.25rem)] min-w-0 sm:w-44">
            <Select
              size="sm"
              label={facet.label}
              value={picks[facet.key] ?? ANY}
              onChange={(next) => setPicks((current) => ({ ...current, [facet.key]: next }))}
              options={[{ value: ANY, label: `${facet.label}: any` }, ...facet.options.map((option) => ({ value: option.value, label: `${facet.label}: ${option.label}` }))]}
            />
            </div>
          ))}
          {filtering ? (
            <>
              <span className="text-xs text-stone-400" aria-live="polite">
                {shownCount} of {total}
              </span>
              <button type="button" onClick={() => setPicks({})} className={ui.btnSmall}>
                Clear filters
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {shown.length ? null : (
        <p className="py-6 text-center text-xs text-stone-500">
          No {noun} matches that. Clear the {filtering ? "filters" : "search"} to see all {total}.
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
                // What the card shows besides its name (source, saves, hit
                // die, ability bumps), read after the name: the label alone
                // made two same-name cards from different books sound alike.
                const descId = `${gridId}-${groupIndex}-${optionIndex}`;
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
                      aria-label={`${option.name}${group.recommended ? ", fits this setting" : ""}`}
                      aria-describedby={
                        [option.tagline ? `${descId}-tag` : "", option.chips.length ? `${descId}-chips` : ""]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                      className="creator-card motion-card"
                    >
                      <span className="creator-plate" data-short={compact || undefined}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={option.art} alt="" loading="lazy" decoding="async" draggable={false} />
                        <span className="creator-plate-text" data-icon={option.icon ? "" : undefined}>
                          <span className="creator-plate-name">{option.name}</span>
                          {option.tagline ? (
                            <span id={`${descId}-tag`} className="creator-plate-tag">
                              {option.tagline}
                            </span>
                          ) : null}
                        </span>
                        {option.icon ? <GameIcon icon={option.icon} size="size-7" className="creator-emblem" /> : null}
                      </span>
                      <span className="creator-card-foot">
                        <span id={`${descId}-chips`} className="flex min-w-0 gap-1 overflow-hidden">
                          {option.chips.map((chip) => (
                            <span key={chip} className="creator-chip">
                              {chip}
                            </span>
                          ))}
                        </span>
                        <span className="creator-cta">{chosen ? "Chosen" : "Choose"}</span>
                      </span>
                    </button>
                    {group.recommended ? (
                      // About the world, not about ease: "Easy to learn" is
                      // said on the card itself where it applies.
                      <span className="creator-recommended">
                        <Star className="size-2.5 fill-current" aria-hidden="true" />
                        Fits setting
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
