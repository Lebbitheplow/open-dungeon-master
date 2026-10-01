"use client";

import { useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { FieldLabel } from "@/app/campaigns/[campaignId]/DmConsoleParts";
import { DmSquarePick } from "@/app/campaigns/[campaignId]/DmSquarePick";
import {
  FieldInput,
  argsFor,
  initialValue,
  type Value,
} from "@/app/campaigns/[campaignId]/DmActionFields";
import type { CatalogEntry, CatalogField } from "@/lib/dm/invoke-catalog";
import { needsConfirm } from "@/lib/dm/catalog-types";
import { describeAdjudicationResult, type ResultLine } from "@/lib/dm/catalog-result";
import { holdConsoleOutcome } from "@/app/campaigns/[campaignId]/ConsoleOutcomeBanner";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// One adjudication, rendered from its catalog entry. Nothing here knows what
// any particular action does: the fields come from the catalog and the rules
// come from the server, which is what keeps a tool added for the AI DM
// reachable by a human one without touching this file.

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
  if (field.kind === "characters" || field.kind === "enemies") {
    return Array.isArray(raw) && raw.every((entry) => typeof entry === "string")
      ? (raw as string[])
      : null;
  }
  if (field.kind === "list") {
    return Array.isArray(raw) ? raw.map(String).join(", ") : typeof raw === "string" ? raw : null;
  }
  if (field.kind === "shares" || field.kind === "hitDice") {
    // Rows are the handler's own objects; a suggestion in any other shape
    // is dropped rather than half-read.
    return Array.isArray(raw) && raw.every((row) => row && typeof row === "object")
      ? (raw as Value)
      : null;
  }
  if (field.kind === "number") {
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  if (field.kind === "select" && field.other) {
    // A pick that also takes a typed value (a story condition) keeps it.
    return typeof raw === "string" ? raw : null;
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
  const [outcome, setOutcome] = useState<ResultLine[]>([]);

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
    const args = argsFor(entry.fields, values);
    // What cannot be taken back asks first (end the fight, dismiss a
    // companion, a death).
    const question = needsConfirm(entry, args);
    if (question && !(await appConfirm(question, { title: entry.label, actionLabel: "Run it" }))) {
      return;
    }
    setBusy(true);
    setError("");
    setOutcome([]);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: entry.name, args }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(String(body.error ?? "The engine refused that."));
        return;
      }
      const lines = describeAdjudicationResult(body.result);
      setOutcome(lines);
      // Starting a fight moves the panel to the board: the result waits there.
      if (entry.name === "start_encounter") holdConsoleOutcome(campaignId, entry.label, lines);
      // Keep the picked character or enemy: a DM usually runs several
      // actions against the same target in a row.
      setValues((current) =>
        Object.fromEntries(
          entry.fields.map((field) => [
            field.name,
            field.kind === "character" || field.kind === "enemy" || field.kind === "combatant"
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
            <div className={cn(field.square && "flex flex-wrap items-center gap-x-2")}>
              <FieldLabel className={cn((field.kind === "boolean" || field.square) && "mb-0")}>
                {field.label}
                {field.required ? <span className="text-amber-400"> *</span> : null}
              </FieldLabel>
              {/* A spell area's square, picked on the battle map: one tap
                  fills this column and its row (DmSquarePick.tsx). */}
              {field.square ? (
                <DmSquarePick
                  requestId={`${entry.name}:${field.name}`}
                  field={field}
                  values={values}
                  onPick={(square) => {
                    const row = field.square?.row;
                    setValues((current) => ({ ...current, [field.name]: square.x, ...(row ? { [row]: square.y } : {}) }));
                  }}
                />
              ) : null}
            </div>
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
        {error ? (
          <span role="alert" className="motion-shake inline-block text-xs text-red-300">
            {error}
          </span>
        ) : null}
      </div>
      {outcome.length ? (
        // The engine's answer, line by line: the hit points it moved, the
        // resistance it applied, the concentration it broke.
        <ul className="reveal stagger space-y-0.5 rounded-lg border border-stone-700/50 bg-stone-950/40 px-2.5 py-2 text-xs" aria-live="polite">
          {outcome.map((line, index) => (
            <li
              key={`${index}-${line.text}`}
              className={cn(
                line.tone === "bad" ? "text-ember-300" : line.tone === "good" ? "text-emerald-300" : "text-stone-200",
              )}
            >
              {line.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
