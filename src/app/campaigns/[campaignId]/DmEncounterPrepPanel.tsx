"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Swords, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatRoster, TEMPLATE_NAME_MAX } from "@/lib/dm/encounter-template-logic";
import { thresholdsForParty } from "@/lib/srd/encounter-math";
import { targetPartyLevels, type TargetParty } from "@/lib/workshop/kind";
import { Sheet } from "@/components/ui/Sheet";
import { DmWorkbenchPanel } from "@/app/campaigns/[campaignId]/DmWorkbenchPanel";
import { EncounterForm } from "@/app/workshop/encounters/EncounterForm";
import { EncounterRows } from "@/app/workshop/encounters/EncounterRows";
import {
  EMPTY_ENCOUNTER_DRAFT,
  type EncounterDraft,
  type MapOption,
  type PreparedEncounter,
  type TemplateReadout,
} from "@/app/workshop/encounters/types";

// Prepared encounters: the roster a DM writes down before the session and
// deploys in one action.
//
// The difficulty line under each one is not stored. It is recomputed on
// every read from the party as it stands today, because the party levels up
// between the prep and the table and a saved verdict would quietly go stale.
//
// Two layouts over one set of requests. "list" is the DM console's: the
// prepared fights as compact entries with the create form underneath. "rows"
// is the workshop's: the what-if workbench folded into a card at the top,
// one full-width row per fight with a CR budget bar, and the editor in a
// sheet. The bar's thresholds come from the target party the caller passes,
// through the same thresholdsForParty the workbench route and the target
// party bar read, so the three never disagree about what "deadly" is.

function DifficultyLine({ readout }: { readout: TemplateReadout }) {
  if (readout.unknownMonster) {
    return (
      <p className="text-[11px] text-red-400">
        Nothing in this world is called &quot;{readout.unknownMonster}&quot;.
      </p>
    );
  }
  return (
    <p className={cn("text-[11px]", readout.tooDeadly ? "text-red-400" : "text-stone-500")}>
      {readout.count} creature{readout.count === 1 ? "" : "s"}, {readout.verdict} ({readout.adjustedXp} XP
      against a {readout.ceiling} ceiling)
      {readout.tooDeadly ? ". The engine will refuse this as written." : ""}
    </p>
  );
}

export function DmEncounterPrepPanel({
  campaignId,
  layout = "list",
  targetParty,
}: {
  campaignId: string;
  layout?: "list" | "rows";
  // Read only in rows mode: the party the CR budget bar is drawn against. A
  // workshop declares one; a real campaign has no need of it because the
  // console never shows the bar.
  targetParty?: TargetParty;
}) {
  const [templates, setTemplates] = useState<PreparedEncounter[]>([]);
  const [draft, setDraft] = useState<EncounterDraft>(EMPTY_ENCOUNTER_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [maps, setMaps] = useState<MapOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const rows = layout === "rows";

  // The state lands in a .then callback rather than after an await, so the
  // refetch reads as "subscribe to an external system" to React and to the
  // effect linter, which is what it is.
  const load = useCallback(
    () =>
      fetch(`/api/campaigns/${campaignId}/dm/encounter-templates`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { templates: PreparedEncounter[] } | null) => {
          if (payload) {
            setTemplates(payload.templates);
          }
        })
        .catch(() => {
          // transient; the next action reloads
        }),
    [campaignId],
  );

  // The map drawer, for the "On which map" link. Same load-once shape as the
  // templates themselves.
  const loadMaps = useCallback(
    () =>
      fetch(`/api/campaigns/${campaignId}/dm/maps`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { maps: MapOption[] } | null) => {
          if (payload) {
            setMaps(payload.maps);
          }
        })
        .catch(() => {
          // transient; the picker just offers the generator until the next load
        }),
    [campaignId],
  );

  // The server costs every roster against the party it knows about, so when
  // the workshop's target party changes the readouts are stale until refetched.
  const partyKey = targetParty ? `${targetParty.size}:${targetParty.level}` : "";
  useEffect(() => {
    void load();
    void loadMaps();
  }, [load, loadMaps, partyKey]);

  function openEditor(template: PreparedEncounter | null) {
    setError("");
    setNote("");
    setEditingId(template?.id ?? null);
    setDraft(
      template
        ? {
            name: template.name,
            enemies: formatRoster(template.enemies),
            battlefield: template.battlefield,
            notes: template.notes,
            mapId: template.map.mapId ?? "",
          }
        : EMPTY_ENCOUNTER_DRAFT,
    );
    setEditorOpen(true);
  }

  // One request for both a new fight and an edit to an old one: the create
  // and update routes take the same body, so the only difference is where it
  // goes. The list layout never sets editingId and so always creates.
  async function save() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const base = `/api/campaigns/${campaignId}/dm/encounter-templates`;
      const response = await fetch(editingId ? `${base}/${editingId}` : base, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          enemies: draft.enemies,
          battlefield: draft.battlefield,
          notes: draft.notes,
          map: { mapId: draft.mapId || null },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That could not be saved.");
        return;
      }
      setDraft(EMPTY_ENCOUNTER_DRAFT);
      setEditingId(null);
      setEditorOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  // A second copy of the fight, for the version-two-of-this-ambush workflow:
  // same create route, name suffixed, linked map carried along.
  async function duplicate(template: PreparedEncounter) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/encounter-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${template.name} (copy)`.slice(0, TEMPLATE_NAME_MAX),
          enemies: formatRoster(template.enemies),
          battlefield: template.battlefield,
          notes: template.notes,
          map: template.map,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That could not be copied.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/campaigns/${campaignId}/dm/encounter-templates/${id}`, { method: "DELETE" });
    if (editingId === id) {
      setEditingId(null);
      setEditorOpen(false);
    }
    await load();
  }

  async function deploy(id: string) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/dm/encounter-templates/${id}/deploy`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        mapError?: string | null;
      };
      if (!response.ok) {
        setError(payload.error ?? "That could not be deployed.");
        return;
      }
      setNote(
        payload.mapError
          ? `The fight is on the table. Its saved map could not be used: ${payload.mapError}`
          : "The fight is on the table. Ask the party for initiative.",
      );
    } finally {
      setBusy(false);
    }
  }

  const feedback = (
    <>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {note ? <p className="text-[11px] text-emerald-400">{note}</p> : null}
    </>
  );

  if (rows) {
    const thresholds = targetParty ? thresholdsForParty(targetPartyLevels(targetParty)) : null;
    const editing = templates.find((template) => template.id === editingId) ?? null;
    return (
      <div className="space-y-3">
        <DmWorkbenchPanel campaignId={campaignId} collapsible />
        <EncounterRows
          encounters={templates}
          maps={maps}
          thresholds={thresholds}
          busy={busy}
          onOpen={openEditor}
          onDeploy={(template) => void deploy(template.id)}
          onDuplicate={(template) => void duplicate(template)}
          onDelete={(template) => void remove(template.id)}
        />
        {feedback}
        <Sheet
          open={editorOpen}
          onOpenChange={setEditorOpen}
          title={editing ? editing.name : "New encounter"}
          className="lg:w-[min(92vw,40rem)]"
        >
          <EncounterForm
            campaignId={campaignId}
            value={draft}
            onChange={setDraft}
            maps={maps}
            busy={busy}
            submitLabel={editing ? "Save" : "Prepare it"}
            onSubmit={() => void save()}
            variant="sheet"
          />
          <div className="mt-2">{feedback}</div>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section>
        <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
          <Swords className="size-3.5" /> Prepared encounters
        </h3>
        {templates.length ? (
          <ul className="space-y-1.5">
            {templates.map((template) => (
              <li
                key={template.id}
                className="rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-stone-200">{template.name}</p>
                    <p className="truncate text-xs text-stone-400">
                      {formatRoster(template.enemies).replace(/\n/g, ", ")}
                      {template.battlefield ? ` on ${template.battlefield}` : ""}
                    </p>
                    <DifficultyLine readout={template.readout} />
                    {template.notes ? (
                      <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-stone-500">
                        {template.notes}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deploy(template.id)}
                      className="rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
                    >
                      Deploy
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Duplicate ${template.name}`}
                      onClick={() => void duplicate(template)}
                      className="rounded p-1 text-stone-500 hover:text-stone-200 disabled:opacity-40"
                    >
                      <Copy className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${template.name}`}
                      onClick={() => void remove(template.id)}
                      className="rounded p-1 text-stone-500 hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2 text-xs text-stone-500">
            Nothing prepared. Write a roster below and it is one button at the table.
          </p>
        )}
      </section>

      <EncounterForm
        campaignId={campaignId}
        value={draft}
        onChange={setDraft}
        maps={maps}
        busy={busy}
        submitLabel="Prepare it"
        onSubmit={() => void save()}
      />

      {feedback}
    </div>
  );
}
