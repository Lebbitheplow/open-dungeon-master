"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { filterCommands } from "@/lib/palette/fuzzy";

// The command palette (docs/visual-overhaul-plan.md 8c.7): "/" when nothing
// is being typed into, Ctrl or Cmd with K anywhere, or the hint chip this
// component draws where it is mounted, which is also the phone's way in.
// The host passes the commands; the palette only finds and runs them, so it
// can never offer something the host's own buttons do not.
//
//   <CommandPalette
//     title="Workshop commands"
//     commands={[{ id: "go-cast", label: "Go to Cast", group: "Jump to a system",
//                  glyph: "system-cast", onSelect: () => openSystem("cast") }]}
//   />

export type PaletteCommand = {
  id: string;
  label: string;
  // One quiet line under the label.
  hint?: string;
  // Commands sharing a group sit under one heading while nothing is typed.
  group?: string;
  // A file name under public/assets/icons/glyph, without the extension.
  glyph: string;
  keywords?: readonly string[];
  onSelect: () => void;
};

function typingInto(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return element.isContentEditable || Boolean(element.closest("input, textarea, select, [contenteditable]"));
}

export function CommandPalette({
  commands,
  title = "Commands",
  placeholder = "Type a command",
  chipLabel = "Commands",
  className,
}: {
  commands: PaletteCommand[];
  title?: string;
  placeholder?: string;
  chipLabel?: string;
  // Extra classes for the hint chip.
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const shown = useMemo(() => filterCommands(query, commands), [query, commands]);
  // Clamped at read time: the list shrinks as the query grows.
  const activeIndex = shown.length ? Math.min(active, shown.length - 1) : -1;

  function show() {
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      const chord = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k";
      const slash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !typingInto(event.target);
      if (!chord && !slash) return;
      // Another dialog owns the keyboard while it is up.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      event.preventDefault();
      setQuery("");
      setActive(0);
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The highlighted row stays in view as the arrows walk past the fold.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function run(command: PaletteCommand) {
    setOpen(false);
    command.onSelect();
  }

  function onInputKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!shown.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + shown.length) % shown.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(shown.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = shown[activeIndex];
      if (command) run(command);
    }
  }

  // Headings only while browsing; a typed query is ranked across groups.
  const grouped = !query.trim();

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label={`${title}: open the command palette`}
        aria-keyshortcuts="/ Control+K Meta+K"
        title="Press / or Ctrl K"
        className={cn("kbd-chip shrink-0", className)}
      >
        <span className="kbd-key" aria-hidden="true">/</span>
        {chipLabel}
      </button>
      <RadixDialog.Root open={open} onOpenChange={setOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="dialog-overlay fixed inset-0 z-[60] bg-[#05030d]/70 backdrop-blur-sm" />
          <RadixDialog.Content
            aria-describedby={undefined}
            className="palette-panel panel fixed left-1/2 top-[12vh] z-[60] flex max-h-[70vh] w-[min(94vw,34rem)] -translate-x-1/2 flex-col overflow-hidden rounded-xl p-0 shadow-elev-2"
          >
            <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
            <div className="flex items-center gap-2 border-b border-amber-400/15 px-3 py-2.5">
              <Search className="size-4 shrink-0 text-amber-200/70" aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKey}
                placeholder={placeholder}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeIndex >= 0 ? `${listId}-${shown[activeIndex].id}` : undefined}
                aria-label={title}
                className="min-w-0 flex-1 bg-transparent text-sm text-stone-100 outline-none placeholder:text-stone-500"
              />
              <span className="kbd-key" aria-hidden="true">Esc</span>
            </div>
            <div ref={listRef} id={listId} role="listbox" aria-label={title} className="palette-list min-h-0 flex-1 overflow-y-auto p-1.5">
              {shown.map((command, index) => (
                <PaletteRow
                  key={command.id}
                  id={`${listId}-${command.id}`}
                  command={command}
                  heading={grouped && command.group && command.group !== shown[index - 1]?.group ? command.group : null}
                  selected={index === activeIndex}
                  showGroup={!grouped}
                  onHover={() => setActive(index)}
                  onRun={() => run(command)}
                />
              ))}
              {!shown.length ? (
                <p className="reveal px-3 py-6 text-center text-sm text-stone-500">Nothing here answers to that.</p>
              ) : null}
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-amber-400/10 px-3 py-1.5 text-[11px] text-stone-500">
              <span><span className="kbd-key">↑</span> <span className="kbd-key">↓</span> move</span>
              <span><span className="kbd-key">Enter</span> run</span>
              <span className="ml-auto">{shown.length} of {commands.length}</span>
            </p>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </>
  );
}

function PaletteRow({
  id,
  command,
  heading,
  selected,
  showGroup,
  onHover,
  onRun,
}: {
  id: string;
  command: PaletteCommand;
  heading: string | null;
  selected: boolean;
  showGroup: boolean;
  onHover: () => void;
  onRun: () => void;
}) {
  return (
    <>
      {heading ? <div role="presentation" className="reveal palette-group">{heading}</div> : null}
      <div
        id={id}
        role="option"
        aria-selected={selected}
        // The pointer picks the same row the arrows do, so Enter never runs a
        // row other than the lit one.
        onPointerMove={selected ? undefined : onHover}
        onClick={onRun}
        className="palette-option text-stone-200"
      >
        <GameIcon icon={{ kind: "glyph", key: command.glyph }} size="size-7" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{command.label}</span>
          {command.hint ? <span className="block truncate text-xs text-stone-500">{command.hint}</span> : null}
        </span>
        {showGroup && command.group ? (
          <span className="hidden shrink-0 text-[10px] uppercase tracking-wider text-stone-500 sm:block">{command.group}</span>
        ) : null}
      </div>
    </>
  );
}
