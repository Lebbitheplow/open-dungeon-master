"use client";

import { AlertTriangle, Hammer, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  IMPORT_KINDS,
  IMPORT_KIND_LABELS,
  SINGULAR_KINDS,
  type ImportKind,
  type ImportPlan,
} from "@/lib/workshop/import";
import type { ImportSourceSummary } from "@/app/workshop/types";

// Choosing what crosses over into a table.
//
// The source is a workshop or another campaign. Both are campaigns rows
// holding the same content tables, so both are the same copy, and the server
// decides which ones this person may copy out of
// (src/lib/db/import-sources.ts).
//
// Used in two places with one difference. In the lobby a campaign already
// exists, so the picker asks the server what the import WOULD do and shows
// the collisions and overwrites. At campaign creation there is no campaign
// yet, so there is nothing to collide with: a fresh table is empty, and the
// counts from the source are the whole truth.

export type ImportSelection = {
  sourceId: string;
  select: ImportKind[];
  houseRules: "replace" | "append";
};

export const EMPTY_SELECTION: ImportSelection = {
  sourceId: "",
  select: [],
  houseRules: "replace",
};

export function ContentImportPicker({
  campaignId,
  selection,
  onChange,
  onImported,
}: {
  // Omitted at campaign creation, where the target does not exist yet.
  campaignId?: string;
  selection: ImportSelection;
  onChange: (selection: ImportSelection) => void;
  // Only meaningful with a campaignId: importing happens immediately.
  onImported?: (copied: number) => void;
}) {
  const [sources, setSources] = useState<ImportSourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/import-sources")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setSources(data.sources ?? []);
        }
      })
      .catch(() => {
        // No sources is a valid state; the section explains itself.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A campaign cannot import from itself, and offering it would be the one
  // option guaranteed to fail.
  const offered = sources.filter((source) => source.id !== campaignId);
  const workshops = offered.filter((source) => source.kind === "workshop");
  const campaigns = offered.filter((source) => source.kind !== "workshop");
  const chosen = offered.find((source) => source.id === selection.sourceId) ?? null;

  // The available kinds are the ones this source actually holds. Offering a
  // tickbox for something that would copy nothing is a lie the DM only
  // discovers after pressing the button.
  const available = chosen
    ? IMPORT_KINDS.filter((kind) => (chosen.contents?.[kind] ?? 0) > 0)
    : [];

  // The state lands in a .then callback rather than after an await, so the
  // refetch reads as "subscribe to an external system" to React and to the
  // effect linter, which is what it is. Same shape as DmMapStudioPanel.
  const refreshPlan = useCallback(() => {
    if (!campaignId || !selection.sourceId || !selection.select.length) {
      return Promise.resolve().then(() => setPlan(null));
    }
    const params = new URLSearchParams({ sourceId: selection.sourceId });
    for (const kind of selection.select) {
      params.append("select", kind);
    }
    return fetch(`/api/campaigns/${campaignId}/import?${params}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setPlan(data?.plan ?? null))
      .catch(() => {
        // transient; the next change reloads
      });
  }, [campaignId, selection.sourceId, selection.select]);

  useEffect(() => {
    void refreshPlan();
  }, [refreshPlan]);

  function choose(source: ImportSourceSummary | null) {
    if (!source) {
      onChange(EMPTY_SELECTION);
      return;
    }
    // Everything the source has, ticked. Bringing all of it is the common
    // case, and unticking is easier than hunting for what exists.
    onChange({
      ...selection,
      sourceId: source.id,
      select: IMPORT_KINDS.filter((kind) => (source.contents?.[kind] ?? 0) > 0),
    });
  }

  function toggle(kind: ImportKind) {
    onChange({
      ...selection,
      select: selection.select.includes(kind)
        ? selection.select.filter((entry) => entry !== kind)
        : [...selection.select, kind],
    });
  }

  async function importNow() {
    if (!campaignId || !selection.sourceId || !selection.select.length) {
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNote(data.error || "Could not import.");
        return;
      }
      setNote(`Brought ${data.copied} item${data.copied === 1 ? "" : "s"} across.`);
      onChange({ ...selection, select: [] });
      onImported?.(data.copied ?? 0);
      await refreshPlan();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Loader2 className="size-4 animate-spin text-stone-500" />;
  }

  if (!offered.length) {
    return (
      <p className="text-xs text-stone-500">
        You have nothing to copy from yet. Build maps, lore and encounters in the Workshop, or run
        a campaign, and you can bring any of it straight in here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-stone-400">Start from</span>
        <select
          value={selection.sourceId}
          onChange={(event) =>
            choose(offered.find((source) => source.id === event.target.value) ?? null)
          }
          className={ui.input}
        >
          <option value="">None</option>
          {workshops.length ? (
            <optgroup label="Workshops">
              {workshops.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title}
                </option>
              ))}
            </optgroup>
          ) : null}
          {campaigns.length ? (
            <optgroup label="Campaigns">
              {campaigns.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>

      {chosen ? (
        available.length ? (
          <>
            <div className="space-y-1">
              {available.map((kind) => (
                <label key={kind} className="flex items-center gap-2 text-sm text-stone-300">
                  <input
                    type="checkbox"
                    checked={selection.select.includes(kind)}
                    onChange={() => toggle(kind)}
                    className="accent-amber-400"
                  />
                  <span>{IMPORT_KIND_LABELS[kind]}</span>
                  {SINGULAR_KINDS.has(kind) ? null : (
                    <span className="text-xs text-stone-500">({chosen.contents[kind]})</span>
                  )}
                </label>
              ))}
            </div>

            {selection.select.includes("houseRules") ? (
              <label className="block">
                <span className="mb-1 block text-xs text-stone-400">Existing house rules</span>
                <select
                  value={selection.houseRules}
                  onChange={(event) =>
                    onChange({
                      ...selection,
                      houseRules: event.target.value as "replace" | "append",
                    })
                  }
                  className={cn(ui.input, "py-1 text-xs")}
                >
                  <option value="replace">Replace them</option>
                  <option value="append">Keep them and add these</option>
                </select>
              </label>
            ) : null}

            {plan?.warnings.length ? (
              <ul className="space-y-1">
                {plan.warnings.map((warning, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-1.5 text-xs text-amber-300/90"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>{warning.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {campaignId ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={importNow}
                  disabled={busy || !selection.select.length}
                  className={ui.btnSmall}
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Hammer className="size-3.5" />}
                  Bring it in
                </button>
                {note ? <span className="text-xs text-emerald-400">{note}</span> : null}
              </div>
            ) : (
              <p className="text-xs text-stone-500">
                This lands in the campaign right after it is created. Nothing is removed from
                where it came from.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-stone-500">
            {chosen.kind === "workshop"
              ? "That workshop is still empty. Build something in it first."
              : "That campaign has no prep to copy yet."}
          </p>
        )
      ) : null}
    </div>
  );
}

// Posts the chosen import after a campaign row exists. Mirrors
// submitWorldSetup in src/app/WorldSetupFields.tsx, which is the same
// pattern for the same reason: the campaign has to exist before anything can
// be written into it.
export async function submitContentImport(campaignId: string, selection: ImportSelection) {
  if (!selection.sourceId || !selection.select.length) {
    return;
  }
  await fetch(`/api/campaigns/${campaignId}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(selection),
  }).catch(() => undefined);
}
