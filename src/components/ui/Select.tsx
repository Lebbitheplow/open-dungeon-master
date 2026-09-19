"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import type { IconRef } from "@/lib/icons";

// The kit's select (docs/visual-overhaul-plan.md 8c.4): the same choice a
// native <select> offers, as a menu that belongs to the app. The trigger is a
// plated field with the chosen label; the list springs open, its rows arrive
// one after another, each may carry a painted glyph and a second line, and
// the chosen one is ticked. Typing a letter jumps to a row (Radix typeahead),
// arrows move, Enter chooses, Escape closes: nothing a native select does is
// lost. `name` adds a hidden input so it still posts with a form.
export type SelectOption<T extends string> = {
  value: T;
  label: string;
  // A quieter second line under the label.
  hint?: string;
  icon?: IconRef;
  disabled?: boolean;
  // Options sharing a group are listed under that heading.
  group?: string;
};

export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  placeholder = "Choose",
  size = "md",
  disabled = false,
  name,
  className,
  align = "start",
}: {
  value: T | "";
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  // The accessible name; the visible label is the caller's.
  label: string;
  placeholder?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  name?: string;
  className?: string;
  align?: "start" | "end";
}) {
  const chosen = options.find((option) => option.value === value) ?? null;
  const groups: Array<{ name: string; items: SelectOption<T>[] }> = [];
  for (const option of options) {
    const key = option.group ?? "";
    const group = groups.find((entry) => entry.name === key);
    if (group) group.items.push(option);
    else groups.push({ name: key, items: [option] });
  }
  let row = 0;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button type="button" aria-label={label} disabled={disabled} className={cn("kit-select", size === "sm" && "kit-select-sm", className)}>
          {chosen?.icon ? <GameIcon icon={chosen.icon} size={size === "sm" ? "size-4" : "size-5"} /> : null}
          <span className={cn("min-w-0 grow truncate text-left", !chosen && "text-stone-500")}>{chosen ? chosen.label : placeholder}</span>
          <ChevronDown className="kit-select-chevron size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} collisionPadding={10} className="panel kit-select-list z-[75]">
          <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
            {groups.map((group) => (
              <div key={group.name || "_"}>
                {group.name ? <DropdownMenu.Label className="kit-select-group">{group.name}</DropdownMenu.Label> : null}
                {group.items.map((option) => {
                  const index = row++;
                  return (
                    <DropdownMenu.RadioItem
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                      className="kit-select-row"
                      style={{ animationDelay: `${Math.min(index, 10) * 22}ms` }}
                    >
                      {option.icon ? <GameIcon icon={option.icon} size="size-6" /> : null}
                      <span className="min-w-0 grow">
                        <span className="block truncate">{option.label}</span>
                        {option.hint ? <span className="block truncate text-[11px] text-stone-500">{option.hint}</span> : null}
                      </span>
                      <DropdownMenu.ItemIndicator>
                        <Check className="size-3.5 text-amber-300" aria-hidden="true" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  );
                })}
              </div>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// For call sites that think in <option> children rather than a list.
export function optionsFrom<T extends string>(pairs: Array<[T, string]>): SelectOption<T>[] {
  return pairs.map(([value, label]) => ({ value, label }));
}

export type { ReactNode };
