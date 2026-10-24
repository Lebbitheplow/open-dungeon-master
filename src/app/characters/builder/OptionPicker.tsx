"use client";

import { Check, ChevronDown, Info, Star } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type Ref } from "react";
import { cn } from "@/lib/cn";
import { InfoDialog, type ContentRef } from "@/components/ui/InfoDialog";
import { textKey } from "@/lib/language/text-logic";
import { OWNS_ESCAPE } from "@/lib/owned-escape";

export type PickerOption = {
  // Value handed to onChange. The subclass picker stores names, not slugs,
  // so this is not always the reference slug.
  id: string;
  name: string;
  // Small right-aligned text on the row (hit die, granted skills).
  meta?: string;
  // The book the entry is from ("Tome of Heroes"), shown after the name when
  // the group heading does not already say it (issue #116).
  source?: string;
  infoText?: string | null;
  reference?: ContentRef;
};

// `recommended` marks the tier the campaign's setting or world pack puts
// first, so every surface that lists the group can badge its rows.
export type PickerGroup = { label: string | null; recommended?: boolean; options: PickerOption[] };

// The key that opens the details of the highlighted option. Not a letter, so
// it never collides with typeahead.
export const DETAILS_KEY = "?";

function hasDetails(option: PickerOption | undefined) {
  return Boolean(option && (option.infoText?.trim() || option.reference));
}

// Where a navigation key moves the highlight in a list of `count` options,
// or null for a key that is not one. The list does not wrap, as in the
// WAI-ARIA listbox pattern.
export function moveActive(key: string, active: number, count: number): number | null {
  if (!count) return null;
  switch (key) {
    case "ArrowDown":
      return Math.min(active + 1, count - 1);
    case "ArrowUp":
      return Math.max(active - 1, 0);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageDown":
      return Math.min(active + 10, count - 1);
    case "PageUp":
      return Math.max(active - 10, 0);
    default:
      return null;
  }
}

// The option typeahead lands on: the first name starting with what was typed,
// searching on from the highlight. A single repeated letter cycles through
// the names that start with it, so "ddd" walks the D's.
export function typeaheadMatch(names: string[], typed: string, active: number): number | null {
  const query = textKey(typed);
  const repeated = query.length > 1 && [...query].every((char) => char === query[0]);
  const needle = repeated ? query[0] : query;
  // A fresh letter, or a repeat, moves past the current row; a longer prefix
  // may still match it.
  const start = query.length === 1 || repeated ? active + 1 : active;
  for (let step = 0; step < names.length; step += 1) {
    const index = (Math.max(start, 0) + step) % names.length;
    if (textKey(names[index]).startsWith(needle)) return index;
  }
  return null;
}

// The open list. Split from the picker so its markup can be rendered and
// checked without a browser (scripts/test-option-picker.mjs).
//
// Each row is a single target, the option itself: the ⓘ on a row is drawn
// for the mouse but hidden from assistive tech and the tab order, and the
// keyboard reaches the same details with DETAILS_KEY on the highlighted row.
export function OptionList({
  id,
  groups,
  value,
  active,
  keyboard,
  labelledBy,
  onPick,
  onDetails,
  onKeyDown,
  listRef,
}: {
  id: string;
  groups: PickerGroup[];
  value: string;
  active: number;
  // Whether to draw the highlight: only while the keyboard drives the list,
  // so a mouse user sees the hover they always saw.
  keyboard: boolean;
  labelledBy?: string;
  onPick?: (option: PickerOption) => void;
  onDetails?: (option: PickerOption) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  listRef?: Ref<HTMLDivElement>;
}) {
  const options = groups.flatMap((group) => group.options);
  const anyDetails = options.some(hasDetails);
  const hintId = `${id}-hint`;
  // Each group's first index in the flat list the keys move through.
  const starts = groups.map((_, at) => groups.slice(0, at).reduce((sum, group) => sum + group.options.length, 0));
  return (
    <>
      <div
        ref={listRef}
        id={id}
        role="listbox"
        // In the tab order while open: it is the one stop in the list, and
        // a scrollable region a keyboard cannot reach fails axe.
        tabIndex={0}
        aria-labelledby={labelledBy}
        aria-activedescendant={options.length ? `${id}-${active}` : undefined}
        aria-describedby={anyDetails ? hintId : undefined}
        onKeyDown={onKeyDown}
        className="mt-1 max-h-64 w-full overflow-y-auto panel panel-smoke rounded-lg outline-none"
      >
        {groups.map((group, groupIndex) => {
          const headingId = `${id}-group-${groupIndex}`;
          return (
            <ul
              key={group.label ?? `group-${groupIndex}`}
              role={group.label ? "group" : "presentation"}
              aria-labelledby={group.label ? headingId : undefined}
            >
              {group.label ? (
                <li
                  id={headingId}
                  role="presentation"
                  className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-amber-200/70"
                >
                  {group.label}
                </li>
              ) : null}
              {group.options.map((option, at) => {
                const index = starts[groupIndex] + at;
                const isSelected = option.id === value;
                const isActive = keyboard && index === active;
                return (
                  // The listbox owns the keyboard (aria-activedescendant), so
                  // a row needs only the click.
                  <li
                    key={option.id || "__empty"}
                    id={`${id}-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    data-highlighted={isActive || undefined}
                    onClick={() => onPick?.(option)}
                    className={cn("flex items-center gap-1 pr-2 hover:bg-stone-800", isActive && "bg-stone-800")}
                  >
                    <span className="flex grow items-center justify-between gap-2 px-3 py-2 text-left">
                      <span
                        className={cn(
                          "flex items-center gap-1.5",
                          isSelected && "text-amber-200",
                        )}
                      >
                        {isSelected ? (
                          <Check className="size-3.5 shrink-0" />
                        ) : (
                          <span className="size-3.5 shrink-0" />
                        )}
                        {option.name}
                        {option.source ? (
                          <span className="truncate font-mono text-[0.6875rem] text-stone-500">{option.source}</span>
                        ) : null}
                        {/* A star, not a word: these rows sit in half-width
                            columns, and the group heading says the rest. */}
                        {group.recommended ? (
                          <span className="shrink-0 text-amber-300" title="Recommended for this setting">
                            <Star className="size-3 fill-current" aria-hidden="true" />
                            <span className="sr-only">Recommended for this setting</span>
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs text-stone-500">
                        {option.meta ?? ""}
                      </span>
                    </span>
                    {hasDetails(option) ? (
                      // Mouse only: DETAILS_KEY is the same action for the
                      // keyboard, and a second control inside an option is
                      // what made each row two targets.
                      <span
                        aria-hidden="true"
                        data-details
                        title={`What is ${option.name}?`}
                        onClick={(event: ReactMouseEvent) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onDetails?.(option);
                        }}
                        className="inline-flex shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors hover:text-amber-200"
                      >
                        <Info className="size-3.5" />
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          );
        })}
      </div>
      {anyDetails ? (
        // Read with the list, and shown while the keyboard drives it, so
        // the details key is no secret; a mouse user sees no new text.
        <p id={hintId} className={keyboard ? "mt-1 px-1 text-[11px] text-stone-500" : "sr-only"}>
          Press {DETAILS_KEY} for details on the highlighted option.
        </p>
      ) : null}
    </>
  );
}

// Dropdown replacement for the builder's race/class/subclass/background
// selects. A native <option> cannot hold a button, and these lists deserve
// the same per-row info affordance the spell picker has, so this renders
// the option list itself.
//
// It follows the WAI-ARIA collapsible listbox: the trigger opens the list
// and focus moves into it; arrows, Home, End, Page Up/Down and typeahead
// move the highlight (aria-activedescendant); Enter or Space chooses;
// Escape closes; either way focus returns to the trigger.
//
// The trigger is named by the field caption and then the value, so a screen
// reader hears "Background, Acolyte" rather than "Acolyte". The caption is
// `labelledBy`, or the caption of the enclosing builder Field when that
// Field is a labelled group.
//
// The list is in the flow rather than absolutely positioned: the builder is a
// wizard now, and every step scrolls on its own, which clips an absolute
// child that opens near the bottom of the pane. In flow it always has room,
// and the step scrolls to it.
export default function OptionPicker({
  value,
  groups,
  onChange,
  placeholder = "Choose...",
  className,
  labelledBy,
}: {
  value: string;
  groups: PickerGroup[];
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  // The id of the field caption that names this picker.
  labelledBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [keyboard, setKeyboard] = useState(false);
  const [details, setDetails] = useState<PickerOption | null>(null);
  const [fieldCaption, setFieldCaption] = useState<string | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const baseId = useId();
  const listId = `${baseId}-list`;
  const valueId = `${baseId}-value`;

  const options = groups.flatMap((group) => group.options);
  const selectedIndex = options.findIndex((option) => option.id === value);
  const selected = options[selectedIndex];
  const caption = labelledBy ?? fieldCaption;

  useEffect(() => {
    if (labelledBy) return;
    const group = container.current?.parentElement?.closest('[role="group"][aria-labelledby]');
    setFieldCaption(group?.getAttribute("aria-labelledby") ?? undefined);
  }, [labelledBy]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      // A click in the details dialog is not a click away from the list.
      if (details) return;
      if (container.current && !container.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [details]);

  useEffect(() => {
    if (open) {
      list.current?.focus({ preventScroll: true });
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [open, active, listId]);

  function openList(from: "keyboard" | "mouse", at = selectedIndex >= 0 ? selectedIndex : 0) {
    setKeyboard(from === "keyboard");
    setActive(Math.max(0, Math.min(at, options.length - 1)));
    typed.current = { text: "", at: 0 };
    setOpen(true);
  }

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function pick(option: PickerOption) {
    onChange(option.id);
    close();
  }

  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    const key = event.key;
    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    setKeyboard(true);
    const moved = moveActive(key, active, options.length);
    if (moved !== null) {
      event.preventDefault();
      setActive(moved);
      return;
    }
    const now = Date.now();
    const typing = now - typed.current.at < 500 && typed.current.text !== "";
    if (key === "Enter" || (key === " " && !typing)) {
      event.preventDefault();
      if (options[active]) pick(options[active]);
      return;
    }
    if (key === DETAILS_KEY && hasDetails(options[active])) {
      event.preventDefault();
      setDetails(options[active]);
      return;
    }
    if (key.length === 1) {
      event.preventDefault();
      const text = (typing ? typed.current.text : "") + key;
      typed.current = { text, at: now };
      const match = typeaheadMatch(
        options.map((option) => option.name),
        text,
        active,
      );
      if (match !== null) setActive(match);
    }
  }

  return (
    // While the list is open it answers Escape itself, so a dialog around
    // the builder (the companion builder's) stays open (src/lib/owned-escape.ts).
    <div ref={container} {...(open ? { [OWNS_ESCAPE]: "" } : {})}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={caption ? `${caption} ${valueId}` : undefined}
        onClick={(event) => {
          if (open) {
            setOpen(false);
          } else {
            // detail is 0 when Enter or Space pressed the button.
            openList(event.detail === 0 ? "keyboard" : "mouse");
          }
        }}
        onKeyDown={(event) => {
          if (open) {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openList(
              "keyboard",
              selectedIndex >= 0 ? selectedIndex : event.key === "ArrowUp" ? options.length - 1 : 0,
            );
          }
        }}
        className={cn(className, "flex items-center justify-between gap-2 text-left")}
      >
        <span id={valueId} className={cn("truncate", !selected?.name && "text-stone-500")}>
          {selected?.name || placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 text-stone-500" />
      </button>
      {open ? (
        <OptionList
          id={listId}
          groups={groups}
          value={value}
          active={active}
          keyboard={keyboard}
          labelledBy={caption ?? valueId}
          listRef={list}
          onPick={pick}
          onDetails={setDetails}
          onKeyDown={onListKey}
        />
      ) : null}
      {details ? (
        <InfoDialog
          open
          onOpenChange={(next) => {
            if (!next) setDetails(null);
          }}
          title={details.name}
          text={details.infoText}
          reference={details.reference}
        />
      ) : null}
    </div>
  );
}
