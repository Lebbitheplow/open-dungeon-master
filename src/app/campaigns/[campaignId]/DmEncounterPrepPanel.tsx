"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Swords, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  formatRoster,
  TEMPLATE_NAME_MAX,
  type TemplateEnemy,
} from "@/lib/dm/encounter-template-logic";
import { MonsterRosterPicker } from "@/app/campaigns/[campaignId]/MonsterRosterPicker";

// Prepared encounters: the roster a DM writes down before the session and
// deploys in one action.
//
// The difficulty line under each one is not stored. It is recomputed on
// every read from the party as it stands today, because the party levels up
// between the prep and the table and a saved verdict would quietly go stale.

type Readout = {
  verdict: string;
  adjustedXp: number;
  ceiling: number;
  tooDeadly: boolean;
  unknownMonster: string | null;
  count: number;
};

type Template = {
  id: string;
  name: string;
  enemies: TemplateEnemy[];
  battlefield: string;
  notes: string;
  map: { mapId: string | null };
  readout: Readout;
};

function DifficultyLine({ readout }: { readout: Readout }) {
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

export function DmEncounterPrepPanel({ campaignId }: { campaignId: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [enemies, setEnemies] = useState("");
  const [battlefield, setBattlefield] = useState("");
  const [notes, setNotes] = useState("");
  const [maps, setMaps] = useState<Array<{ id: string; name: string }>>([]);
  const [mapId, setMapId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // The state lands in a .then callback rather than after an await, so the
  // refetch reads as "subscribe to an external system" to React and to the
  // effect linter, which is what it is.
  const load = useCallback(
    () =>
      fetch(`/api/campaigns/${campaignId}/dm/encounter-templates`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { templates: Template[] } | null) => {
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
        .then((payload: { maps: Array<{ id: string; name: string }> } | null) => {
          if (payload) {
            setMaps(payload.maps);
          }
        })
        .catch(() => {
          // transient; the picker just offers the generator until the next load
        }),
    [campaignId],
  );

  useEffect(() => {
    void load();
    void loadMaps();
  }, [load, loadMaps]);

  async function save() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/encounter-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          enemies,
          battlefield,
          notes,
          map: { mapId: mapId || null },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That could not be saved.");
        return;
      }
      setName("");
      setEnemies("");
      setBattlefield("");
      setNotes("");
      setMapId("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  // A second copy of the fight, for the version-two-of-this-ambush workflow:
  // same create route, name suffixed, linked map carried along.
  async function duplicate(template: Template) {
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

      <section className="space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2">
        <input
          value={name}
          maxLength={TEMPLATE_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ambush at the ford"
          className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
        />
        <MonsterRosterPicker campaignId={campaignId} roster={enemies} onChange={setEnemies} />
        <textarea
          value={enemies}
          onChange={(event) => setEnemies(event.target.value)}
          rows={3}
          placeholder={"goblin x4\nhobgoblin"}
          className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
        />
        <p className="text-[10px] text-stone-600">
          One per line, name or slug, optional xN. The same shorthand Start a fight takes, so
          picking above and typing here are the same thing.
        </p>
        <input
          value={battlefield}
          onChange={(event) => setBattlefield(event.target.value)}
          placeholder="a rope bridge over a gorge"
          className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
        />
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">On which map</span>
          <select
            value={mapId}
            onChange={(event) => setMapId(event.target.value)}
            className="mt-0.5 w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
          >
            <option value="">Generator&apos;s choice</option>
            {maps.map((map) => (
              <option key={map.id} value={map.id}>
                {map.name}
              </option>
            ))}
          </select>
        </label>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          placeholder="Tactics, what they want, when they run."
          className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
        />
        <button
          type="button"
          disabled={busy || !name.trim() || !enemies.trim()}
          onClick={() => void save()}
          className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : null}
          Prepare it
        </button>
      </section>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {note ? <p className="text-[11px] text-emerald-400">{note}</p> : null}
    </div>
  );
}
