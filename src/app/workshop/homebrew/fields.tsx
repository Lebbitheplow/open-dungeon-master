"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { input } from "@/app/workshop/homebrew/types";
import { AddFromList, Suggestions, type AddOption } from "@/components/ui/AddFromList";
import { OptionGlossary } from "@/components/ui/OptionGlossary";
import type { GlossaryEntry } from "@/lib/help/terms";

// The three inputs every homebrew form is made of, labelled the same way
// the monster editor labels its own, so the two read as one workshop.

// What the options of a pick list mean, one sentence each, shown as a ⓘ
// beside the caption.
export type FieldGlossary = { title: string; entries: readonly GlossaryEntry[] };

export function Field({
  label,
  hint,
  children,
  className,
  glossary,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  glossary?: FieldGlossary;
}) {
  // A div rather than a <label> when a glossary button sits in the caption:
  // a label forwards clicks on its text to the first control inside, which
  // would open the dialog from the caption and the list from the ⓘ.
  const Wrap = glossary ? "div" : "label";
  return (
    <Wrap className={cn("flex flex-col gap-0.5", className)}>
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-stone-500">
        {label}
        {glossary ? <OptionGlossary title={glossary.title} entries={glossary.entries} /> : null}
      </span>
      {children}
      {hint ? <span className="text-[10px] text-stone-600">{hint}</span> : null}
    </Wrap>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  maxLength = 200,
  className,
  suggestions,
  glossary,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  className?: string;
  // The values the field usually takes, offered as a pick list beside the
  // field (a real select, so it lists without typing in every browser; the
  // datalist only helps Chromium) while anything else can still be typed.
  suggestions?: readonly AddOption[];
  glossary?: FieldGlossary;
}) {
  const listId = useId();
  return (
    <Field label={label} hint={hint} className={className} glossary={glossary}>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          list={suggestions ? listId : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={cn(input, "min-w-32 flex-1")}
        />
        {suggestions ? <AddFromList prompt="Pick" options={suggestions} onPick={onChange} /> : null}
      </div>
      {suggestions ? <Suggestions id={listId} options={suggestions} /> : null}
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
  className,
}: {
  label: string;
  value: number | "";
  onChange: (value: number | "") => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) =>
          onChange(event.target.value === "" ? "" : Number(event.target.value))
        }
        className={cn(input, "w-full")}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  className,
  glossary,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  hint?: string;
  className?: string;
  glossary?: FieldGlossary;
}) {
  return (
    <Field label={label} hint={hint} className={className} glossary={glossary}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={cn(input, "w-full")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-stone-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-amber-500"
      />
      {label}
      {hint ? <span className="text-[10px] text-stone-600">{hint}</span> : null}
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  hint,
  maxLength = 8000,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(input, "w-full")}
      />
    </Field>
  );
}

// A word chip that toggles: weapon properties, spell classes.
export function ToggleChips<T extends string>({
  options,
  selected,
  onChange,
  labels,
}: {
  options: ReadonlyArray<T>;
  selected: ReadonlyArray<string>;
  onChange: (next: T[]) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => {
        const on = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(
                on
                  ? (selected.filter((entry) => entry !== option) as T[])
                  : ([...selected, option] as T[]),
              )
            }
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px]",
              on
                ? "border-amber-700 bg-amber-950/50 text-amber-100"
                : "border-stone-700 text-stone-400 hover:text-stone-200",
            )}
          >
            {labels?.[option] ?? option}
          </button>
        );
      })}
    </div>
  );
}
