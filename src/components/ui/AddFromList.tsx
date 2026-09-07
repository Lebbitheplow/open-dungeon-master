"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

// A dropdown of every option a field accepts, beside a field that still
// takes typing. Picking one hands the value to the caller (which appends it
// to a comma list, inserts a link, or sets the field) and the select snaps
// back to its prompt, so it reads as "add one of these" rather than as the
// field's value. Options can be plain strings or value/label pairs.

const select =
  "rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300 focus:border-amber-500/50 focus:outline-none";

export type AddOption = string | { value: string; label: string };

export function AddFromList({
  prompt,
  options,
  onPick,
  className,
  disabled,
}: {
  // What the closed select says: "Add a skill", "Link an entry".
  prompt: string;
  options: readonly AddOption[];
  onPick: (value: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  if (options.length === 0) return null;
  return (
    <select
      id={id}
      value=""
      aria-label={prompt}
      disabled={disabled}
      onChange={(event) => {
        if (event.target.value) onPick(event.target.value);
      }}
      className={cn(select, "max-w-full truncate disabled:opacity-50", className)}
    >
      <option value="">{prompt}...</option>
      {options.map((option) => {
        const value = typeof option === "string" ? option : option.value;
        const label = typeof option === "string" ? option : option.label;
        return (
          <option key={value} value={value}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

// A datalist with the same option shape, for a single-value text input:
// the input gets list={id}, the datalist renders beside it.
export function Suggestions({ id, options }: { id: string; options: readonly AddOption[] }) {
  return (
    <datalist id={id}>
      {options.map((option) => {
        const value = typeof option === "string" ? option : option.value;
        const label = typeof option === "string" ? undefined : option.label;
        return <option key={value} value={value} label={label} />;
      })}
    </datalist>
  );
}
