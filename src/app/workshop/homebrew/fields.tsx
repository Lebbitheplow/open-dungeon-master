"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { FieldLabel, OptionalStepper, chip, chipOn, chipRow } from "@/app/workshop/kit";
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
  plain = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  glossary?: FieldGlossary;
  // A kit control (a select, a stepper) holds several buttons and names
  // itself, so it sits in a div; see below.
  plain?: boolean;
}) {
  // A div rather than a <label> when a glossary button sits in the caption or
  // a kit control is inside: a label forwards clicks on its text to the first
  // control inside, which would open the dialog from the caption and the list
  // from the ⓘ, or step a number down from its caption.
  const Wrap = glossary || plain ? "div" : "label";
  return (
    <Wrap className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="flex items-center gap-1">
        <FieldLabel>{label}</FieldLabel>
        {glossary ? <OptionGlossary title={glossary.title} entries={glossary.entries} /> : null}
      </span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-stone-500">{hint}</span> : null}
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
          className={cn(ui.input, "min-w-32 flex-1")}
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
    <Field label={label} hint={hint} className={className} plain>
      <OptionalStepper
        label={label}
        value={value === "" ? undefined : value}
        fallback={min ?? 0}
        min={min}
        max={max}
        step={step}
        size="md"
        onChange={onChange}
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
    <Field label={label} hint={hint} className={className} glossary={glossary} plain>
      <Select<T> label={label} value={value} onChange={onChange} options={options.map((option) => ({ ...option }))} />
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
    <div className="flex min-h-10 flex-wrap items-center gap-2 text-sm text-stone-300">
      <Switch on={checked} onChange={onChange} label={label} />
      {label}
      {hint ? <span className="text-[11px] text-stone-500">{hint}</span> : null}
    </div>
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
        className={ui.input}
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
    <div className={cn("stagger-pop", chipRow)}>
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
            className={cn(ui.btnSmall, chip, "normal-case", on && chipOn)}
          >
            {labels?.[option] ?? option}
          </button>
        );
      })}
    </div>
  );
}
