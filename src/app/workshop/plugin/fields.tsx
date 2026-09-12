"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { AddFromList, type AddOption } from "@/components/ui/AddFromList";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { input, removeAt, replaceAt } from "@/app/workshop/plugin/types";

// The field primitives the Plugin sections are built from: a labelled text
// field with its cap shown, a list of name-and-blurb pairs, a list of lines,
// and a row of chips. Every list is add-and-remove with the rows editable
// in place; nothing here opens a dialog, so the same markup works in the
// wizard's steps and the section tabs.

export function TextField({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  hint,
  rows,
  className,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  hint?: string;
  rows?: number;
  className?: string;
  required?: boolean;
}) {
  const shared = {
    value,
    maxLength,
    placeholder,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
    className: ui.input,
  };
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 flex items-baseline justify-between gap-2 text-xs uppercase tracking-wide text-stone-500">
        <span>
          {label}
          {required ? <span className="text-amber-400/80"> *</span> : null}
        </span>
        <span className="text-[10px] normal-case tracking-normal text-stone-600">
          {value.length}/{maxLength}
        </span>
      </span>
      {rows ? <textarea rows={rows} {...shared} /> : <input {...shared} />}
      {hint ? <span className="mt-1 block text-[11px] text-stone-500">{hint}</span> : null}
    </label>
  );
}

// Two-column rows: a short name and a longer line about it. Factions,
// places and glossary entries are all this shape.
export function PairList<T extends Record<string, string>>({
  items,
  onChange,
  first,
  second,
  addLabel,
  empty,
  max = 200,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  first: { key: keyof T & string; label: string; max: number };
  second: { key: keyof T & string; label: string; max: number };
  addLabel: string;
  empty: string;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      {items.length === 0 ? <p className="text-[11px] italic text-stone-600">{empty}</p> : null}
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-1.5">
          <input
            value={item[first.key]}
            maxLength={first.max}
            placeholder={first.label}
            aria-label={first.label}
            onChange={(event) =>
              onChange(replaceAt(items, index, { ...item, [first.key]: event.target.value }))
            }
            className={cn(input, "w-2/5 min-w-0")}
          />
          <input
            value={item[second.key]}
            maxLength={second.max}
            placeholder={second.label}
            aria-label={second.label}
            onChange={(event) =>
              onChange(replaceAt(items, index, { ...item, [second.key]: event.target.value }))
            }
            className={cn(input, "min-w-0 flex-1")}
          />
          <button
            type="button"
            onClick={() => onChange(removeAt(items, index))}
            aria-label={`Remove ${item[first.key] || "this row"}`}
            className="rounded-md p-1 text-stone-600 hover:text-red-300"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={items.length >= max}
        onClick={() => onChange([...items, { [first.key]: "", [second.key]: "" } as T])}
        className={cn(ui.btnSmall, "text-xs")}
      >
        <Plus className="size-3.5" /> {addLabel}
      </button>
    </div>
  );
}

// One line per row: hooks.
export function LineList({
  items,
  onChange,
  maxLength,
  addLabel,
  placeholder,
  empty,
  max = 200,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  maxLength: number;
  addLabel: string;
  placeholder: string;
  empty: string;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      {items.length === 0 ? <p className="text-[11px] italic text-stone-600">{empty}</p> : null}
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-1.5">
          <input
            value={item}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(event) => onChange(replaceAt(items, index, event.target.value))}
            className={cn(input, "min-w-0 flex-1")}
          />
          <button
            type="button"
            onClick={() => onChange(removeAt(items, index))}
            aria-label="Remove this line"
            className="rounded-md p-1 text-stone-600 hover:text-red-300"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={items.length >= max}
        onClick={() => onChange([...items, ""])}
        className={cn(ui.btnSmall, "text-xs")}
      >
        <Plus className="size-3.5" /> {addLabel}
      </button>
    </div>
  );
}

// Short values as chips: name seeds typed one at a time, or picked from a
// closed list (companion races, alignments) when `options` is given. A
// typed chip is added on Enter or with the button, never on blur, so a
// half-typed name is not kept by accident.
export function ChipList({
  items,
  onChange,
  maxLength = 40,
  placeholder,
  options,
  prompt,
  labelFor,
  max = 60,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  maxLength?: number;
  placeholder?: string;
  options?: readonly AddOption[];
  prompt?: string;
  labelFor?: (value: string) => string;
  max?: number;
}) {
  const [typed, setTyped] = useState("");
  const add = (value: string) => {
    const trimmed = value.trim().slice(0, maxLength);
    if (!trimmed || items.some((item) => item.toLowerCase() === trimmed.toLowerCase()) || items.length >= max) {
      return;
    }
    onChange([...items, trimmed]);
    setTyped("");
  };
  const remaining = options?.filter((option) => {
    const value = typeof option === "string" ? option : option.value;
    return !items.includes(value);
  });
  return (
    <div className="space-y-1.5">
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-center gap-1 rounded-full border border-stone-700 bg-stone-900/60 py-0.5 pl-2.5 pr-1 text-xs text-stone-200"
          >
            {labelFor ? labelFor(item) : item}
            <button
              type="button"
              onClick={() => onChange(items.filter((current) => current !== item))}
              aria-label={`Remove ${item}`}
              className="rounded-full p-0.5 text-stone-500 hover:text-red-300"
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      {options ? (
        <AddFromList prompt={prompt ?? "Add"} options={remaining ?? []} onPick={add} />
      ) : (
        <div className="flex gap-1.5">
          <input
            value={typed}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add(typed);
              }
            }}
            className={cn(input, "min-w-0 flex-1")}
          />
          <button type="button" onClick={() => add(typed)} disabled={!typed.trim()} className={cn(ui.btnSmall, "text-xs")}>
            <Plus className="size-3.5" /> Add
          </button>
        </div>
      )}
    </div>
  );
}
