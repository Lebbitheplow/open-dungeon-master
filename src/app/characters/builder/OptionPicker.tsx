"use client";

import { Check, ChevronDown } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { InfoButton, type ContentRef } from "@/components/ui/InfoDialog";

export type PickerOption = {
  // Value handed to onChange. The subclass picker stores names, not slugs,
  // so this is not always the reference slug.
  id: string;
  name: string;
  // Small right-aligned text on the row (hit die, granted skills).
  meta?: string;
  infoText?: string | null;
  reference?: ContentRef;
};

export type PickerGroup = { label: string | null; options: PickerOption[] };

// Dropdown replacement for the builder's race/class/subclass/background
// selects. A native <option> cannot hold a button, and these lists deserve
// the same per-row info affordance the spell picker has, so this renders
// the option list itself with an InfoButton on every row.
export default function OptionPicker({
  value,
  groups,
  onChange,
  placeholder = "Choose...",
  className,
}: {
  value: string;
  groups: PickerGroup[];
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const selectedRow = useRef<HTMLLIElement>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (container.current && !container.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (open) {
      selectedRow.current?.scrollIntoView({ block: "nearest" });
    }
  }, [open]);

  const selected = groups
    .flatMap((group) => group.options)
    .find((option) => option.id === value);

  return (
    <div
      ref={container}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(className, "flex items-center justify-between gap-2 text-left")}
      >
        <span className={cn("truncate", !selected?.name && "text-stone-500")}>
          {selected?.name || placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 text-stone-500" />
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto panel panel-smoke rounded-lg"
        >
          {groups.map((group, groupIndex) => (
            <Fragment key={group.label ?? `group-${groupIndex}`}>
              {group.label ? (
                <li className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-amber-200/70">
                  {group.label}
                </li>
              ) : null}
              {group.options.map((option) => {
                const isSelected = option.id === value;
                return (
                  <li
                    key={option.id || "__empty"}
                    ref={isSelected ? selectedRow : undefined}
                    role="option"
                    aria-selected={isSelected}
                    className="flex items-center gap-1 pr-2 hover:bg-stone-800"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onChange(option.id);
                        setOpen(false);
                      }}
                      className="flex grow items-center justify-between gap-2 px-3 py-2 text-left"
                    >
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
                      </span>
                      <span className="shrink-0 text-xs text-stone-500">
                        {option.meta ?? ""}
                      </span>
                    </button>
                    <InfoButton
                      label={option.name}
                      text={option.infoText}
                      reference={option.reference}
                    />
                  </li>
                );
              })}
            </Fragment>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
