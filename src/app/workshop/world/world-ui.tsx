"use client";

import { BookOpen, Flag, MapPin, Search, UserRound, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { Shelf, WorldDoc, WorldType } from "@/lib/worldforge/model";
import { typeFor } from "@/lib/worldforge/model";
import type { WorldEntity } from "@/lib/db/world-forge";

// Small shared pieces of the WorldForge section.

export const SHELF_ICONS: Record<Shelf, LucideIcon> = { npc: UserRound, location: MapPin, faction: Flag, lore: BookOpen };

// Where each shelf's own tool lives in the workshop (systems.ts ids).
export const SHELF_SYSTEMS: Record<Shelf, { system: string; label: string }> = {
  npc: { system: "cast", label: "Cast" },
  location: { system: "region", label: "Region" },
  faction: { system: "factions", label: "Factions" },
  lore: { system: "lore", label: "Lore" },
};

export const typeOf = (doc: Pick<WorldDoc, "types">, entity: WorldEntity): WorldType => typeFor(doc, entity.shelf, entity.entry.typeId);

export function tint(color: string, alpha: number): string {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function TypeChip({ type, className }: { type: WorldType; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]", className)}
      style={{ background: tint(type.color, 0.16), borderColor: tint(type.color, 0.4), color: type.color }}
    >
      {type.name}
    </span>
  );
}

// An entry's face: its picture, or its shelf's icon on its type's colour.
export function EntityAvatar({ entity, type, size = "size-9" }: { entity: WorldEntity; type: WorldType; size?: string }) {
  const Icon = SHELF_ICONS[entity.shelf];
  if (entity.portrait) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={entity.portrait} alt="" className={cn(size, "shrink-0 rounded-lg border border-amber-400/25 object-cover")} />
    );
  }
  return (
    <span className={cn(size, "grid shrink-0 place-items-center rounded-lg border")} style={{ background: tint(type.color, 0.14), borderColor: tint(type.color, 0.35), color: type.color }}>
      <Icon className="size-4" />
    </span>
  );
}

// Every entry, searchable and grouped by type, for anywhere one is chosen:
// a link's other end, a pin's place, a secret's keepers. Nothing is typed
// that the list could have offered.
export function EntityPicker({
  doc,
  entities,
  onPick,
  exclude = [],
  chosen = [],
  label,
  autoFocus = false,
}: {
  doc: WorldDoc;
  entities: WorldEntity[];
  onPick: (entity: WorldEntity) => void;
  exclude?: string[];
  chosen?: string[];
  label: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const words = query.trim().toLowerCase();
    const shown = entities.filter(
      (entity) =>
        !exclude.includes(entity.ref) &&
        (!words || [entity.name, ...entity.aliases].some((name) => name.toLowerCase().includes(words))),
    );
    return doc.types
      .map((type) => ({ type, rows: shown.filter((entity) => typeOf(doc, entity).id === type.id) }))
      .filter((group) => group.rows.length);
  }, [doc, entities, exclude, query]);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone-500" />
        <input
          className={cn(ui.input, "pl-8 text-xs")}
          placeholder={`Find ${label}`}
          aria-label={`Find ${label}`}
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="max-h-64 overflow-y-auto pr-1" role="listbox" aria-label={label}>
        {groups.length === 0 ? <p className="px-1 py-2 text-xs text-stone-500">Nothing by that name.</p> : null}
        {groups.map(({ type, rows }) => (
          <div key={type.id} className="mb-2">
            <p className="eyebrow mb-1 px-1 text-[10px]" style={{ color: type.color }}>
              {type.name}
            </p>
            {rows.map((entity) => (
              <button
                key={entity.ref}
                type="button"
                role="option"
                aria-selected={chosen.includes(entity.ref)}
                onClick={() => onPick(entity)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-stone-300 hover:bg-stone-800/70 hover:text-amber-100 motion-press",
                  chosen.includes(entity.ref) && "bg-amber-400/10 text-amber-100",
                )}
              >
                <EntityAvatar entity={entity} type={type} size="size-6" />
                <span className="truncate">{entity.name}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
