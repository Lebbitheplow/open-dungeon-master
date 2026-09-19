"use client";

import { useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { Select, type SelectOption } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { FieldLabel, OptionalNumber } from "@/app/campaigns/[campaignId]/DmConsoleParts";
import type { CatalogEntry, CatalogField } from "@/lib/dm/invoke-catalog";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// One adjudication, rendered from its catalog entry. Nothing here knows what
// any particular action does: the fields come from the catalog and the rules
// come from the server, which is what keeps a tool added for the AI DM
// reachable by a human one without touching this file.

const inputClass = ui.input;

type Value = string | number | boolean | string[];

function initialValue(field: CatalogField): Value {
  if (field.kind === "boolean") {
    return field.default === true;
  }
  if (field.kind === "characters") {
    return [];
  }
  return "";
}

// A prefilled value from the assist rail's suggestion. The model produced it,
// so anything whose shape does not match the field it lands in is dropped
// rather than coerced: a half-wrong form the DM has to notice and repair is
// worse than an empty one.
function prefilledValue(field: CatalogField, raw: unknown): Value | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (field.kind === "boolean") {
    return typeof raw === "boolean" ? raw : null;
  }
  if (field.kind === "characters") {
    return Array.isArray(raw) && raw.every((entry) => typeof entry === "string")
      ? (raw as string[])
      : null;
  }
  if (field.kind === "number") {
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  if (field.kind === "select") {
    const allowed = (field.options ?? []).map((option) => option.value);
    return typeof raw === "string" && allowed.includes(raw) ? raw : null;
  }
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
}

export function DmActionForm({
  campaignId,
  entry,
  sheets,
  encounter,
  initialArgs,
  onRan,
  glyph = "tab-dm",
}: {
  campaignId: string;
  entry: CatalogEntry;
  sheets: CharacterSheet[];
  encounter: PublicEncounter | null;
  // Suggested arguments from the assist rail. Advisory: the DM still presses
  // the button, and anything that does not fit its field is left blank.
  initialArgs?: Record<string, unknown>;
  onRan?: () => void;
  // The painted glyph the console gave this action's plate, so the open form
  // wears the same face the row did.
  glyph?: string;
}) {
  const [values, setValues] = useState<Record<string, Value>>(() =>
    Object.fromEntries(
      entry.fields.map((field) => [
        field.name,
        (initialArgs ? prefilledValue(field, initialArgs[field.name]) : null) ??
          initialValue(field),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");

  const enemies = useMemo(
    // The dead and the fled are still on the encounter so the log reads
    // right; they are not things left to aim at.
    () => (encounter?.enemies ?? []).filter((enemy) => enemy.status === "alive"),
    [encounter],
  );
  const blocked = entry.needsEncounter && !encounter;

  function set(name: string, value: Value) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function run() {
    setBusy(true);
    setError("");
    setOutcome("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: entry.name, args: values }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(String(body.error ?? "The engine refused that."));
        return;
      }
      setOutcome(describeResult(body.result));
      // Keep the picked character or enemy: a DM usually runs several
      // actions against the same target in a row.
      setValues((current) =>
        Object.fromEntries(
          entry.fields.map((field) => [
            field.name,
            field.kind === "character" || field.kind === "enemy"
              ? current[field.name]
              : initialValue(field),
          ]),
        ),
      );
      onRan?.();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn(ui.card, "ornate space-y-3 p-3")}>
      <div className="flex items-start gap-2.5">
        <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-8" className="shrink-0" />
        <div className="min-w-0">
          <p className="gold-title font-display text-sm tracking-wide">{entry.label}</p>
          <p className="text-xs leading-snug text-stone-400">{entry.summary}</p>
        </div>
      </div>

      {blocked ? (
        <p className="reveal flex items-center gap-2 rounded-lg border border-amber-500/25 bg-stone-900/60 px-2.5 py-2 text-xs text-stone-300">
          <GameIcon icon={{ kind: "glyph", key: "tab-battle" }} size="size-5" className="shrink-0" />
          Needs a fight running. Start one first.
        </p>
      ) : null}

      {/* A div, not a label: the kit controls hold several buttons, and a
          label would press the first of them (the stepper's minus) whenever
          its caption was tapped. Each control carries the field's name. */}
      <div className="stagger space-y-2.5">
        {entry.fields.map((field) => (
          <div key={field.name} className={cn(field.kind === "boolean" && "flex flex-wrap items-center justify-between gap-x-3")}>
            <FieldLabel className={cn(field.kind === "boolean" && "mb-0")}>
              {field.label}
              {field.required ? <span className="text-amber-400"> *</span> : null}
            </FieldLabel>
            <FieldInput
              field={field}
              value={values[field.name]}
              onChange={(value) => set(field.name, value)}
              sheets={sheets}
              enemies={enemies}
            />
            {field.help ? <span className="mt-1 block basis-full text-[11px] leading-snug text-stone-500">{field.help}</span> : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={busy || blocked}
          aria-busy={busy}
          className={ui.btnPrimary}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Run
        </button>
        {error ? <span className="motion-shake inline-block text-xs text-red-300">{error}</span> : null}
        {outcome ? <span className="live-in text-xs text-emerald-300">{outcome}</span> : null}
      </div>
    </div>
  );
}

// The engine answers with whatever the handler returns. Rather than a
// per-action renderer, show the parts a DM actually reads: a note, a total,
// or a plain confirmation.
function describeResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return "Done.";
  }
  const record = result as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.total === "number") {
    parts.push(`Rolled ${record.total}`);
  }
  if (typeof record.success === "boolean") {
    parts.push(record.success ? "success" : "failure");
  }
  if (typeof record.note === "string") {
    parts.push(record.note);
  }
  if (typeof record.combat === "string") {
    parts.push(record.combat);
  }
  if (typeof record.summary === "string") {
    parts.push(record.summary);
  }
  return parts.length ? parts.join(" - ") : "Done.";
}

function FieldInput({
  field,
  value,
  onChange,
  sheets,
  enemies,
}: {
  field: CatalogField;
  value: Value;
  onChange: (value: Value) => void;
  sheets: CharacterSheet[];
  enemies: NonNullable<PublicEncounter["enemies"]>;
}) {
  switch (field.kind) {
    case "character": {
      // The empty row stays in the list, as it did in the browser's own
      // select, so a picked target can be unpicked.
      const options: SelectOption<string>[] = [
        { value: "", label: "Pick a character" },
        ...sheets.map((sheet) => ({
          value: sheet.id,
          label: sheet.name,
          icon: { kind: "glyph" as const, key: "tab-characters" },
        })),
      ];
      return (
        <Select
          value={String(value ?? "")}
          onChange={onChange}
          options={options}
          label={field.label}
          placeholder="Pick a character"
        />
      );
    }
    case "characters": {
      const picked = Array.isArray(value) ? value : [];
      return (
        <div className="stagger-pop flex flex-wrap gap-1.5" role="group" aria-label={field.label}>
          {sheets.map((sheet) => {
            const on = picked.includes(sheet.id);
            return (
              <button
                key={sheet.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange(on ? picked.filter((id) => id !== sheet.id) : [...picked, sheet.id])
                }
                className={cn(
                  ui.btnSmall,
                  "min-h-9 px-2.5 py-1 text-xs",
                  on && "border-amber-500/70 bg-amber-400/10 text-amber-100 shadow-glow-gold",
                )}
              >
                {sheet.name}
              </button>
            );
          })}
          {sheets.length === 0 ? (
            <span className="text-xs text-stone-500">Nobody has a character yet.</span>
          ) : null}
        </div>
      );
    }
    case "enemy": {
      const options: SelectOption<string>[] = [
        { value: "", label: "Pick an enemy" },
        ...enemies.map((enemy) => ({
          value: enemy.id,
          label: `${enemy.name}${enemy.currentHp !== undefined ? ` (${enemy.currentHp}/${enemy.maxHp})` : ""}`,
          icon: { kind: "glyph" as const, key: "system-bestiary" },
        })),
      ];
      return (
        <Select
          value={String(value ?? "")}
          onChange={onChange}
          options={options}
          label={field.label}
          placeholder="Pick an enemy"
        />
      );
    }
    case "select": {
      const options: SelectOption<string>[] = [
        { value: "", label: "Not set" },
        ...(field.options ?? []).map((option) => ({ value: option.value, label: option.label })),
      ];
      return (
        <Select
          value={String(value ?? "")}
          onChange={onChange}
          options={options}
          label={field.label}
          placeholder="Not set"
        />
      );
    }
    case "boolean":
      return <Switch on={Boolean(value)} onChange={onChange} label={field.label} />;
    case "number":
      return (
        <OptionalNumber
          value={value === "" || value === undefined ? "" : Number(value)}
          min={field.min}
          max={field.max}
          onChange={onChange}
          label={field.label}
          emptyHint="Not set"
        />
      );
    case "longtext":
      return (
        <textarea
          value={String(value ?? "")}
          rows={3}
          placeholder={field.placeholder}
          aria-label={field.label}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClass, "resize-y")}
        />
      );
    default:
      return (
        <input
          type="text"
          value={String(value ?? "")}
          placeholder={field.placeholder}
          aria-label={field.label}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      );
  }
}
