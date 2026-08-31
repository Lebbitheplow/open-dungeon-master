"use client";

import { useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CatalogEntry, CatalogField } from "@/lib/dm/invoke-catalog";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// One adjudication, rendered from its catalog entry. Nothing here knows what
// any particular action does: the fields come from the catalog and the rules
// come from the server, which is what keeps a tool added for the AI DM
// reachable by a human one without touching this file.

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-700 focus:outline-none";

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
}: {
  campaignId: string;
  entry: CatalogEntry;
  sheets: CharacterSheet[];
  encounter: PublicEncounter | null;
  // Suggested arguments from the assist rail. Advisory: the DM still presses
  // the button, and anything that does not fit its field is left blank.
  initialArgs?: Record<string, unknown>;
  onRan?: () => void;
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
    <div className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/60 p-3">
      <div>
        <p className="text-sm font-medium text-amber-100">{entry.label}</p>
        <p className="text-xs text-stone-500">{entry.summary}</p>
      </div>

      {blocked ? (
        <p className="rounded-md border border-stone-800 bg-stone-900/60 px-2 py-1.5 text-xs text-stone-400">
          Needs a fight running. Start one first.
        </p>
      ) : null}

      <div className="space-y-2">
        {entry.fields.map((field) => (
          <label key={field.name} className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-stone-500">
              {field.label}
              {field.required ? <span className="text-amber-500"> *</span> : null}
            </span>
            <FieldInput
              field={field}
              value={values[field.name]}
              onChange={(value) => set(field.name, value)}
              sheets={sheets}
              enemies={enemies}
            />
            {field.help ? <span className="block text-[11px] text-stone-600">{field.help}</span> : null}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={busy || blocked}
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-amber-800 bg-amber-950/40 px-2.5 py-1.5 text-xs text-amber-100",
            "hover:bg-amber-900/40 disabled:opacity-40",
          )}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          Run
        </button>
        {error ? <span className="text-xs text-red-300">{error}</span> : null}
        {outcome ? <span className="text-xs text-emerald-300">{outcome}</span> : null}
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
    case "character":
      return (
        <select
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        >
          <option value="">Pick a character</option>
          {sheets.map((sheet) => (
            <option key={sheet.id} value={sheet.id}>
              {sheet.name}
            </option>
          ))}
        </select>
      );
    case "characters": {
      const picked = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-1">
          {sheets.map((sheet) => {
            const on = picked.includes(sheet.id);
            return (
              <button
                key={sheet.id}
                type="button"
                onClick={() =>
                  onChange(on ? picked.filter((id) => id !== sheet.id) : [...picked, sheet.id])
                }
                className={cn(
                  "rounded-md border px-2 py-1 text-xs",
                  on
                    ? "border-amber-700 bg-amber-950/50 text-amber-100"
                    : "border-stone-700 text-stone-400 hover:text-stone-200",
                )}
              >
                {sheet.name}
              </button>
            );
          })}
          {sheets.length === 0 ? (
            <span className="text-xs text-stone-600">Nobody has a character yet.</span>
          ) : null}
        </div>
      );
    }
    case "enemy":
      return (
        <select
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        >
          <option value="">Pick an enemy</option>
          {enemies.map((enemy) => (
            <option key={enemy.id} value={enemy.id}>
              {enemy.name}
              {enemy.currentHp !== undefined ? ` (${enemy.currentHp}/${enemy.maxHp})` : ""}
            </option>
          ))}
        </select>
      );
    case "select":
      return (
        <select
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        >
          <option value="">Not set</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="size-4 accent-amber-600"
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={value === "" || value === undefined ? "" : Number(value)}
          min={field.min}
          max={field.max}
          onChange={(event) =>
            onChange(event.target.value === "" ? "" : Number(event.target.value))
          }
          className={inputClass}
        />
      );
    case "longtext":
      return (
        <textarea
          value={String(value ?? "")}
          rows={3}
          placeholder={field.placeholder}
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
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      );
  }
}
