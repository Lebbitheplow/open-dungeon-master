"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { AddFromList, Suggestions } from "@/components/ui/AddFromList";
import { ContentPick } from "@/components/ui/ContentPick";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  BACKGROUND_OPTIONS,
  CLASS_OPTIONS,
  FEATURE_OPTIONS,
  RACE_OPTIONS,
  catalogLabel,
  isCasterClass,
  type CatalogOption,
} from "@/lib/worlds/catalog";
import type { WorldPackDraft } from "@/lib/worlds/draft";
import { input, removeAt, replaceAt, type SectionProps } from "@/app/workshop/plugin/types";

// The reskin tables: the world's own names for things the engine already
// has. Pick, do not type. A race, class or background is chosen from the
// catalog by its real name and the id is never seen; a spell or item is
// found in the content pack; a feature is picked from every feature the
// SRD tables grant. What a person types is the world's word for it and a
// line about what it is here.

type IdKind = "races" | "classes" | "backgrounds";
type NameKind = "spells" | "items" | "features";

const ID_COPY: Record<IdKind, { title: string; prompt: string; blurb: string; catalog: CatalogOption[] }> = {
  races: {
    title: "Species",
    prompt: "Add a species to rename",
    blurb: "The peoples of this world, each standing on a real ancestry. A player picks the world's name and gets the ancestry's traits.",
    catalog: RACE_OPTIONS,
  },
  classes: {
    title: "Callings",
    prompt: "Add a class to rename",
    blurb: "What the classes are called here. A caster can also rename its spells as a whole ('Programs', 'Prayers').",
    catalog: CLASS_OPTIONS,
  },
  backgrounds: {
    title: "Backgrounds",
    prompt: "Add a background to rename",
    blurb: "Where a character comes from, in this world's words.",
    catalog: BACKGROUND_OPTIONS,
  },
};

export function IdReskinList({ draft, onDraft, kind }: SectionProps & { kind: IdKind }) {
  const copy = ID_COPY[kind];
  const list = draft[kind];
  const used = new Set(list.map((entry) => entry.id));
  const remaining = copy.catalog.filter((option) => !used.has(option.value));
  const set = (next: WorldPackDraft[IdKind]) => onDraft({ ...draft, [kind]: next } as WorldPackDraft);
  return (
    <section className={ui.card + " p-4"}>
      <h3 className="font-display text-base tracking-wide text-amber-200">{copy.title}</h3>
      <p className="mb-3 text-[11px] text-stone-500">{copy.blurb}</p>
      <div className="space-y-1.5">
        {list.map((entry, index) => (
          <div key={`${entry.id}-${index}`} className="flex flex-wrap items-start gap-1.5 rounded-lg border border-stone-800 p-2">
            <span className="w-full text-[11px] text-stone-400 sm:w-36 sm:pt-1.5">
              {catalogLabel(copy.catalog, entry.id)}
            </span>
            <input
              value={entry.name}
              maxLength={60}
              placeholder="Called here"
              aria-label={`Name for ${catalogLabel(copy.catalog, entry.id)}`}
              onChange={(event) => set(replaceAt(list, index, { ...entry, name: event.target.value }) as typeof list)}
              className={cn(input, "w-40 min-w-0")}
            />
            <input
              value={entry.blurb}
              maxLength={200}
              placeholder="One line about it"
              aria-label="Blurb"
              onChange={(event) => set(replaceAt(list, index, { ...entry, blurb: event.target.value }) as typeof list)}
              className={cn(input, "min-w-0 flex-1")}
            />
            {kind === "classes" && isCasterClass(entry.id) ? (
              <input
                value={(entry as { castingLabel?: string | null }).castingLabel ?? ""}
                maxLength={40}
                placeholder="Its spells are called"
                aria-label="Casting label"
                onChange={(event) =>
                  set(
                    replaceAt(list as WorldPackDraft["classes"], index, {
                      ...(entry as WorldPackDraft["classes"][number]),
                      castingLabel: event.target.value || null,
                    }),
                  )
                }
                className={cn(input, "w-40 min-w-0")}
              />
            ) : null}
            <button
              type="button"
              onClick={() => set(removeAt(list, index) as typeof list)}
              aria-label={`Remove ${catalogLabel(copy.catalog, entry.id)}`}
              className="rounded-md p-1 text-stone-600 hover:text-red-300"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2">
        <AddFromList
          prompt={copy.prompt}
          options={remaining}
          onPick={(id) =>
            set([
              ...list,
              kind === "classes" ? { id, name: "", blurb: "", castingLabel: null } : { id, name: "", blurb: "" },
            ] as typeof list)
          }
        />
      </div>
    </section>
  );
}

const NAME_COPY: Record<NameKind, { title: string; blurb: string }> = {
  spells: { title: "Spells", blurb: "The world's names for spells. The sheet keeps the real name; players and the narrator see yours." },
  items: { title: "Gear", blurb: "Weapons, armour and items renamed. Watch the spelling of the original: the armour entry is 'Leather', not 'Leather Armor'." },
  features: { title: "Features", blurb: "Class features and racial traits renamed: 'Sneak Attack' becomes 'Backstab' on every rogue's sheet." },
};

export function NameReskinList({ draft, onDraft, kind }: SectionProps & { kind: NameKind }) {
  const copy = NAME_COPY[kind];
  const list = draft[kind];
  const set = (next: WorldPackDraft[NameKind]) => onDraft({ ...draft, [kind]: next } as WorldPackDraft);
  const [feature, setFeature] = useState("");
  const addFrom = (from: string) => {
    const trimmed = from.trim();
    if (!trimmed || list.some((entry) => entry.from.toLowerCase() === trimmed.toLowerCase())) {
      return;
    }
    set([...list, { from: trimmed, name: "", blurb: "" }]);
    setFeature("");
  };
  return (
    <section className={ui.card + " p-4"}>
      <h3 className="font-display text-base tracking-wide text-amber-200">{copy.title}</h3>
      <p className="mb-3 text-[11px] text-stone-500">{copy.blurb}</p>
      <div className="space-y-1.5">
        {list.map((entry, index) => (
          <div key={`${entry.from}-${index}`} className="flex flex-wrap items-start gap-1.5 rounded-lg border border-stone-800 p-2">
            <span className="w-full text-[11px] text-stone-400 sm:w-36 sm:pt-1.5">{entry.from}</span>
            <input
              value={entry.name}
              maxLength={80}
              placeholder="Called here"
              aria-label={`Name for ${entry.from}`}
              onChange={(event) => set(replaceAt(list, index, { ...entry, name: event.target.value }))}
              className={cn(input, "w-40 min-w-0")}
            />
            <input
              value={entry.blurb}
              maxLength={200}
              placeholder="One line about it"
              aria-label="Blurb"
              onChange={(event) => set(replaceAt(list, index, { ...entry, blurb: event.target.value }))}
              className={cn(input, "min-w-0 flex-1")}
            />
            <button
              type="button"
              onClick={() => set(removeAt(list, index))}
              aria-label={`Remove ${entry.from}`}
              className="rounded-md p-1 text-stone-600 hover:text-red-300"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2">
        {kind === "features" ? (
          <div className="flex gap-1.5">
            <input
              value={feature}
              list="plugin-feature-options"
              placeholder="Find a feature to rename"
              aria-label="Feature to rename"
              onChange={(event) => setFeature(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addFrom(feature);
                }
              }}
              className={cn(input, "min-w-0 flex-1")}
            />
            <Suggestions id="plugin-feature-options" options={FEATURE_OPTIONS()} />
            <button type="button" onClick={() => addFrom(feature)} disabled={!feature.trim()} className={cn(ui.btnSmall, "text-xs")}>
              <Plus className="size-3.5" /> Add
            </button>
          </div>
        ) : (
          <ContentPick
            kind={kind}
            label={`Find a ${kind === "spells" ? "spell" : "item"} to rename`}
            placeholder={`Find a ${kind === "spells" ? "spell" : "item"} to rename`}
            onPick={(entry) => addFrom(entry.name)}
          />
        )}
      </div>
    </section>
  );
}

export function PeopleSection(props: SectionProps) {
  return (
    <div className="space-y-4">
      <IdReskinList {...props} kind="races" />
      <IdReskinList {...props} kind="classes" />
      <IdReskinList {...props} kind="backgrounds" />
    </div>
  );
}

export function MagicSection(props: SectionProps) {
  return (
    <div className="space-y-4">
      <NameReskinList {...props} kind="spells" />
      <NameReskinList {...props} kind="items" />
      <NameReskinList {...props} kind="features" />
    </div>
  );
}
