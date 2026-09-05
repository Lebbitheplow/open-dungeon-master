"use client";

import { useState } from "react";
import { Search, Skull } from "lucide-react";
import { cn } from "@/lib/cn";
import { MONSTER_NAME_MAX } from "@/lib/bestiary/monster-draft";
import { crLabel } from "@/lib/bestiary/derive-cr";
import { CR_CHOICES, input, type Found } from "@/app/workshop/bestiary/types";

// The top of the bestiary: name a monster and start it at a challenge
// rating, or search the content pack for something to start from. Split out
// of DmBestiaryPanel so the same controls can sit in a collapsible card in
// the workshop without the console's heading; the "card" variant is what the
// DM console has always shown.
//
// The search text lives with the caller because the list reloads with it
// (the found chips come back on the same request as the monsters).

export function MonsterBuildControls({
  busy,
  found,
  query,
  onQuery,
  onFind,
  onCreate,
  error,
  variant = "card",
}: {
  busy: boolean;
  found: Found[];
  query: string;
  onQuery: (query: string) => void;
  onFind: () => void;
  // Resolves true when a monster was made, so the name can clear itself
  // only then.
  onCreate: (body: Record<string, unknown>) => Promise<boolean>;
  error: string;
  variant?: "card" | "bare";
}) {
  const [newName, setNewName] = useState("");
  const [newCr, setNewCr] = useState(1);

  async function create(body: Record<string, unknown>) {
    if (await onCreate(body)) {
      setNewName("");
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        variant === "card" && "rounded-lg border border-stone-800 bg-stone-900/40 p-3",
      )}
    >
      {variant === "card" ? (
        <h3 className="flex items-center gap-1.5 text-sm text-amber-100">
          <Skull className="size-4" /> Build a monster
        </h3>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">Name</span>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value.slice(0, MONSTER_NAME_MAX))}
            placeholder="Bone Tyrant"
            className={cn(input, "w-48")}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">Starting CR</span>
          <select
            value={newCr}
            onChange={(event) => setNewCr(Number(event.target.value))}
            className={cn(input, "w-24")}
          >
            {CR_CHOICES.map((cr) => (
              <option key={cr} value={cr}>
                {crLabel(cr)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !newName.trim()}
          onClick={() => void create({ from: "cr", name: newName.trim(), cr: newCr })}
          className="rounded-md border border-amber-500/40 px-3 py-1 text-xs text-amber-100 hover:bg-stone-800 disabled:opacity-40"
        >
          Start from the baseline
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">
            Or start from something that exists
          </span>
          <div className="flex gap-1.5">
            <input
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onFind();
                }
              }}
              placeholder="owlbear"
              className={cn(input, "flex-1")}
            />
            <button
              type="button"
              onClick={onFind}
              className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-2 text-xs text-stone-300 hover:text-amber-100"
            >
              <Search className="size-3.5" /> Find
            </button>
          </div>
        </label>
      </div>
      {found.length ? (
        <div className="flex flex-wrap gap-1">
          {found.map((entry) => (
            <button
              key={entry.slug}
              type="button"
              disabled={busy}
              onClick={() =>
                void create({
                  from: "monster",
                  slug: entry.slug,
                  name: newName.trim() || undefined,
                })
              }
              className="rounded-md border border-stone-700 px-1.5 py-0.5 text-[11px] text-stone-400 hover:text-amber-100 disabled:opacity-40"
            >
              {entry.name} <span className="text-stone-600">CR {crLabel(entry.cr)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}
