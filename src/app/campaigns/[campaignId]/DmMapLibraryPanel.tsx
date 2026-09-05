"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { backdropDataUrl, nameFromFilename } from "@/lib/battlemap/uvtt";
import { Sheet } from "@/components/ui/Sheet";
import { DEFAULT_MAP_TOOLS, type MapTools } from "@/app/campaigns/[campaignId]/MapToolbox";
import { MapCreateControls } from "@/app/workshop/maps/MapCreateControls";
import { MapEditor } from "@/app/workshop/maps/MapEditor";
import { MapGallery } from "@/app/workshop/maps/MapGallery";
import type { LibraryState, PreparedMap } from "@/app/workshop/maps/types";

// The map library: maps built before anybody needed them.
//
// This is the difference between the workshop's map tab and a preview
// button. A workshop has no party, so it can never open a scene and the
// studio has nothing to paint on; here a DM rolls or draws or imports a map,
// keeps it, and puts it on a table weeks later.
//
// Every edit is a request the server validates through the same painter the
// live board uses, so a map in this drawer is a map that can be played on.
//
// Two layouts over one set of requests. "drawer" is the DM console's: the
// creation controls, a chip per map, and the editor inline below. "gallery"
// is the workshop's: the controls fold into a New map card, every map is a
// thumbnail tile, and the editor opens in a sheet (full screen on a phone, a
// wide dialog on a desk) so the canvas gets the room it deserves.

export function DmMapLibraryPanel({
  campaignId,
  layout = "drawer",
}: {
  campaignId: string;
  layout?: "drawer" | "gallery";
}) {
  const [state, setState] = useState<LibraryState>({
    maps: [],
    board: null,
    hasParty: false,
    workshop: false,
  });
  const [selectedId, setSelectedId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tools, setTools] = useState<MapTools>(DEFAULT_MAP_TOOLS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // The state lands in a .then callback rather than after an await, so the
  // refetch reads as "subscribe to an external system" to React and to the
  // effect linter, which is what it is. Same shape as DmMapStudioPanel.
  const load = useCallback(
    () =>
      fetch(`/api/campaigns/${campaignId}/dm/maps`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: LibraryState | null) => {
          if (payload) {
            setState(payload);
          }
        })
        .catch(() => {
          // transient; the next action reloads
        }),
    [campaignId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const selected = state.maps.find((map) => map.id === selectedId) ?? null;
  const gallery = layout === "gallery";

  // Selecting a map is the same act in both layouts; in the gallery it also
  // raises the editor sheet, which the drawer has no need of.
  function select(id: string) {
    setSelectedId(id);
    if (gallery && id) {
      setEditorOpen(true);
    }
  }

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/maps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That did not work.");
        return null;
      }
      await load();
      return payload as { map?: PreparedMap; notes?: string[] };
    } finally {
      setBusy(false);
    }
  }

  async function create(body: Record<string, unknown>) {
    const result = await post(body);
    if (result?.map) {
      select(result.map.id);
    }
    return result;
  }

  // Stable across renders so the painter hook's debounced flush always
  // sends to the map that is open, not the one that was open when the
  // callback was made.
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      const mapId = selectedIdRef.current;
      if (!mapId) {
        return false;
      }
      setError("");
      const response = await fetch(`/api/campaigns/${campaignId}/dm/maps/${mapId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError((payload as { error?: string }).error ?? "That was refused.");
        return false;
      }
      await load();
      return true;
    },
    [campaignId, load],
  );

  async function act(action: "deploy" | "open-scene") {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError("");
    setNote("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/maps/${selected.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ do: action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That did not work.");
        return;
      }
      setNote(action === "deploy" ? "It is on the table." : "The scene is open.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  // An exact copy of the selected map. The create route speaks generator
  // inputs and the painter is the only legal terrain writer, so a duplicate
  // is composed: create with the same size, then one edit that returns the
  // copy to the original's terrain (the same request undo sends), carries
  // its lights, notes, tags and backdrop across.
  async function duplicate() {
    if (!selected) {
      return;
    }
    const original = selected;
    const created = await post({
      do: "create",
      name: `${original.name} (copy)`.slice(0, 80),
      width: original.width,
      height: original.height,
      blank: "rock",
      theme: original.theme,
      ambient: original.ambient,
    });
    const copy = created?.map;
    if (!copy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const carry: Record<string, unknown> = {
        replaceTerrain: original.terrain,
        lights: original.lights,
        notes: original.notes,
        tags: original.tags,
        labels: original.labels,
        props: original.props,
        zones: original.zones,
        overlayPath: original.overlayPath,
        ambience: original.ambience,
      };
      if (original.backdrop) {
        carry.backdropPath = original.backdrop.path;
        carry.backdropTransform = original.backdrop.transform;
      }
      const response = await fetch(`/api/campaigns/${campaignId}/dm/maps/${copy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(carry),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError((payload as { error?: string }).error ?? "The copy could not be painted.");
        return;
      }
      setSelectedId(copy.id);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) {
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/dm/maps/${selected.id}`, { method: "DELETE" });
      setSelectedId("");
      setEditorOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  // A Universal VTT export. The picture goes through /api/upload first,
  // which is this app's one image writer; only the geometry is sent to the
  // import, so a 12MB drawing does not travel twice.
  async function importUvtt(file: File) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      const art = backdropDataUrl(parsed);
      let backdropPath: string | undefined;
      if (art) {
        const upload = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl: art.dataUrl, name: file.name, type: art.type }),
        });
        const payload = await upload.json().catch(() => ({}));
        if (upload.ok) {
          backdropPath = payload.url;
        }
        // A picture that will not upload is not a reason to lose the walls:
        // the geometry is the part the rules need.
      }
      // The picture is already uploaded; sending it again would move the
      // same megabytes twice for a field the import does not read.
      const geometry = { ...parsed };
      delete geometry.image;
      const result = await post({
        do: "import-uvtt",
        name: nameFromFilename(file.name),
        ...(backdropPath ? { backdropPath } : {}),
        file: geometry,
      });
      if (result?.map) {
        select(result.map.id);
        setNote(result.notes?.[0] ?? "Imported.");
      }
    } catch {
      setError("That file is not a Universal VTT export this can read.");
    } finally {
      setBusy(false);
    }
  }

  const editor = selected ? (
    <MapEditor
      selected={selected}
      state={state}
      busy={busy}
      tools={tools}
      onTools={setTools}
      patch={patch}
      act={act}
      duplicate={duplicate}
      remove={remove}
    />
  ) : null;

  const feedback = (
    <>
      {note ? <p className="text-[11px] text-emerald-400">{note}</p> : null}
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </>
  );

  if (gallery) {
    return (
      <div className="space-y-3">
        <section className={`${ui.card} p-3`}>
          <button
            type="button"
            onClick={() => setCreating((open) => !open)}
            aria-expanded={creating}
            className="flex w-full items-center gap-2 text-left font-display text-sm tracking-wide text-amber-100"
          >
            <Plus className="size-4 text-amber-300" />
            New map
            {creating ? (
              <ChevronDown className="ml-auto size-4 text-stone-500" />
            ) : (
              <ChevronRight className="ml-auto size-4 text-stone-500" />
            )}
          </button>
          {creating ? (
            <div className="mt-3">
              <MapCreateControls
                busy={busy}
                board={state.board}
                showHeading={false}
                onCreate={create}
                onImport={(file) => void importUvtt(file)}
              />
            </div>
          ) : null}
        </section>

        <MapGallery maps={state.maps} selectedId={selectedId} onOpen={(map) => select(map.id)} />
        {feedback}

        <Sheet
          open={editorOpen && selected !== null}
          onOpenChange={setEditorOpen}
          title={selected?.name ?? "Map"}
          className="top-0 h-dvh max-h-none rounded-none lg:top-1/2 lg:h-auto lg:max-h-[92vh] lg:w-[min(96vw,64rem)] lg:rounded-xl"
        >
          {editor}
          <div className="mt-2">{feedback}</div>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <MapCreateControls
        busy={busy}
        board={state.board}
        onCreate={create}
        onImport={(file) => void importUvtt(file)}
      />

      {state.maps.length ? (
        <div className="flex flex-wrap gap-1">
          {state.maps.map((map) => (
            <button
              key={map.id}
              type="button"
              onClick={() => setSelectedId((current) => (current === map.id ? "" : map.id))}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px]",
                map.id === selectedId
                  ? "border-amber-700 bg-amber-950/50 text-amber-100"
                  : "border-stone-700 text-stone-400 hover:text-stone-200",
              )}
            >
              {map.name}
              <span className="ml-1 text-stone-600">
                {map.width}x{map.height}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-stone-500">
          Nothing in the drawer yet. Roll one, start from blank rock, or import a drawing.
        </p>
      )}

      {editor}
      {feedback}
    </div>
  );
}
