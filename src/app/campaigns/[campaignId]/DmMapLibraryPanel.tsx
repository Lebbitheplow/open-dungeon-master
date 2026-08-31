"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Dices, FileUp, Library, Loader2, Play, Save, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { MAP_SIZE, MAP_THEMES, type MapTheme } from "@/lib/battlemap/generate";
import { MAX_STROKES, type Brush as BrushName } from "@/lib/battlemap/paint";
import { TERRAIN } from "@/lib/battlemap/types";
import type { StampKind } from "@/lib/battlemap/stamp";
import type { AmbientLight } from "@/lib/battlemap/types";
import type { Backdrop } from "@/lib/battlemap/backdrop";
import { backdropDataUrl, nameFromFilename } from "@/lib/battlemap/uvtt";
import { TerrainCanvas } from "@/app/campaigns/[campaignId]/TerrainCanvas";
import {
  BackdropControls,
  BrushPalette,
  StampPalette,
} from "@/app/campaigns/[campaignId]/MapTools";

// The map library: maps built before anybody needed them.
//
// This is the difference between the workshop's map tab and a preview
// button. A workshop has no party, so it can never open a scene and the
// studio has nothing to paint on; here a DM rolls or draws or imports a map,
// keeps it, and puts it on a table weeks later.
//
// Every edit is a request the server validates through the same painter the
// live board uses, so a map in this drawer is a map that can be played on.

const THEME_LABELS: Record<MapTheme, string> = {
  cave: "Cave",
  forest: "Forest",
  swamp: "Swamp",
  riverside: "Water",
  interior: "Indoors",
  field: "Open ground",
};

type PreparedMap = {
  id: string;
  name: string;
  notes: string;
  tags: string[];
  width: number;
  height: number;
  terrain: string;
  ambient: AmbientLight;
  theme: MapTheme;
  seed: number;
  backdrop: Backdrop | null;
};

type LibraryState = {
  maps: PreparedMap[];
  board: "fight" | "scene" | null;
  hasParty: boolean;
  // True in a workshop, where a scene can never open (there is no party and
  // never will be), so the control is hidden rather than forever disabled.
  workshop: boolean;
};

// The characters a terrain string is written in, back to the brush that
// paints them, for replaying one map's drawing onto another.
const CHAR_TO_BRUSH = Object.fromEntries(
  Object.entries(TERRAIN).map(([brush, char]) => [char, brush]),
) as Record<string, BrushName>;

export function DmMapLibraryPanel({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<LibraryState>({
    maps: [],
    board: null,
    hasParty: false,
    workshop: false,
  });
  const [selectedId, setSelectedId] = useState("");
  const [newName, setNewName] = useState("");
  const [size, setSize] = useState({ width: 20, height: 15 });
  const [hint, setHint] = useState("");
  const [brush, setBrush] = useState<BrushName | "">("");
  const [stamp, setStamp] = useState<StampKind | "">("");
  const [stampSize, setStampSize] = useState({ width: 5, height: 4 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

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

  async function patch(body: Record<string, unknown>) {
    if (!selected) {
      return;
    }
    setError("");
    const response = await fetch(`/api/campaigns/${campaignId}/dm/maps/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError((payload as { error?: string }).error ?? "That was refused.");
      return;
    }
    await load();
  }

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
  // is composed: create with the same seed and dials (which replays any
  // generated lights), then repaint every tile where the original's hand
  // edits or imported geometry diverge from the reroll, in MAX_STROKES
  // chunks, then carry the notes, tags and backdrop across.
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
      seed: original.seed,
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
      const strokes: Array<{ x: number; y: number; brush: BrushName }> = [];
      // Interior tiles only: the border is painter-protected and stays wall
      // on both sides of the diff.
      for (let y = 1; y < original.height - 1; y += 1) {
        for (let x = 1; x < original.width - 1; x += 1) {
          const index = y * original.width + x;
          const wanted = original.terrain[index];
          if (wanted !== copy.terrain[index] && CHAR_TO_BRUSH[wanted]) {
            strokes.push({ x, y, brush: CHAR_TO_BRUSH[wanted] });
          }
        }
      }
      for (let at = 0; at < strokes.length; at += MAX_STROKES) {
        const response = await fetch(`/api/campaigns/${campaignId}/dm/maps/${copy.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strokes: strokes.slice(at, at + MAX_STROKES) }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError((payload as { error?: string }).error ?? "The copy could not be painted.");
          return;
        }
      }
      const carry: Record<string, unknown> = {};
      if (original.notes) {
        carry.notes = original.notes;
      }
      if (original.tags.length) {
        carry.tags = original.tags;
      }
      if (original.backdrop) {
        carry.backdropPath = original.backdrop.path;
        carry.backdropTransform = original.backdrop.transform;
      }
      if (Object.keys(carry).length) {
        await fetch(`/api/campaigns/${campaignId}/dm/maps/${copy.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(carry),
        });
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
        setSelectedId(result.map.id);
        setNote(result.notes?.[0] ?? "Imported.");
      }
    } catch {
      setError("That file is not a Universal VTT export this can read.");
    } finally {
      setBusy(false);
    }
  }

  const canDeploy = state.board !== null;

  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
          <Library className="size-3.5" />
          The map drawer
        </p>
        <div className="flex flex-wrap gap-1.5">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Name it: the flooded crypt"
            className="min-w-40 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
          />
        </div>
        <input
          value={hint}
          onChange={(event) => setHint(event.target.value)}
          placeholder="what the place is like, for the generator"
          className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1 text-[11px] text-stone-500">
            Size
            <input
              type="number"
              min={MAP_SIZE.minWidth}
              max={MAP_SIZE.maxWidth}
              value={size.width}
              onChange={(event) =>
                setSize({ ...size, width: Number(event.target.value) || size.width })
              }
              className="w-12 rounded-md border border-stone-700 bg-stone-950 px-1 py-1 text-xs text-stone-300"
            />
            x
            <input
              type="number"
              min={MAP_SIZE.minHeight}
              max={MAP_SIZE.maxHeight}
              value={size.height}
              onChange={(event) =>
                setSize({ ...size, height: Number(event.target.value) || size.height })
              }
              className="w-12 rounded-md border border-stone-700 bg-stone-950 px-1 py-1 text-xs text-stone-300"
            />
          </label>
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={async () => {
              const result = await post({
                do: "create",
                name: newName.trim(),
                ...size,
                ...(hint.trim() ? { hint: hint.trim() } : {}),
              });
              if (result?.map) {
                setSelectedId(result.map.id);
                setNewName("");
              }
            }}
            className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Dices className="size-3" />}
            Roll one
          </button>
          {(["rock", "ground"] as const).map((blank) => (
            <button
              key={blank}
              type="button"
              disabled={busy || !newName.trim()}
              title={
                blank === "rock"
                  ? "Solid rock to carve rooms out of"
                  : "Open ground to put things on"
              }
              onClick={async () => {
                const result = await post({
                  do: "create",
                  name: newName.trim(),
                  ...size,
                  blank,
                });
                if (result?.map) {
                  setSelectedId(result.map.id);
                  setNewName("");
                }
              }}
              className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
            >
              {blank === "rock" ? "Blank rock" : "Blank ground"}
            </button>
          ))}
          <input
            ref={fileRef}
            type="file"
            accept=".dd2vtt,.uvtt,.df2vtt,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void importUvtt(file);
              }
              event.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            title="A Universal VTT export from Dungeondraft and its neighbours"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
          >
            <FileUp className="size-3" /> Import .dd2vtt
          </button>
          {state.board ? (
            <button
              type="button"
              disabled={busy || !newName.trim()}
              title="Save the map that is on the table right now"
              onClick={async () => {
                const result = await post({ do: "capture", name: newName.trim() });
                if (result?.map) {
                  setSelectedId(result.map.id);
                  setNewName("");
                }
              }}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
            >
              <Save className="size-3" /> Keep the board
            </button>
          ) : null}
        </div>
        <p className="text-[10px] text-stone-600">
          Name it first. Nothing here touches the table until you put it there.
        </p>
      </section>

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

      {selected ? (
        <section className="space-y-2.5">
          <TerrainCanvas
            terrain={selected.terrain}
            width={selected.width}
            height={selected.height}
            backdrop={selected.backdrop}
            onPaint={
              brush && !stamp ? (x, y) => void patch({ strokes: [{ x, y, brush }] }) : undefined
            }
            onStamp={
              stamp ? (x, y) => void patch({ stamp: { kind: stamp, x, y, ...stampSize } }) : undefined
            }
            stamp={stamp ? { kind: stamp, ...stampSize } : null}
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <input
              defaultValue={selected.name}
              key={`name-${selected.id}`}
              onBlur={(event) =>
                event.target.value.trim() && event.target.value !== selected.name
                  ? void patch({ name: event.target.value.trim() })
                  : undefined
              }
              className="min-w-32 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
            />
            <select
              value={selected.theme}
              onChange={(event) => void patch({ theme: event.target.value })}
              className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300"
            >
              {MAP_THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {THEME_LABELS[theme]}
                </option>
              ))}
            </select>
            <select
              value={selected.ambient}
              onChange={(event) => void patch({ ambient: event.target.value })}
              className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300"
            >
              <option value="bright">Daylight</option>
              <option value="dim">Dim</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <textarea
            defaultValue={selected.notes}
            key={`notes-${selected.id}`}
            onBlur={(event) =>
              event.target.value !== selected.notes
                ? void patch({ notes: event.target.value })
                : undefined
            }
            rows={2}
            placeholder="What lives here. Nobody but you reads this."
            className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
          />

          <BrushPalette
            brush={brush}
            onPick={(next) => {
              setBrush(next);
              if (next) {
                setStamp("");
              }
            }}
          />
          <StampPalette
            stamp={stamp}
            size={stampSize}
            onPick={(next) => {
              setStamp(next);
              if (next) {
                setBrush("");
              }
            }}
            onResize={setStampSize}
          />
          <BackdropControls
            backdrop={selected.backdrop}
            busy={busy}
            onChange={(next) =>
              void patch({ backdropPath: next.path, backdropTransform: next.transform })
            }
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busy || !canDeploy}
              title={
                canDeploy
                  ? "Replace the board's ground with this map"
                  : "Nothing is on the table to replace"
              }
              onClick={() => void act("deploy")}
              className="flex items-center gap-1 rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
            >
              <Upload className="size-3" /> Put it on the table
            </button>
            {state.workshop ? null : (
              <button
                type="button"
                disabled={busy || !state.hasParty || state.board !== null}
                title={
                  !state.hasParty
                    ? "There is nobody to put on it yet"
                    : state.board
                      ? "Something is already on the table"
                      : "Put the party on this map with nobody to fight"
                }
                onClick={() => void act("open-scene")}
                className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
              >
                <Play className="size-3" /> Open it as a scene
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              aria-label={`Duplicate ${selected.name}`}
              onClick={() => void duplicate()}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
            >
              <Copy className="size-3" /> Duplicate
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="ml-auto flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-500 hover:text-red-300 disabled:opacity-50"
            >
              <Trash2 className="size-3" /> Forget it
            </button>
          </div>
          {selected.seed ? (
            <p className="text-[10px] text-stone-600">Seed {selected.seed}.</p>
          ) : null}
        </section>
      ) : null}

      {note ? <p className="text-[11px] text-emerald-400">{note}</p> : null}
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}
