"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { MonsterTile, ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
import { SectionHead } from "@/components/ui/SectionHead";
import { Field } from "@/app/workshop/kit";
import { MONSTER_NAME_MAX } from "@/lib/bestiary/monster-draft";
import { crLabel } from "@/lib/bestiary/derive-cr";
import { CR_CHOICES, type Found } from "@/app/workshop/bestiary/types";

const CR_OPTIONS = CR_CHOICES.map((cr) => ({ value: String(cr), label: crLabel(cr) }));

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
  genre,
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
  // The table's setting, so a high-rating find draws the boss plate.
  genre?: string | null;
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
      data-tour="bestiary-build-controls"
      className={cn(
        "flex flex-col gap-3",
        variant === "card" && "panel rounded-xl p-3",
      )}
    >
      {variant === "card" ? (
        <SectionHead title="Build a monster" glyph="system-bestiary" className="mb-0" />
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <Field as="label" label="Name" className="min-w-40 flex-1 sm:max-w-64">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value.slice(0, MONSTER_NAME_MAX))}
            placeholder="Bone Tyrant"
            className={ui.input}
          />
        </Field>
        <Field label="Starting CR" className="w-24">
          <Select label="Starting CR" value={String(newCr)} onChange={(next) => setNewCr(Number(next))} options={CR_OPTIONS} />
        </Field>
        <button
          type="button"
          disabled={busy || !newName.trim()}
          onClick={() => void create({ from: "cr", name: newName.trim(), cr: newCr })}
          className={ui.btnPrimary}
        >
          Start from the baseline
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field as="label" label="Or start from something that exists" className="flex-1">
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
              className={cn(ui.input, "flex-1")}
            />
            <button type="button" onClick={onFind} className={ui.btnSecondary}>
              <Search className="size-3.5" /> Find
            </button>
          </div>
        </Field>
      </div>
      {found.length ? (
        <div className="reveal flex flex-wrap gap-1.5 text-xs">
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
              className={cn(ui.btnSmall, "px-2 py-1")}
            >
              <MonsterTile
                type={entry.type}
                cr={entry.cr}
                genre={genre}
                seed={entry.slug}
                size="size-7"
              />
              {entry.name} <span className="text-stone-600">CR {crLabel(entry.cr)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="motion-shake text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
