"use client";

import { useRef, useState } from "react";
import { Dices, FileUp, Library, Loader2, Save } from "lucide-react";
import { MAP_SIZE } from "@/lib/battlemap/generate";
import type { LibraryState, PreparedMap } from "@/app/workshop/maps/types";

// The top of the map drawer: name a map, then roll it, start it blank,
// import a drawing, or keep what is on the table. Split out of
// DmMapLibraryPanel so the same controls can sit in a collapsible card in the
// workshop gallery without the drawer's heading; the markup with the heading
// on is byte-for-byte what the DM console has always shown.

export function MapCreateControls({
  busy,
  board,
  showHeading = true,
  onCreate,
  onImport,
}: {
  busy: boolean;
  board: LibraryState["board"];
  showHeading?: boolean;
  // Resolves with the created map so the name field can clear itself only
  // when something was actually made.
  onCreate: (body: Record<string, unknown>) => Promise<{ map?: PreparedMap } | null>;
  onImport: (file: File) => void;
}) {
  const [newName, setNewName] = useState("");
  const [size, setSize] = useState({ width: 20, height: 15 });
  const [hint, setHint] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function create(body: Record<string, unknown>) {
    const result = await onCreate({ name: newName.trim(), ...body });
    if (result?.map) {
      setNewName("");
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2">
      {showHeading ? (
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
          <Library className="size-3.5" />
          The map drawer
        </p>
      ) : null}
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
          onClick={() =>
            void create({
              do: "create",
              ...size,
              ...(hint.trim() ? { hint: hint.trim() } : {}),
            })
          }
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
              blank === "rock" ? "Solid rock to carve rooms out of" : "Open ground to put things on"
            }
            onClick={() => void create({ do: "create", ...size, blank })}
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
              onImport(file);
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
        {board ? (
          <button
            type="button"
            disabled={busy || !newName.trim()}
            title="Save the map that is on the table right now"
            onClick={() => void create({ do: "capture" })}
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
  );
}
